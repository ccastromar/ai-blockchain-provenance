package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port                    string
	RedisAddr               string
	RedisPassword           string
	RedisStream             string
	RedisGroup              string
	RedisConsumer           string
	RedisDLQStream          string
	RedisRejectedStream     string
	RedisMaxLen             int64 // cap for the dead-letter stream only (its entries are also in Mongo)
	RedisMaxBacklog         int64 // above this many queued events, new events get 503 + Retry-After
	RedisPoolSize           int
	WorkerTrimIntervalMS    int64
	MongoURI                string
	MongoDatabase           string
	MaxPayloadBytes         int64
	HFWebhookSecret         string
	ProviderHMACSecret      string
	ProviderHMACTolerance   time.Duration
	IngestorAPIKey          string
	WorkerBlockMS           int64
	WorkerBatchCount        int64
	WorkerReclaimIntervalMS int64
	WorkerReclaimMinIdleMS  int64
	RateLimitRPS            float64
	RateLimitBurst          int
	// Budget for callers presenting a valid ingestor API key (a service such as Prudence,
	// which sends from one address and would otherwise share the per-IP budget).
	RateLimitAuthenticatedRPS   float64
	RateLimitAuthenticatedBurst int
	MetricsPort                 string
	// ADR-004: "events" or "on" makes the worker record events in evidence_events for the
	// backend's batcher to chain, instead of appending one block per event itself.
	EvidenceBatching string
	// ADR-005 Kafka source (`event-ingestor kafka`).
	KafkaBrokers        string
	KafkaTopics         string
	KafkaGroup          string
	KafkaMaxPollRecords int
	// Kafka security: PLAINTEXT, SSL, SASL_PLAINTEXT or SASL_SSL; SASL via SCRAM-SHA-512 (default),
	// SCRAM-SHA-256 or PLAIN; KafkaTLSCAFile trusts a private CA (PEM).
	KafkaSecurityProtocol string
	KafkaSASLMechanism    string
	KafkaSASLUsername     string
	KafkaSASLPassword     string
	KafkaTLSCAFile        string
}

func Load() Config {
	return Config{
		Port:                        env("PORT", "3011"),
		RedisAddr:                   env("REDIS_ADDR", "redis:6379"),
		RedisPassword:               os.Getenv("REDIS_PASSWORD"),
		RedisStream:                 env("REDIS_STREAM", "ernest:events:incoming"),
		RedisGroup:                  env("REDIS_GROUP", "provenance-writers"),
		RedisConsumer:               env("REDIS_CONSUMER", hostname("writer-1")),
		RedisDLQStream:              env("REDIS_DLQ_STREAM", "ernest:events:deadletter"),
		RedisRejectedStream:         env("REDIS_REJECTED_STREAM", "ernest:events:rejected"),
		RedisMaxLen:                 envInt64("REDIS_STREAM_MAXLEN", 10000),
		RedisMaxBacklog:             envInt64("REDIS_STREAM_MAX_BACKLOG", 100000),
		RedisPoolSize:               int(envInt64("REDIS_POOL_SIZE", 32)),
		WorkerTrimIntervalMS:        envInt64("WORKER_TRIM_INTERVAL_MS", 5000),
		MongoURI:                    env("MONGODB_URI", env("MONGO_URI", "mongodb://mongodb:27017/ernest")),
		MongoDatabase:               env("MONGO_DB_NAME", "ernest"),
		MaxPayloadBytes:             envInt64("MAX_PAYLOAD_BYTES", 1024*1024),
		HFWebhookSecret:             os.Getenv("HF_WEBHOOK_SECRET"),
		ProviderHMACSecret:          os.Getenv("EVENT_PROVIDER_HMAC_SECRET"),
		ProviderHMACTolerance:       time.Duration(envInt64("PROVIDER_HMAC_TOLERANCE_SECONDS", 300)) * time.Second,
		IngestorAPIKey:              os.Getenv("EVENT_INGESTOR_API_KEY"),
		WorkerBlockMS:               envInt64("WORKER_BLOCK_MS", 5000),
		WorkerBatchCount:            envInt64("WORKER_BATCH_COUNT", 200),
		WorkerReclaimIntervalMS:     envInt64("WORKER_RECLAIM_INTERVAL_MS", 30000),
		WorkerReclaimMinIdleMS:      envInt64("WORKER_RECLAIM_MIN_IDLE_MS", 60000),
		RateLimitRPS:                envFloat64("RATE_LIMIT_RPS", 20),
		RateLimitBurst:              int(envInt64("RATE_LIMIT_BURST", 40)),
		RateLimitAuthenticatedRPS:   envFloat64("RATE_LIMIT_AUTHENTICATED_RPS", 5000),
		RateLimitAuthenticatedBurst: int(envInt64("RATE_LIMIT_AUTHENTICATED_BURST", 10000)),
		MetricsPort:                 env("METRICS_PORT", "9102"),
		EvidenceBatching:            env("EVIDENCE_BATCHING", "off"),
		KafkaBrokers:                env("KAFKA_BROKERS", "127.0.0.1:9092"),
		KafkaTopics:                 env("KAFKA_TOPICS", "prudence.decisions"),
		KafkaGroup:                  env("KAFKA_GROUP", "ernest-ingestor"),
		KafkaMaxPollRecords:         int(envInt64("KAFKA_MAX_POLL_RECORDS", 1000)),
		KafkaSecurityProtocol:       env("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
		KafkaSASLMechanism:          env("KAFKA_SASL_MECHANISM", "SCRAM-SHA-512"),
		KafkaSASLUsername:           env("KAFKA_SASL_USERNAME", ""),
		KafkaSASLPassword:           env("KAFKA_SASL_PASSWORD", ""),
		KafkaTLSCAFile:              env("KAFKA_TLS_CA_FILE", ""),
	}
}

func env(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func envInt64(key string, fallback int64) int64 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envFloat64(key string, fallback float64) float64 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func hostname(fallback string) string {
	name, err := os.Hostname()
	if err != nil || name == "" {
		return fallback
	}
	return name
}
