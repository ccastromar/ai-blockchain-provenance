package proof

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"

	"cli-ernest/cmd"
	"cli-ernest/internal/hashcanon"
	"cli-ernest/internal/merkleproof"

	"github.com/spf13/cobra"
)

var ProofCmd = &cobra.Command{
	Use:   "proof",
	Short: "Verify SPV-style inclusion receipts (GET /api/blocks/:index/proof)",
}

// receipt matches the evidence bundle emitted by the backend.
type receipt struct {
	Block struct {
		Index        int64           `json:"index"`
		Timestamp    int64           `json:"timestamp"`
		PreviousHash string          `json:"previousHash"`
		Hash         string          `json:"hash"`
		Data         json.RawMessage `json:"data"`
	} `json:"block"`
	Proof      []string `json:"proof"`
	MerkleRoot string   `json:"merkleRoot"`
	Anchor     struct {
		TxHash          string `json:"txHash"`
		ChainID         int64  `json:"chainId"`
		ContractAddress string `json:"contractAddress"`
		OrganizationID  string `json:"organizationId"`
		LastBlockIndex  int64  `json:"lastBlockIndex"`
		AnchoredAt      string `json:"anchoredAt"`
	} `json:"anchor"`
}

var verifyCmd = &cobra.Command{
	Use:   "verify <receipt.json>",
	Short: "Verify an inclusion receipt offline: block hash + Merkle path to the anchored root",
	Long: `Verifies an evidence receipt with no access to Ernest or its database:

  1. Recomputes the block hash from the receipt's block data (shared canonicalization,
     pinned by testdata/hash-golden-vectors.json) -- proves the data matches the hash.
  2. Walks the Merkle proof from that hash to the receipt's root (keccak256, sorted
     pairs, pinned by testdata/merkle-proof-golden.json) -- proves inclusion.
  3. Prints the anchor transaction so the root can be checked on the public chain --
     proves the whole thing existed before the anchor's on-chain timestamp.`,
	Args: cobra.ExactArgs(1),
	RunE: func(cobraCmd *cobra.Command, args []string) error {
		raw, err := os.ReadFile(args[0])
		if err != nil {
			return fmt.Errorf("cannot read receipt: %w", err)
		}

		var r receipt
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		if err := decoder.Decode(&r); err != nil {
			return fmt.Errorf("receipt is not valid JSON: %w", err)
		}

		// 1. Block data must reproduce the block hash.
		dataDecoder := json.NewDecoder(bytes.NewReader(r.Block.Data))
		dataDecoder.UseNumber()
		var data map[string]any
		if err := dataDecoder.Decode(&data); err != nil {
			return fmt.Errorf("receipt block data is not an object: %w", err)
		}
		recomputed, err := hashcanon.CalculateBlockHash(r.Block.Index, r.Block.Timestamp, data, r.Block.PreviousHash)
		if err != nil {
			return fmt.Errorf("cannot canonicalize block data: %w", err)
		}
		if recomputed != r.Block.Hash {
			return fmt.Errorf("TAMPERED: block data does not reproduce its hash (computed %s, receipt says %s)", recomputed, r.Block.Hash)
		}
		fmt.Printf("✓ block #%d data matches its hash %s…\n", r.Block.Index, r.Block.Hash[:16])

		// 2. Hash must climb the proof path to the anchored root.
		valid, err := merkleproof.Verify(r.Block.Hash, r.Proof, r.MerkleRoot)
		if err != nil {
			return err
		}
		if !valid {
			return fmt.Errorf("TAMPERED: Merkle proof does not connect block #%d to root %s", r.Block.Index, r.MerkleRoot)
		}
		fmt.Printf("✓ Merkle proof (%d hashes) reaches anchored root %s…\n", len(r.Proof), r.MerkleRoot[:18])

		// 3. Point at the on-chain fact that makes it evidence.
		fmt.Println("✓ receipt verified offline")
		fmt.Printf("\nAnchored root: %s\n", r.MerkleRoot)
		fmt.Printf("Anchor tx:     %s (chainId %d)\n", r.Anchor.TxHash, r.Anchor.ChainID)
		fmt.Printf("Contract:      %s\n", r.Anchor.ContractAddress)
		fmt.Printf("Anchored at:   %s (org %s, covers blocks 0..%d)\n", r.Anchor.AnchoredAt, r.Anchor.OrganizationID, r.Anchor.LastBlockIndex)
		fmt.Println("\nTo complete the chain of trust, confirm that transaction records this root on the public chain.")
		return nil
	},
}

func init() {
	ProofCmd.AddCommand(verifyCmd)
	cmd.RootCmd.AddCommand(ProofCmd)
}
