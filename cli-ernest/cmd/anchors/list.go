package anchors

import (
	"cli-ernest/internal/db/mongo"
	"cli-ernest/internal/db/repositories/anchors"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var (
	limit int64
	skip  int64
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List anchors (with pagination)",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := mongo.GetClient()
		if err != nil {
			return fmt.Errorf("failed to get Mongo client: %w", err)
		}
		repo := anchors.NewMongoRepository(client)

		results, err := repo.GetAll(limit, skip)
		b, err := json.Marshal(results)
		if err != nil {
			return fmt.Errorf("failed to marshal result to JSON: %w", err)
		}
		fmt.Println(string(b))

		return nil
	},
}

func init() {
	listCmd.Flags().Int64VarP(&limit, "limit", "l", 10, "number of AI models to fetch")
	listCmd.Flags().Int64VarP(&skip, "skip", "s", 0, "number of AI models to skip")
	AnchorsCmd.AddCommand(listCmd)
}
