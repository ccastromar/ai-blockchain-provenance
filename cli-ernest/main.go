package main

import (
	"log"

	"github.com/joho/godotenv"

	"cli-ernest/cmd"
	_ "cli-ernest/cmd/aimodels"
	_ "cli-ernest/cmd/anchors"
	_ "cli-ernest/cmd/provenance"
)

func main() {

	// Cargar variables de entorno al inicio
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found or could not be loaded — falling back to real environment variables")
	}

	cmd.Execute()
}
