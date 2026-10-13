// Package rfc6962 verifies ADR-004 evidence batches: RFC 6962 / RFC 9162 Merkle trees
// over SHA-256, with domain-separated leaves (0x00) and interior nodes (0x01) and no
// pair sorting. It mirrors backend/src/blockchain/merkle-rfc6962.ts and is pinned
// cross-language by testdata/rfc6962-golden.json. Not to be confused with
// internal/merkleproof, the keccak sorted-pair tree used for anchors.
package rfc6962

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"cli-ernest/internal/hashcanon"
)

const TreeAlg = "rfc6962-sha256"

func leafOfBytes(b []byte) []byte {
	h := sha256.New()
	h.Write([]byte{0x00})
	h.Write(b)
	return h.Sum(nil)
}

func node(left, right []byte) []byte {
	h := sha256.New()
	h.Write([]byte{0x01})
	h.Write(left)
	h.Write(right)
	return h.Sum(nil)
}

// LeafHash is SHA-256(0x00 || JCS(data)), hex -- the same canonical bytes the block
// hash uses for `data`.
func LeafHash(data map[string]any) (string, error) {
	canonical, err := hashcanon.CanonicalJSON(data)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(leafOfBytes([]byte(canonical))), nil
}

// RawLeafHash hashes raw leaf bytes (used by the CT reference vectors).
func RawLeafHash(b []byte) string {
	return hex.EncodeToString(leafOfBytes(b))
}

func splitPoint(n int) int {
	k := 1
	for k<<1 < n {
		k <<= 1
	}
	return k
}

func mth(leaves [][]byte) []byte {
	switch len(leaves) {
	case 0:
		h := sha256.Sum256(nil)
		return h[:]
	case 1:
		return leaves[0]
	}
	k := splitPoint(len(leaves))
	return node(mth(leaves[:k]), mth(leaves[k:]))
}

func decodeAll(hexes []string) ([][]byte, error) {
	out := make([][]byte, len(hexes))
	for i, h := range hexes {
		b, err := hex.DecodeString(h)
		if err != nil {
			return nil, fmt.Errorf("invalid hex %q: %w", h, err)
		}
		out[i] = b
	}
	return out, nil
}

// Root is the Merkle Tree Hash over leaf hashes (hex, in leaf order).
func Root(leafHashes []string) (string, error) {
	leaves, err := decodeAll(leafHashes)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(mth(leaves)), nil
}

// VerifyInclusion implements RFC 9162 §2.1.3.2.
func VerifyInclusion(leafHash string, index, size int64, proof []string, root string) (bool, error) {
	if index < 0 || index >= size {
		return false, nil
	}
	r, err := hex.DecodeString(leafHash)
	if err != nil {
		return false, fmt.Errorf("invalid leaf hash: %w", err)
	}
	want, err := hex.DecodeString(root)
	if err != nil {
		return false, fmt.Errorf("invalid root: %w", err)
	}
	path, err := decodeAll(proof)
	if err != nil {
		return false, err
	}
	fn, sn := index, size-1
	for _, p := range path {
		if sn == 0 {
			return false, nil
		}
		if fn%2 == 1 || fn == sn {
			r = node(p, r)
			for fn%2 == 0 && fn != 0 {
				fn >>= 1
				sn >>= 1
			}
		} else {
			r = node(r, p)
		}
		fn >>= 1
		sn >>= 1
	}
	return sn == 0 && bytes.Equal(r, want), nil
}
