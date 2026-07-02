package ratelimit

import (
	"context"
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Limiter enforces a per-client-key token bucket (keyed by source IP in this codebase),
// so a single noisy or abusive source can't starve the ingestor for everyone else.
type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rps     rate.Limit
	burst   int
}

type bucket struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// New builds a Limiter. A non-positive rps disables limiting entirely (Allow always
// returns true), matching this codebase's convention of an empty/zero config value
// meaning "feature off" (see EVENT_INGESTOR_API_KEY, HF_WEBHOOK_SECRET).
func New(rps float64, burst int) *Limiter {
	return &Limiter{
		buckets: make(map[string]*bucket),
		rps:     rate.Limit(rps),
		burst:   burst,
	}
}

func (l *Limiter) Enabled() bool {
	return l != nil && l.rps > 0
}

// Allow reports whether a request for key may proceed, consuming one token if so.
func (l *Limiter) Allow(key string) bool {
	if !l.Enabled() {
		return true
	}
	l.mu.Lock()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{limiter: rate.NewLimiter(l.rps, l.burst)}
		l.buckets[key] = b
	}
	b.lastSeen = time.Now()
	limiter := b.limiter
	l.mu.Unlock()
	return limiter.Allow()
}

// Run periodically evicts buckets idle longer than idleTTL so a long-running process
// doesn't accumulate one bucket per distinct client forever. It blocks until ctx is done.
func (l *Limiter) Run(ctx context.Context, interval time.Duration, idleTTL time.Duration) {
	if !l.Enabled() {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cutoff := time.Now().Add(-idleTTL)
			l.mu.Lock()
			for key, b := range l.buckets {
				if b.lastSeen.Before(cutoff) {
					delete(l.buckets, key)
				}
			}
			l.mu.Unlock()
		}
	}
}

// ClientKey extracts the request's source IP from the TCP connection. It deliberately
// ignores X-Forwarded-For and similar client-supplied headers: trusting them here would
// let any caller pick its own rate-limit bucket by sending a different header per request.
func ClientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
