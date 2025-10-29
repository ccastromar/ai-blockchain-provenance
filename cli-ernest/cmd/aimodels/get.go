// cmd/aimodels/get.go
package aimodels

import (
	"cli-ernest/internal/db/mongo"
	"cli-ernest/internal/db/repositories/aimodels"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var modelId string

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get an AI model by modelId",
	RunE: func(cmd *cobra.Command, args []string) error {
		if modelId == "" {
			return fmt.Errorf("--modelId flag is required")
		}

		client, err := mongo.GetClient()
		if err != nil {
			return fmt.Errorf("failed to get Mongo client: %w", err)
		}
		repo := aimodels.NewMongoRepository(client)

		result, err := repo.GetByModelID(modelId)
		if err != nil {
			return fmt.Errorf("error getting ai model: %w", err)
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

	getCmd.Flags().StringVarP(&modelId, "modelId", "m", "", "modelId to fetch the AI model")
	AimodelsCmd.AddCommand(getCmd)
}
