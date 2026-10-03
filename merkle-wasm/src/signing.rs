//! Emitter-signature verification for the browser, over DSSE PAE of the Ernest-canonical
//! block data (minus `signature`, minus server-augmented fields):
//!   - ADR-001: Ed25519 with a raw public key (pinned by testdata/signed-submission-golden.json).
//!   - ADR-002 B2: a qualified electronic seal (alg `qeseal-ecdsa-p256`) whose signature is
//!     checked against the leaf X.509 certificate in `x5c`. (RSA qualified seals
//!     (`qeseal-rsa-sha256`) are verified by the Go CLI, not in-browser, to keep the WASM
//!     bundle lean. Trust-chain validation to an EU Trusted List anchor is a separate policy
//!     layer, not done here -- this is the cryptographic authorship check.)

use base64::Engine;
use der::{Decode, Encode};
use ed25519_dalek::{Signature, VerifyingKey};
use p256::ecdsa::{signature::Verifier, Signature as P256Signature, VerifyingKey as P256VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};
use spki::DecodePublicKey;
use x509_cert::Certificate;

use crate::canonical;

pub const PAYLOAD_TYPE: &str = "application/vnd.ernest.provenance+json";
pub const SERVER_AUGMENTED_FIELDS: [&str; 1] = ["executedAt"];

pub fn pae(payload_type: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!("DSSEv1 {} {} {} ", payload_type.len(), payload_type, body.len()).into_bytes();
    out.extend_from_slice(body);
    out
}

pub fn signed_bytes(data: &Value) -> Result<Vec<u8>, String> {
    let mut stripped = data.clone();
    if let Some(map) = stripped.as_object_mut() {
        map.remove("signature");
        for field in SERVER_AUGMENTED_FIELDS {
            map.remove(field);
        }
    }
    let canonical = canonical::canonical_json(&stripped)?;
    Ok(pae(PAYLOAD_TYPE, canonical.as_bytes()))
}

pub fn key_id(public_key_raw: &[u8]) -> String {
    let digest = Sha256::digest(public_key_raw);
    hex::encode(digest)[..16].to_string()
}

pub struct SignatureCheck {
    pub present: bool,
    pub valid: bool,
    pub key_id: String,
    pub error: Option<String>,
}

/// Verifies an embedded envelope, when present, against the block data.
pub fn check_embedded_signature(data: &Value) -> SignatureCheck {
    let absent = SignatureCheck { present: false, valid: true, key_id: String::new(), error: None };
    let Some(envelope) = data.get("signature").and_then(|s| s.as_object()) else {
        return absent;
    };
    let failed = |key_id: String, error: String| SignatureCheck { present: true, valid: false, key_id, error: Some(error) };

    let get = |key: &str| envelope.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let (alg, envelope_key_id, public_key_b64, sig_b64) = (get("alg"), get("keyId"), get("publicKey"), get("sig"));
    let x5c: Vec<String> = envelope
        .get("x5c")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    match alg.as_str() {
        "ed25519" => verify_ed25519(data, &envelope_key_id, &public_key_b64, &sig_b64),
        "qeseal-ecdsa-p256" => verify_qseal_p256(data, &envelope_key_id, &x5c, &sig_b64),
        "qeseal-rsa-sha256" => failed(
            envelope_key_id,
            "RSA qualified seals are verified by the Ernest CLI, not in-browser".into(),
        ),
        _ => failed(envelope_key_id, format!("unsupported algorithm {alg:?}")),
    }
}

fn verify_ed25519(data: &Value, envelope_key_id: &str, public_key_b64: &str, sig_b64: &str) -> SignatureCheck {
    let failed = |error: String| SignatureCheck { present: true, valid: false, key_id: envelope_key_id.to_string(), error: Some(error) };
    let engine = base64::engine::general_purpose::STANDARD;
    let Ok(public_raw) = engine.decode(public_key_b64) else {
        return failed("malformed public key".into());
    };
    let Ok(public_arr) = <[u8; 32]>::try_from(public_raw.as_slice()) else {
        return failed("public key must be 32 bytes".into());
    };
    if key_id(&public_arr) != envelope_key_id {
        return failed("keyId does not match the embedded public key".into());
    }
    let Ok(sig_raw) = engine.decode(sig_b64) else {
        return failed("malformed signature".into());
    };
    let Ok(sig_arr) = <[u8; 64]>::try_from(sig_raw.as_slice()) else {
        return failed("signature must be 64 bytes".into());
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&public_arr) else {
        return failed("invalid Ed25519 public key".into());
    };
    let bytes = match signed_bytes(data) {
        Ok(b) => b,
        Err(e) => return failed(e),
    };
    match verifying_key.verify_strict(&bytes, &Signature::from_bytes(&sig_arr)) {
        Ok(()) => SignatureCheck { present: true, valid: true, key_id: envelope_key_id.to_string(), error: None },
        Err(_) => failed("signature does not verify over the block data".into()),
    }
}

/// ADR-002 B2: verify a qualified electronic seal against the leaf certificate's P-256 key.
fn verify_qseal_p256(data: &Value, envelope_key_id: &str, x5c: &[String], sig_b64: &str) -> SignatureCheck {
    let failed = |error: String| SignatureCheck { present: true, valid: false, key_id: envelope_key_id.to_string(), error: Some(error) };
    let engine = base64::engine::general_purpose::STANDARD;

    let Some(leaf_b64) = x5c.first() else {
        return failed("qualified seal is missing its x5c certificate chain".into());
    };
    let Ok(leaf_der) = engine.decode(leaf_b64) else {
        return failed("malformed leaf certificate".into());
    };
    // keyId is the SHA-256 fingerprint prefix of the leaf certificate (matches the backend).
    if key_id(&leaf_der) != envelope_key_id {
        return failed("keyId does not match the leaf certificate".into());
    }
    let Ok(cert) = Certificate::from_der(&leaf_der) else {
        return failed("cannot parse leaf certificate".into());
    };
    let Ok(spki_der) = cert.tbs_certificate.subject_public_key_info.to_der() else {
        return failed("cannot read certificate public key".into());
    };
    let Ok(verifying_key) = P256VerifyingKey::from_public_key_der(&spki_der) else {
        return failed("certificate key is not a valid P-256 key".into());
    };
    let Ok(sig_raw) = engine.decode(sig_b64) else {
        return failed("malformed signature".into());
    };
    let Ok(signature) = P256Signature::from_slice(&sig_raw) else {
        return failed("malformed ECDSA P-1363 signature".into());
    };
    let bytes = match signed_bytes(data) {
        Ok(b) => b,
        Err(e) => return failed(e),
    };
    match verifying_key.verify(&bytes, &signature) {
        Ok(()) => SignatureCheck { present: true, valid: true, key_id: envelope_key_id.to_string(), error: None },
        Err(_) => failed("signature does not verify over the block data".into()),
    }
}
