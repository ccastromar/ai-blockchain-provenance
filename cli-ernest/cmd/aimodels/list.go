package aimodels

import (
	"cli-ernest/internal/db/mongo"
	"cli-ernest/internal/db/repositories/aimodels"
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
	Short: "List AI models (with pagination)",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := mongo.GetClient()
		if err != nil {
			return fmt.Errorf("failed to get Mongo client: %w", err)
		}
		repo := aimodels.NewMongoRepository(client)

		results, err := repo.GetAll(limit, skip)
		if err != nil {
			return fmt.Errorf("error listing aimodels: %w", err)
		}

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
	//cmd.RootCmd.AddCommand(listCmd)
	AimodelsCmd.AddCommand(listCmd)
}
