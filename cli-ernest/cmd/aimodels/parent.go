package aimodels

import (
	"cli-ernest/cmd"

	"github.com/spf13/cobra"
)

var AimodelsCmd = &cobra.Command{
	Use:   "aimodels",
	Short: "Commands for AI models",
}

func init() {
	cmd.RootCmd.AddCommand(AimodelsCmd)
}
