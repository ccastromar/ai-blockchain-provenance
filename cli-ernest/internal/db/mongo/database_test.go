package mongo

import (
	"context"
	"fmt"
	"log"
	"os"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/mongodb"
)

func mustStartMongoContainer() (teardown func(context.Context, ...testcontainers.TerminateOption) error, err error) {
	// testcontainers PANICS (not errors) when no Docker is reachable
	// ("rootless Docker not found"), so recover turns that into an error the caller
	// can treat as "skip" rather than crashing `go test ./...` on a Docker-less machine.
	defer func() {
		if r := recover(); r != nil {
			teardown, err = nil, fmt.Errorf("docker unavailable: %v", r)
		}
	}()

	// mongo:7 to match the rest of the stack (docker-compose), not a floating :latest.
	dbContainer, err := mongodb.Run(context.Background(), "mongo:7")
	if err != nil {
		return nil, err
	}

	dbHost, err := dbContainer.Host(context.Background())
	if err != nil {
		return dbContainer.Terminate, err
	}

	dbPort, err := dbContainer.MappedPort(context.Background(), "27017/tcp")
	if err != nil {
		return dbContainer.Terminate, err
	}

	host = dbHost
	port = dbPort.Port()

	return dbContainer.Terminate, err
}

func TestMain(m *testing.M) {
	teardown, err := mustStartMongoContainer()
	if err != nil {
		// No Docker (or the image can't be pulled): skip this integration package
		// instead of failing, so `go test ./...` works for contributors without
		// Docker. CI runners have Docker, so the tests run there.
		log.Printf("skipping mongo integration tests: %v", err)
		os.Exit(0)
	}

	code := m.Run()

	if teardown != nil {
		if teardownErr := teardown(context.Background()); teardownErr != nil {
			log.Printf("could not teardown mongodb container: %v", teardownErr)
		}
	}
	os.Exit(code)
}

func TestNew(t *testing.T) {
	srv := New()
	if srv == nil {
		t.Fatal("New() returned nil")
	}
}

func TestHealth(t *testing.T) {
	srv := New()

	stats := srv.Health()

	if stats["message"] != "It's healthy" {
		t.Fatalf("expected message to be 'It's healthy', got %s", stats["message"])
	}
}
