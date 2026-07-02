package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"event-ingestor/internal/config"
	"event-ingestor/internal/hashchain"
	"event-ingestor/internal/ingest"
	"event-ingestor/internal/metrics"
	"event-ingestor/internal/mongo"
	"event-ingestor/internal/redisstream"
	"event-ingestor/internal/worker"
)

func main() {
	cfg := config.Load()
	if len(os.Args) < 2 {
		log.Fatalf("usage: event-ingestor <serve|worker>")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch os.Args[1] {
	case "serve":
		runServer(ctx, cfg)
	case "worker":
		runWorker(ctx, cfg)
	default:
		log.Fatalf("unknown command %q; expected serve or worker", os.Args[1])
	}
}

func runServer(ctx context.Context, cfg config.Config) {
	stream := redisstream.NewClient(cfg.RedisAddr, cfg.RedisPassword)
	handler := ingest.NewHandler(stream, cfg)

	go handler.RunRateLimitCleanup(ctx)
	go func() {
		if err := metrics.Serve(ctx, ":"+cfg.MetricsPort); err != nil {
			log.Printf("metrics server failed: %v", err)
		}
	}()

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Printf("event ingestor listening on :%s", cfg.Port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("event ingestor failed: %v", err)
	}
}

func runWorker(ctx context.Context, cfg config.Config) {
	client, err := mongo.Connect(ctx, cfg.MongoURI)
	if err != nil {
		log.Fatalf("mongo connect failed: %v", err)
	}
	defer func() {
		disconnectCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Disconnect(disconnectCtx)
	}()

	go func() {
		if err := metrics.Serve(ctx, ":"+cfg.MetricsPort); err != nil {
			log.Printf("metrics server failed: %v", err)
		}
	}()

	stream := redisstream.NewClient(cfg.RedisAddr, cfg.RedisPassword)
	writer := hashchain.NewMongoWriter(client.Database(cfg.MongoDatabase))
	runner := worker.New(stream, writer, cfg)

	if err := runner.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("worker failed: %v", err)
	}
}
