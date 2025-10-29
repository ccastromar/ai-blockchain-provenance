package anchors

import (
	"cli-ernest/cmd"

	"github.com/spf13/cobra"
)

var AnchorsCmd = &cobra.Command{
	Use:   "anchors",
	Short: "Commands for anchors",
}

func init() {
	cmd.RootCmd.AddCommand(AnchorsCmd)
}
