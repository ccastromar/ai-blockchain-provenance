//! ADR-001 emitter-signature verification for the browser: Ed25519 over DSSE PAE
//! of the Ernest-canonical block data (minus `signature`, minus server-augmented
//! fields). Pinned cross-language by testdata/signed-submission-golden.json.

use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

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

    if alg != "ed25519" {
        return failed(envelope_key_id, format!("unsupported algorithm {alg:?}"));
    }
    let engine = base64::engine::general_purpose::STANDARD;
    let Ok(public_raw) = engine.decode(&public_key_b64) else {
        return failed(envelope_key_id, "malformed public key".into());
    };
    let Ok(public_arr) = <[u8; 32]>::try_from(public_raw.as_slice()) else {
        return failed(envelope_key_id, "public key must be 32 bytes".into());
    };
    if key_id(&public_arr) != envelope_key_id {
        return failed(envelope_key_id, "keyId does not match the embedded public key".into());
    }
    let Ok(sig_raw) = engine.decode(&sig_b64) else {
        return failed(envelope_key_id, "malformed signature".into());
    };
    let Ok(sig_arr) = <[u8; 64]>::try_from(sig_raw.as_slice()) else {
        return failed(envelope_key_id, "signature must be 64 bytes".into());
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&public_arr) else {
        return failed(envelope_key_id, "invalid Ed25519 public key".into());
    };
    let bytes = match signed_bytes(data) {
        Ok(b) => b,
        Err(e) => return failed(envelope_key_id, e),
    };
    match verifying_key.verify_strict(&bytes, &Signature::from_bytes(&sig_arr)) {
        Ok(()) => SignatureCheck { present: true, valid: true, key_id: envelope_key_id, error: None },
        Err(_) => failed(envelope_key_id, "signature does not verify over the block data".into()),
    }
}
