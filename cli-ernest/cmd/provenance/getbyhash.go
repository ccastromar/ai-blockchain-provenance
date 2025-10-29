package provenance

import (
	"cli-ernest/internal/db/mongo"
	"cli-ernest/internal/db/repositories/provenanceblocks"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var hash string

var getByHashCmd = &cobra.Command{
	Use:   "get-by-hash",
	Short: "Get a provenance block by hash",
	RunE: func(cmd *cobra.Command, args []string) error {

		client, err := mongo.GetClient()
		if err != nil {
			return fmt.Errorf("failed to get Mongo client: %w", err)
		}
		repo := provenanceblocks.NewMongoRepository(client)

		result, err := repo.GetByHash(hash)
		if err != nil {
			return fmt.Errorf("error getting block: %w", err)
		}
		b, err := json.Marshal(result)
		if err != nil {
			return fmt.Errorf("failed to marshal result to JSON: %w", err)
		}
		fmt.Println(string(b))

		return nil
	},
}

func init() {

	getByHashCmd.Flags().StringVarP(&hash, "hash", "", "", "hash to fetch the provenance block")

	ProvenanceCmd.AddCommand(getByHashCmd)
}
