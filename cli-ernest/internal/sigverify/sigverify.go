// Package sigverify verifies ADR-001 emitter signatures embedded in blocks:
// Ed25519 over DSSE PAE of the Ernest-canonical block data (minus the signature
// itself and the server-augmented fields). Pinned cross-language by
// testdata/signed-submission-golden.json.
package sigverify

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"

	"cli-ernest/internal/hashcanon"
)

const PayloadType = "application/vnd.ernest.provenance+json"

// Fields the server adds to block data AFTER the client signed (ADR-001).
var ServerAugmentedFields = []string{"executedAt"}

type Envelope struct {
	Alg       string
	KeyID     string
	PublicKey string
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
	if envelope.Alg != "ed25519" {
		return fmt.Errorf("unsupported signature algorithm %q", envelope.Alg)
	}
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
	return Envelope{Alg: str("alg"), KeyID: str("keyId"), PublicKey: str("publicKey"), Sig: str("sig")}, true
}
