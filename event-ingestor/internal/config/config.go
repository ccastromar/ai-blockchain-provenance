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
	RedisMaxLen             int64
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
	MetricsPort             string
}

func Load() Config {
	return Config{
		Port:                    env("PORT", "3011"),
		RedisAddr:               env("REDIS_ADDR", "redis:6379"),
		RedisPassword:           os.Getenv("REDIS_PASSWORD"),
		RedisStream:             env("REDIS_STREAM", "ernest:events:incoming"),
		RedisGroup:              env("REDIS_GROUP", "provenance-writers"),
		RedisConsumer:           env("REDIS_CONSUMER", hostname("writer-1")),
		RedisDLQStream:          env("REDIS_DLQ_STREAM", "ernest:events:deadletter"),
		RedisRejectedStream:     env("REDIS_REJECTED_STREAM", "ernest:events:rejected"),
		RedisMaxLen:             envInt64("REDIS_STREAM_MAXLEN", 10000),
		MongoURI:                env("MONGODB_URI", env("MONGO_URI", "mongodb://mongodb:27017/ernest")),
		MongoDatabase:           env("MONGO_DB_NAME", "ernest"),
		MaxPayloadBytes:         envInt64("MAX_PAYLOAD_BYTES", 1024*1024),
		HFWebhookSecret:         os.Getenv("HF_WEBHOOK_SECRET"),
		ProviderHMACSecret:      os.Getenv("EVENT_PROVIDER_HMAC_SECRET"),
		ProviderHMACTolerance:   time.Duration(envInt64("PROVIDER_HMAC_TOLERANCE_SECONDS", 300)) * time.Second,
		IngestorAPIKey:          os.Getenv("EVENT_INGESTOR_API_KEY"),
		WorkerBlockMS:           envInt64("WORKER_BLOCK_MS", 5000),
		WorkerBatchCount:        envInt64("WORKER_BATCH_COUNT", 10),
		WorkerReclaimIntervalMS: envInt64("WORKER_RECLAIM_INTERVAL_MS", 30000),
		WorkerReclaimMinIdleMS:  envInt64("WORKER_RECLAIM_MIN_IDLE_MS", 60000),
		RateLimitRPS:            envFloat64("RATE_LIMIT_RPS", 20),
		RateLimitBurst:          int(envInt64("RATE_LIMIT_BURST", 40)),
		MetricsPort:             env("METRICS_PORT", "9102"),
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
