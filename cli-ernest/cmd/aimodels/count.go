package aimodels

import (
	"cli-ernest/internal/db/repositories/aimodels"
	"fmt"

	"cli-ernest/internal/db/mongo"

	"github.com/spf13/cobra"
	"go.mongodb.org/mongo-driver/bson"
)

var countCmd = &cobra.Command{
	Use:   "count",
	Short: "Count documents in the aimodels collection",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := mongo.GetClient()
		if err != nil {
			return fmt.Errorf("failed to get Mongo client: %w", err)
		}
		repo := aimodels.NewMongoRepository(client)

		count, err := repo.Count(bson.D{})
		if err != nil {
			return fmt.Errorf("error counting aimodels: %w", err)
		}

		fmt.Printf("aimodels collection count: %d\n", count)
		return nil
	},
}

func init() {
	//cmd.RootCmd.AddCommand(countCmd)
	AimodelsCmd.AddCommand(countCmd)
}
