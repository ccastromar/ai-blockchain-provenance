package provenance

import (
	"cli-ernest/internal/db/mongo"
	"cli-ernest/internal/db/repositories/provenanceblocks"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var index int64

var getByIndexCmd = &cobra.Command{
	Use:   "get-by-index",
	Short: "Get a provenance block by index",
	RunE: func(cmd *cobra.Command, args []string) error {

		client, err := mongo.GetClient()
		if err != nil {
			return fmt.Errorf("failed to get Mongo client: %w", err)
		}
		repo := provenanceblocks.NewMongoRepository(client)

		result, err := repo.GetByIndex(index)
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

	//	getByIndexCmd.Flags().StringVarP(&index, "index", "i", "", "index to fetch the provenance block")
	getByIndexCmd.Flags().Int64VarP(&index, "index", "i", 0, "index to fetch the provenance block")

	ProvenanceCmd.AddCommand(getByIndexCmd)
}
