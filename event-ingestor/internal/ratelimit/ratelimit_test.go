package ratelimit

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNewDisabledWhenRPSNonPositive(t *testing.T) {
	l := New(0, 10)
	if l.Enabled() {
		t.Fatal("expected limiter with rps<=0 to be disabled")
	}
	for i := 0; i < 100; i++ {
		if !l.Allow("client-a") {
			t.Fatalf("disabled limiter rejected request %d", i)
		}
	}
}

func TestAllowEnforcesBurstThenBlocks(t *testing.T) {
	l := New(1, 2) // low refill rate so the burst boundary is stable within the test
	if !l.Allow("client-a") {
		t.Fatal("expected first request to be allowed")
	}
	if !l.Allow("client-a") {
		t.Fatal("expected second request (within burst) to be allowed")
	}
	if l.Allow("client-a") {
		t.Fatal("expected third immediate request to exceed burst")
	}
}

func TestAllowTracksClientsIndependently(t *testing.T) {
	l := New(1, 1)
	if !l.Allow("client-a") {
		t.Fatal("expected client-a's first request to be allowed")
	}
	if l.Allow("client-a") {
		t.Fatal("expected client-a's second immediate request to be blocked")
	}
	if !l.Allow("client-b") {
		t.Fatal("expected client-b to have its own independent bucket")
	}
}

func TestRunEvictsIdleBuckets(t *testing.T) {
	l := New(1, 1)
	l.Allow("client-a")

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	l.Run(ctx, 20*time.Millisecond, 30*time.Millisecond)

	l.mu.Lock()
	_, exists := l.buckets["client-a"]
	l.mu.Unlock()
	if exists {
		t.Fatal("expected idle bucket to be evicted after idleTTL")
	}
}

func TestRunNoopWhenDisabled(t *testing.T) {
	l := New(0, 1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// Should return immediately instead of blocking on the ticker loop.
	done := make(chan struct{})
	go func() {
		l.Run(ctx, time.Millisecond, time.Millisecond)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not return promptly for a disabled limiter")
	}
}

func TestClientKeyExtractsHostFromRemoteAddr(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "192.0.2.1:54321"
	if got := ClientKey(req); got != "192.0.2.1" {
		t.Fatalf("expected host without port, got %q", got)
	}
}

func TestClientKeyFallsBackWhenNoPort(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "not-a-host-port"
	if got := ClientKey(req); got != "not-a-host-port" {
		t.Fatalf("expected raw RemoteAddr fallback, got %q", got)
	}
}
