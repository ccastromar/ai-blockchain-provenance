package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var RootCmd = &cobra.Command{
	Use:   "cli-ernest",
	Short: "Ernest CLI",
	Run: func(cmd *cobra.Command, args []string) {
		// lógica por defecto
		cmd.Println("Hola desde mi-cli")
	},
}

// Execute ejecuta el comando raiz. Debe llamarse desde main.go.
func Execute() {
	if err := RootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error ejecutando mi-cli: %v\n", err)
		os.Exit(1)
	}
}

func init() {
	// Aquí puedes definir flags persistentes o locales al root.
	// Ejemplo: rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "archivo de configuración (opcional)")
}
