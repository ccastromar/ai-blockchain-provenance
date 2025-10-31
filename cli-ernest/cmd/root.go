package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var RootCmd = &cobra.Command{
	Use:   "cli-ernest",
	Short: "Ernest CLI — verifiable AI model provenance using (HashChain)",
	Run: func(cmd *cobra.Command, args []string) {
		// default action
		cmd.Println(`Ernest CLI — verifiable AI model provenance using (HashChain)
---------------------------------------------------
Available commands:

  register-model     Register a new model with its hash and metadata (TODO)
  register-inference Register an inference and append it to the ledger (TODO)
  hashchain          Verify the integrity of the hash chain
  provenance         Query provenance of a model or inference
  anchors            Query anchors from public blockchain
  aimodels           Query AI models

Global options:
  -v, --verbose       Enable verbose output (TODO)
  -h, --help          Show this help message 
  --config <path>     Specify config file (default: ~/.ernest/config.yaml) TODO	`)
	},
}

// Executes root command
func Execute() {
	if err := RootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error executing Ernest CLI: %v\n", err)
		os.Exit(1)
	}
}

func init() {
	//rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "archivo de configuración (opcional)")
}
