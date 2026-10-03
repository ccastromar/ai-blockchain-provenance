// Package sigverify verifies emitter signatures embedded in blocks over DSSE PAE of the
// Ernest-canonical block data (minus the signature itself and the server-augmented
// fields). Two envelope types are supported:
//   - ADR-001: Ed25519 with a raw public key (pinned by testdata/signed-submission-golden.json).
//   - ADR-002 B2: a qualified electronic seal (alg qeseal-*) carrying an X.509 chain in x5c;
//     the signature is checked against the leaf certificate's key. (Trust-chain validation
//     to an EU Trusted List anchor is a separate policy layer, not done here -- this is the
//     cryptographic authorship check, the same scope as the Ed25519 path.)
package sigverify

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"math/big"

	"cli-ernest/internal/hashcanon"
)

const PayloadType = "application/vnd.ernest.provenance+json"

// Fields the server adds to block data AFTER the client signed (ADR-001).
var ServerAugmentedFields = []string{"executedAt"}

// Qualified-seal algorithms (ADR-002 B2).
var qsealAlgs = map[string]bool{"qeseal-ecdsa-p256": true, "qeseal-rsa-sha256": true}

type Envelope struct {
	Alg       string
	KeyID     string
	PublicKey string
	X5C       []string
	Sig       string
}

// PAE implements DSSE Pre-Authentication Encoding.
func PAE(payloadType string, body []byte) []byte {
	header := fmt.Sprintf("DSSEv1 %d %s %d ", len(payloadType), payloadType, len(body))
	return append([]byte(header), body...)
}

// SignedBytes reproduces the exact bytes an emitter signed for this block data.
func SignedBytes(data map[string]any) ([]byte, error) {
	stripped := make(map[string]any, len(data))
	for key, value := range data {
		stripped[key] = value
	}
	delete(stripped, "signature")
	for _, field := range ServerAugmentedFields {
		delete(stripped, field)
	}
	canonical, err := hashcanon.CanonicalJSON(stripped)
	if err != nil {
		return nil, err
	}
	return PAE(PayloadType, []byte(canonical)), nil
}

func KeyID(publicKeyRaw []byte) string {
	digest := sha256.Sum256(publicKeyRaw)
	return hex.EncodeToString(digest[:])[:16]
}

// Verify checks an embedded envelope against the block data it travels in.
func Verify(data map[string]any, envelope Envelope) error {
	switch {
	case envelope.Alg == "ed25519":
		return verifyEd25519(data, envelope)
	case qsealAlgs[envelope.Alg]:
		return verifyQseal(data, envelope)
	default:
		return fmt.Errorf("unsupported signature algorithm %q", envelope.Alg)
	}
}

func verifyEd25519(data map[string]any, envelope Envelope) error {
	publicKey, err := base64.StdEncoding.DecodeString(envelope.PublicKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return fmt.Errorf("malformed public key")
	}
	if KeyID(publicKey) != envelope.KeyID {
		return fmt.Errorf("keyId does not match the embedded public key")
	}
	signature, err := base64.StdEncoding.DecodeString(envelope.Sig)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return fmt.Errorf("malformed signature")
	}
	bytes, err := SignedBytes(data)
	if err != nil {
		return err
	}
	if !ed25519.Verify(publicKey, bytes, signature) {
		return fmt.Errorf("signature does not verify over the block data")
	}
	return nil
}

// verifyQseal checks a qualified electronic seal (ADR-002 B2) against its leaf certificate.
func verifyQseal(data map[string]any, envelope Envelope) error {
	if len(envelope.X5C) == 0 {
		return fmt.Errorf("qualified seal is missing its x5c certificate chain")
	}
	leafDER, err := base64.StdEncoding.DecodeString(envelope.X5C[0])
	if err != nil {
		return fmt.Errorf("malformed leaf certificate")
	}
	// keyId is the SHA-256 fingerprint prefix of the leaf certificate (matches the backend).
	if KeyID(leafDER) != envelope.KeyID {
		return fmt.Errorf("keyId does not match the leaf certificate")
	}
	cert, err := x509.ParseCertificate(leafDER)
	if err != nil {
		return fmt.Errorf("cannot parse leaf certificate: %w", err)
	}
	signature, err := base64.StdEncoding.DecodeString(envelope.Sig)
	if err != nil {
		return fmt.Errorf("malformed signature")
	}
	bytes, err := SignedBytes(data)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(bytes)

	switch envelope.Alg {
	case "qeseal-ecdsa-p256":
		pub, ok := cert.PublicKey.(*ecdsa.PublicKey)
		if !ok {
			return fmt.Errorf("certificate key is not ECDSA")
		}
		if len(signature) != 64 {
			return fmt.Errorf("malformed ECDSA P-1363 signature (want 64 bytes)")
		}
		r := new(big.Int).SetBytes(signature[:32])
		s := new(big.Int).SetBytes(signature[32:])
		if !ecdsa.Verify(pub, digest[:], r, s) {
			return fmt.Errorf("signature does not verify over the block data")
		}
	case "qeseal-rsa-sha256":
		pub, ok := cert.PublicKey.(*rsa.PublicKey)
		if !ok {
			return fmt.Errorf("certificate key is not RSA")
		}
		if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest[:], signature); err != nil {
			return fmt.Errorf("signature does not verify over the block data")
		}
	}
	return nil
}

// FromBlockData extracts an embedded envelope, if any.
func FromBlockData(data map[string]any) (Envelope, bool) {
	raw, ok := data["signature"].(map[string]any)
	if !ok {
		return Envelope{}, false
	}
	str := func(key string) string {
		value, _ := raw[key].(string)
		return value
	}
	var x5c []string
	if arr, ok := raw["x5c"].([]any); ok {
		for _, v := range arr {
			if s, ok := v.(string); ok {
				x5c = append(x5c, s)
			}
		}
	}
	return Envelope{Alg: str("alg"), KeyID: str("keyId"), PublicKey: str("publicKey"), X5C: x5c, Sig: str("sig")}, true
}
