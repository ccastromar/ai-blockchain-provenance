package emitter

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"cli-ernest/cmd"
	"cli-ernest/internal/sigverify"

	"github.com/spf13/cobra"
)

var EmitterCmd = &cobra.Command{
	Use:   "emitter",
	Short: "Emitter signing keys for ADR-001 signed submissions",
}

var keygenCmd = &cobra.Command{
	Use:   "keygen",
	Short: "Generate an Ed25519 emitter keypair and print the registration payload",
	RunE: func(cobraCmd *cobra.Command, args []string) error {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return err
		}
		seed := privateKey.Seed()
		keyID := sigverify.KeyID(publicKey)

		fmt.Println("Ed25519 emitter keypair generated.")
		fmt.Println()
		fmt.Printf("privateKeySeed (KEEP SECRET, base64): %s\n", base64.StdEncoding.EncodeToString(seed))
		fmt.Printf("publicKey (base64):                   %s\n", base64.StdEncoding.EncodeToString(publicKey))
		fmt.Printf("keyId:                                %s\n", keyID)
		fmt.Println()
		fmt.Println("Register the public key in Ernest (requires a read-write credential):")
		fmt.Println()
		fmt.Printf(`  curl -X POST "$ERNEST_URL/api/auth/emitters" \
    -H "X-Ernest-Api-Key: $ERNEST_API_KEY" -H "Content-Type: application/json" \
    -d '{"label": "my pipeline", "publicKey": "%s"}'
`, base64.StdEncoding.EncodeToString(publicKey))
		fmt.Println()
		fmt.Println("Sign submissions with integrations/signing/sign-submission.mjs or any")
		fmt.Println("Ed25519 library, over the DSSE PAE of the Ernest-canonical payload")
		fmt.Println("(see docs/adr-001-signed-submissions.md).")
		return nil
	},
}

func init() {
	EmitterCmd.AddCommand(keygenCmd)
	cmd.RootCmd.AddCommand(EmitterCmd)
}
