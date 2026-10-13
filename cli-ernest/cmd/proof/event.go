package proof

import (
	"bytes"
	"encoding/json"
	"fmt"

	"cli-ernest/internal/hashcanon"
	"cli-ernest/internal/merkleproof"
	"cli-ernest/internal/rfc6962"
	"cli-ernest/internal/sigverify"
)

// eventProof matches GET /api/events/{source}/{eventId}/proof (ADR-004).
type eventProof struct {
	Status string `json:"status"`
	Event  struct {
		Source   string         `json:"source"`
		EventID  string         `json:"eventId"`
		Seq      int64          `json:"seq"`
		Data     map[string]any `json:"data"`
		LeafHash string         `json:"leafHash"`
	} `json:"event"`
	Inclusion struct {
		Kind      string   `json:"kind"`
		TreeAlg   string   `json:"treeAlg"`
		LeafHash  string   `json:"leafHash"`
		LeafIndex int64    `json:"leafIndex"`
		TreeSize  int64    `json:"treeSize"`
		AuditPath []string `json:"auditPath"`
		Root      string   `json:"root"`
	} `json:"inclusion"`
	Block struct {
		Index        int64          `json:"index"`
		Timestamp    int64          `json:"timestamp"`
		PreviousHash string         `json:"previousHash"`
		Hash         string         `json:"hash"`
		Data         map[string]any `json:"data"`
	} `json:"block"`
	Anchor *struct {
		Proof      []string   `json:"proof"`
		MerkleRoot string     `json:"merkleRoot"`
		Anchor     anchorInfo `json:"anchor"`
	} `json:"anchor"`
	AnchorPending string `json:"anchorPending"`
}

func asInt64(v any) (int64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	i, err := n.Int64()
	return i, err == nil
}

// verifyEventProof checks, offline: event data → leaf → RFC 6962 audit path → batch
// root in the block (or, for a per-event block, data identical to the block's), the
// block's own hash, any embedded emitter signature, and the anchor path when present.
func verifyEventProof(raw []byte) error {
	var p eventProof
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&p); err != nil {
		return fmt.Errorf("event proof is not valid JSON: %w", err)
	}
	if p.Status != "chained" {
		return fmt.Errorf("event %s/%s is still %q: no proof until it is chained", p.Event.Source, p.Event.EventID, p.Status)
	}
	if p.Event.Data == nil || p.Block.Data == nil {
		return fmt.Errorf("event proof is missing event or block data")
	}

	// 1. The block's own hash.
	blockHash, err := hashcanon.CalculateBlockHash(p.Block.Index, p.Block.Timestamp, p.Block.Data, p.Block.PreviousHash)
	if err != nil {
		return fmt.Errorf("cannot canonicalize block data: %w", err)
	}
	if blockHash != p.Block.Hash {
		return fmt.Errorf("TAMPERED: block #%d data does not reproduce its hash (computed %s, proof says %s)", p.Block.Index, blockHash, p.Block.Hash)
	}

	// 2. Event → block.
	switch p.Inclusion.Kind {
	case "batch":
		leaf, err := rfc6962.LeafHash(p.Event.Data)
		if err != nil {
			return fmt.Errorf("cannot canonicalize event data: %w", err)
		}
		if leaf != p.Inclusion.LeafHash {
			return fmt.Errorf("TAMPERED: event data does not reproduce its leaf hash (computed %s, proof says %s)", leaf, p.Inclusion.LeafHash)
		}
		bd := p.Block.Data
		size, _ := asInt64(bd["size"])
		if bd["type"] != "batch" || bd["treeAlg"] != rfc6962.TreeAlg || bd["root"] != p.Inclusion.Root || size != p.Inclusion.TreeSize {
			return fmt.Errorf("TAMPERED: block #%d does not commit to batch root %s (size %d, %s)", p.Block.Index, p.Inclusion.Root, p.Inclusion.TreeSize, rfc6962.TreeAlg)
		}
		ok, err := rfc6962.VerifyInclusion(leaf, p.Inclusion.LeafIndex, p.Inclusion.TreeSize, p.Inclusion.AuditPath, p.Inclusion.Root)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("TAMPERED: audit path does not connect leaf %d to batch root %s", p.Inclusion.LeafIndex, p.Inclusion.Root)
		}
		fmt.Printf("✓ event %s/%s (seq %d) is leaf %d of %d in batch block #%d (%d-hash audit path)\n",
			p.Event.Source, p.Event.EventID, p.Event.Seq, p.Inclusion.LeafIndex, p.Inclusion.TreeSize, p.Block.Index, len(p.Inclusion.AuditPath))
	case "block":
		eventCanonical, err := hashcanon.CanonicalJSON(p.Event.Data)
		if err != nil {
			return err
		}
		blockCanonical, err := hashcanon.CanonicalJSON(p.Block.Data)
		if err != nil {
			return err
		}
		if eventCanonical != blockCanonical {
			return fmt.Errorf("TAMPERED: event data differs from block #%d data", p.Block.Index)
		}
		fmt.Printf("✓ event %s/%s (seq %d) is block #%d\n", p.Event.Source, p.Event.EventID, p.Event.Seq, p.Block.Index)
	default:
		return fmt.Errorf("unknown inclusion kind %q", p.Inclusion.Kind)
	}
	fmt.Printf("✓ block #%d data matches its hash %s…\n", p.Block.Index, p.Block.Hash[:16])

	if envelope, found := sigverify.FromBlockData(p.Event.Data); found {
		if err := sigverify.Verify(p.Event.Data, envelope); err != nil {
			return fmt.Errorf("TAMPERED: emitter signature invalid: %w", err)
		}
		fmt.Printf("✓ signed by emitter %s (%s)\n", envelope.KeyID, envelope.Alg)
	}

	// 3. Block → anchor, when an anchor covers it.
	if p.Anchor == nil {
		fmt.Println("✓ event proof verified offline (block not anchored yet)")
		if p.AnchorPending != "" {
			fmt.Printf("  %s\n", p.AnchorPending)
		}
		return nil
	}
	ok, err := merkleproof.Verify(p.Block.Hash, p.Anchor.Proof, p.Anchor.MerkleRoot)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("TAMPERED: anchor proof does not connect block #%d to root %s", p.Block.Index, p.Anchor.MerkleRoot)
	}
	fmt.Printf("✓ anchor proof (%d hashes) reaches anchored root %s…\n", len(p.Anchor.Proof), p.Anchor.MerkleRoot[:18])
	fmt.Println("✓ event proof verified offline")
	printAnchor(p.Anchor.MerkleRoot, p.Anchor.Anchor)
	return nil
}
