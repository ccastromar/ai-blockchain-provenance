package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"event-ingestor/internal/config"
	"event-ingestor/internal/hashchain"
	"event-ingestor/internal/ingest"
	"event-ingestor/internal/kafkasource"
	"event-ingestor/internal/metrics"
	"event-ingestor/internal/mongo"
	"event-ingestor/internal/redisstream"
	"event-ingestor/internal/worker"
)

func main() {
	cfg := config.Load()
	if len(os.Args) < 2 {
		log.Fatalf("usage: event-ingestor <serve|worker|kafka>")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch os.Args[1] {
	case "serve":
		runServer(ctx, cfg)
	case "worker":
		runWorker(ctx, cfg)
	case "kafka":
		runKafka(ctx, cfg)
	default:
		log.Fatalf("unknown command %q; expected serve, worker or kafka", os.Args[1])
	}
}

func runServer(ctx context.Context, cfg config.Config) {
	stream := redisstream.NewClientWithPool(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisPoolSize)
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

	stream := redisstream.NewClientWithPool(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisPoolSize)
	writer := hashchain.NewMongoWriter(client.Database(cfg.MongoDatabase)).WithEvidenceBatching(cfg.EvidenceBatching)
	runner := worker.New(stream, writer, cfg)

	if err := runner.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("worker failed: %v", err)
	}
}

// runKafka records the events of the configured Kafka topics (ADR-005). Run one process per
// partition at most; the consumer group shares the partitions between them.
func runKafka(ctx context.Context, cfg config.Config) {
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

	writer := hashchain.NewMongoWriter(client.Database(cfg.MongoDatabase)).WithEvidenceBatching(cfg.EvidenceBatching)
	err = kafkasource.Run(ctx, kafkasource.Config{
		Brokers:        splitList(cfg.KafkaBrokers),
		Topics:         splitList(cfg.KafkaTopics),
		Group:          cfg.KafkaGroup,
		MaxPollRecords: cfg.KafkaMaxPollRecords,
		Security: kafkasource.Security{
			Protocol:     cfg.KafkaSecurityProtocol,
			SASLMech:     cfg.KafkaSASLMechanism,
			SASLUsername: cfg.KafkaSASLUsername,
			SASLPassword: cfg.KafkaSASLPassword,
			TLSCAFile:    cfg.KafkaTLSCAFile,
		},
	}, writer)
	if err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("kafka source failed: %v", err)
	}
}

func splitList(value string) []string {
	var out []string
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
