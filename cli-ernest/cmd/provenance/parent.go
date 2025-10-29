package provenance

import (
	"cli-ernest/cmd"

	"github.com/spf13/cobra"
)

var ProvenanceCmd = &cobra.Command{
	Use:   "provenance",
	Short: "Commands for provenance",
}

func init() {
	cmd.RootCmd.AddCommand(ProvenanceCmd)
}
