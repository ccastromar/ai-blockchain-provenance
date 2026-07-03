// Package merkleproof verifies SPV-style inclusion receipts issued by
// GET /api/blocks/:index/proof. The construction mirrors the backend's anchoring
// tree (merkletreejs, keccak256, sortPairs: true) and is pinned cross-language by
// testdata/merkle-proof-golden.json: a leaf climbs to the root by hashing
// keccak256(sort(current, sibling)) at each level; unpaired nodes promote
// unchanged, so they simply contribute no sibling to the path.
package merkleproof

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/crypto/sha3"
)

func keccak256(data []byte) []byte {
	hasher := sha3.NewLegacyKeccak256()
	hasher.Write(data)
	return hasher.Sum(nil)
}

func decodeHex(value string) ([]byte, error) {
	decoded, err := hex.DecodeString(strings.TrimPrefix(value, "0x"))
	if err != nil {
		return nil, fmt.Errorf("invalid hex %q: %w", value, err)
	}
	return decoded, nil
}

// Verify walks the proof path from leafHash and reports whether it reproduces
// merkleRoot. An empty proof is valid only for a single-leaf tree (root == leaf).
func Verify(leafHash string, proof []string, merkleRoot string) (bool, error) {
	current, err := decodeHex(leafHash)
	if err != nil {
		return false, err
	}
	root, err := decodeHex(merkleRoot)
	if err != nil {
		return false, err
	}

	for _, sibling := range proof {
		siblingBytes, err := decodeHex(sibling)
		if err != nil {
			return false, err
		}
		if bytes.Compare(current, siblingBytes) <= 0 {
			current = keccak256(append(current, siblingBytes...))
		} else {
			current = keccak256(append(siblingBytes, current...))
		}
	}

	return bytes.Equal(current, root), nil
}
