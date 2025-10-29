package provenance

import (
	"cli-ernest/internal/db/repositories/provenanceblocks"
	"fmt"

	"cli-ernest/internal/db/mongo"

	"github.com/spf13/cobra"
	"go.mongodb.org/mongo-driver/bson"
)

var heightCmd = &cobra.Command{
	Use:   "height",
	Short: "Gets height of the hashchain",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := mongo.GetClient()
		if err != nil {
			return fmt.Errorf("failed to get Mongo client: %w", err)
		}
		repo := provenanceblocks.NewMongoRepository(client)

		count, err := repo.Height(bson.D{})
		if err != nil {
			return fmt.Errorf("error : %w", err)
		}

		fmt.Printf("Hashchain height: %d\n", count)
		return nil
	},
}

func init() {
	ProvenanceCmd.AddCommand(heightCmd)
}
