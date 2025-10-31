package hashchain

import (
	"cli-ernest/cmd"

	"github.com/spf13/cobra"
)

var HashchainCmd = &cobra.Command{
	Use:   "hashchain",
	Short: "Commands for hashchain",
}

func init() {
	cmd.RootCmd.AddCommand(HashchainCmd)
}
