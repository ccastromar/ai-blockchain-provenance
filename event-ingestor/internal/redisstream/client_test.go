package redisstream

import (
	"bufio"
	"strconv"
	"strings"
	"testing"
)

// fragmentedReader hands back at most maxChunk bytes per Read call, regardless of how
// much buffer space the caller offers. This reproduces what a real TCP connection can do
// for a large reply that arrives across multiple packets.
type fragmentedReader struct {
	data     []byte
	pos      int
	maxChunk int
}

func (r *fragmentedReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, nil
	}
	n := r.maxChunk
	if n > len(p) {
		n = len(p)
	}
	if remaining := len(r.data) - r.pos; n > remaining {
		n = remaining
	}
	copy(p, r.data[r.pos:r.pos+n])
	r.pos += n
	return n, nil
}

func TestReadRESPBulkStringSurvivesFragmentedReads(t *testing.T) {
	// Larger than bufio's default 4096-byte internal buffer so readRESP's bulk-string
	// read goes through the "read directly into caller's buffer" path in bufio.Reader,
	// which only guarantees at least 1 byte per Read call, not a full buffer.
	value := strings.Repeat("a", 9000)
	raw := []byte("$" + strconv.Itoa(len(value)) + "\r\n" + value + "\r\n")

	reader := bufio.NewReader(&fragmentedReader{data: raw, maxChunk: 7})

	reply, err := readRESP(reader)
	if err != nil {
		t.Fatalf("readRESP: %v", err)
	}
	got, ok := reply.(string)
	if !ok {
		t.Fatalf("expected string reply, got %T", reply)
	}
	if got != value {
		t.Fatalf("bulk string corrupted: want %d bytes, got %d bytes", len(value), len(got))
	}
}

func TestParseAutoClaimReply(t *testing.T) {
	reply := []any{
		"0-0",
		[]any{
			[]any{"1-0", []any{"source", "sagemaker", "eventType", "model.approved"}},
			[]any{"2-0", []any{"source", "huggingface"}},
		},
	}

	cursor, messages, err := parseAutoClaimReply(reply)
	if err != nil {
		t.Fatalf("parseAutoClaimReply: %v", err)
	}
	if cursor != "0-0" {
		t.Fatalf("cursor mismatch: got %q", cursor)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[0].ID != "1-0" || messages[0].Fields["source"] != "sagemaker" {
		t.Fatalf("unexpected first message: %+v", messages[0])
	}
	if messages[1].ID != "2-0" || messages[1].Fields["source"] != "huggingface" {
		t.Fatalf("unexpected second message: %+v", messages[1])
	}
}

func TestParseAutoClaimReplyEmpty(t *testing.T) {
	cursor, messages, err := parseAutoClaimReply([]any{"0-0", []any{}})
	if err != nil {
		t.Fatalf("parseAutoClaimReply: %v", err)
	}
	if cursor != "0-0" {
		t.Fatalf("cursor mismatch: got %q", cursor)
	}
	if len(messages) != 0 {
		t.Fatalf("expected no messages, got %d", len(messages))
	}
}

func TestParseAutoClaimReplyMalformed(t *testing.T) {
	if _, _, err := parseAutoClaimReply("not-an-array"); err == nil {
		t.Fatal("expected error for malformed reply")
	}
}
