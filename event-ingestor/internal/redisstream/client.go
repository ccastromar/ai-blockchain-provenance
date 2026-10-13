package redisstream

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"
)

// Client speaks RESP over a small pool of persistent connections. It used to dial a new
// TCP connection per command; at a few thousand events/s that exhausted the host's
// ephemeral ports (connections pile up in TIME_WAIT) and the ingestor answered 502.
type Client struct {
	addr     string
	password string
	idle     chan *conn
}

type conn struct {
	net.Conn
	reader *bufio.Reader
}

// ServerError is an error reply from Redis (a "-ERR ..." line). The connection that
// carried it is still healthy and goes back to the pool; transport errors do not.
type ServerError string

func (e ServerError) Error() string { return string(e) }

// DefaultPoolSize is how many idle connections the client keeps for reuse.
const DefaultPoolSize = 32

type Message struct {
	ID     string
	Fields map[string]string
}

func NewClient(addr string, password string) *Client {
	return NewClientWithPool(addr, password, DefaultPoolSize)
}

func NewClientWithPool(addr string, password string, poolSize int) *Client {
	if poolSize < 1 {
		poolSize = 1
	}
	return &Client{addr: addr, password: password, idle: make(chan *conn, poolSize)}
}

func (c *Client) XAdd(ctx context.Context, stream string, maxLen int64, fields map[string]string) (string, error) {
	args := []string{"XADD", stream}
	if maxLen > 0 {
		args = append(args, "MAXLEN", "~", strconv.FormatInt(maxLen, 10))
	}
	args = append(args, "*")
	for key, value := range fields {
		args = append(args, key, value)
	}
	reply, err := c.command(ctx, args...)
	if err != nil {
		return "", err
	}
	id, ok := reply.(string)
	if !ok {
		return "", fmt.Errorf("unexpected XADD reply: %T", reply)
	}
	return id, nil
}

func (c *Client) XGroupCreateMkStream(ctx context.Context, stream string, group string) error {
	_, err := c.command(ctx, "XGROUP", "CREATE", stream, group, "0", "MKSTREAM")
	if err != nil && strings.Contains(err.Error(), "BUSYGROUP") {
		return nil
	}
	return err
}

func (c *Client) XReadGroup(ctx context.Context, group string, consumer string, stream string, count int64, blockMS int64) ([]Message, error) {
	args := []string{
		"XREADGROUP", "GROUP", group, consumer,
		"COUNT", strconv.FormatInt(count, 10),
		"STREAMS", stream, ">",
	}
	if blockMS > 0 {
		args = append(args[:6], append([]string{"BLOCK", strconv.FormatInt(blockMS, 10)}, args[6:]...)...)
	}
	reply, err := c.command(ctx, args...)
	if err != nil {
		return nil, err
	}
	if reply == nil {
		return nil, nil
	}
	return parseStreamMessages(reply)
}

func (c *Client) XAck(ctx context.Context, stream string, group string, id string) error {
	_, err := c.command(ctx, "XACK", stream, group, id)
	return err
}

// XAutoClaim reassigns pending entries idle longer than minIdleMS to consumer, so a
// crashed consumer's unacknowledged messages get reprocessed instead of sitting in the
// group's PEL forever. It returns the cursor to pass back in for the next page.
func (c *Client) XAutoClaim(ctx context.Context, stream string, group string, consumer string, minIdleMS int64, start string, count int64) (string, []Message, error) {
	args := []string{"XAUTOCLAIM", stream, group, consumer, strconv.FormatInt(minIdleMS, 10), start}
	if count > 0 {
		args = append(args, "COUNT", strconv.FormatInt(count, 10))
	}
	reply, err := c.command(ctx, args...)
	if err != nil {
		return "", nil, err
	}
	return parseAutoClaimReply(reply)
}

func (c *Client) command(ctx context.Context, args ...string) (any, error) {
	cn, reused, err := c.get(ctx)
	if err != nil {
		return nil, err
	}
	reply, err := c.roundTrip(ctx, cn, args)
	if err != nil && reused && !isServerError(err) {
		// An idle connection the server had already closed fails on first use: retry once
		// on a fresh one. (A duplicated XADD in that narrow window is harmless: the worker
		// deduplicates by source event id.)
		cn.Close()
		if cn, _, err = c.dial(ctx); err != nil {
			return nil, err
		}
		reply, err = c.roundTrip(ctx, cn, args)
	}
	if err != nil && !isServerError(err) {
		cn.Close()
		return nil, err
	}
	c.put(cn)
	return reply, err
}

func (c *Client) roundTrip(ctx context.Context, cn *conn, args []string) (any, error) {
	deadline, ok := ctx.Deadline()
	if !ok {
		deadline = time.Now().Add(30 * time.Second)
	}
	_ = cn.SetDeadline(deadline)
	if err := writeCommand(cn, args); err != nil {
		return nil, err
	}
	reply, err := readRESP(cn.reader)
	_ = cn.SetDeadline(time.Time{})
	return reply, err
}

func (c *Client) get(ctx context.Context) (*conn, bool, error) {
	select {
	case cn := <-c.idle:
		return cn, true, nil
	default:
	}
	cn, _, err := c.dial(ctx)
	return cn, false, err
}

func (c *Client) put(cn *conn) {
	select {
	case c.idle <- cn:
	default:
		cn.Close() // pool full
	}
}

func (c *Client) dial(ctx context.Context) (*conn, bool, error) {
	var dialer net.Dialer
	nc, err := dialer.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		return nil, false, err
	}
	cn := &conn{Conn: nc, reader: bufio.NewReader(nc)}
	if c.password != "" {
		if _, err := c.roundTrip(ctx, cn, []string{"AUTH", c.password}); err != nil {
			nc.Close()
			return nil, false, err
		}
	}
	return cn, false, nil
}

func isServerError(err error) bool {
	var se ServerError
	return errors.As(err, &se)
}

// XLen returns the number of entries in the stream (0 if it does not exist).
func (c *Client) XLen(ctx context.Context, stream string) (int64, error) {
	reply, err := c.command(ctx, "XLEN", stream)
	if err != nil {
		return 0, err
	}
	n, _ := reply.(int64)
	return n, nil
}

// TrimAcknowledged removes the entries of a stream that the consumer group has already
// processed — everything older than the oldest pending entry, or than the group's last
// delivered entry when nothing is pending — and nothing else. It replaces MAXLEN trimming,
// which dropped events nobody had processed yet once the stream outgrew the cap.
func (c *Client) TrimAcknowledged(ctx context.Context, stream string, group string) (int64, error) {
	minID, err := c.oldestUnacknowledged(ctx, stream, group)
	if err != nil || minID == "" || minID == "0-0" {
		return 0, err
	}
	reply, err := c.command(ctx, "XTRIM", stream, "MINID", minID)
	if err != nil {
		return 0, err
	}
	n, _ := reply.(int64)
	return n, nil
}

func (c *Client) oldestUnacknowledged(ctx context.Context, stream string, group string) (string, error) {
	// XPENDING summary: [count, smallest-id, greatest-id, consumers]
	pending, err := c.command(ctx, "XPENDING", stream, group)
	if err != nil {
		return "", err
	}
	if items, ok := pending.([]any); ok && len(items) >= 2 {
		if count, _ := items[0].(int64); count > 0 {
			if smallest, _ := items[1].(string); smallest != "" {
				return smallest, nil
			}
		}
	}
	// Nothing pending: everything up to the group's last delivered id has been acknowledged.
	groups, err := c.command(ctx, "XINFO", "GROUPS", stream)
	if err != nil {
		return "", err
	}
	list, _ := groups.([]any)
	for _, g := range list {
		fields, _ := g.([]any)
		info := map[string]any{}
		for i := 0; i+1 < len(fields); i += 2 {
			key, _ := fields[i].(string)
			info[key] = fields[i+1]
		}
		if name, _ := info["name"].(string); name == group {
			last, _ := info["last-delivered-id"].(string)
			return last, nil
		}
	}
	return "", nil
}

func writeCommand(conn io.Writer, args []string) error {
	var builder strings.Builder
	builder.WriteString("*")
	builder.WriteString(strconv.Itoa(len(args)))
	builder.WriteString("\r\n")
	for _, arg := range args {
		builder.WriteString("$")
		builder.WriteString(strconv.Itoa(len(arg)))
		builder.WriteString("\r\n")
		builder.WriteString(arg)
		builder.WriteString("\r\n")
	}
	_, err := conn.Write([]byte(builder.String()))
	return err
}

func readRESP(reader *bufio.Reader) (any, error) {
	prefix, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}
	line, err := reader.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")

	switch prefix {
	case '+':
		return line, nil
	case '-':
		return nil, ServerError(line)
	case ':':
		return strconv.ParseInt(line, 10, 64)
	case '$':
		length, err := strconv.Atoi(line)
		if err != nil {
			return nil, err
		}
		if length == -1 {
			return nil, nil
		}
		buf := make([]byte, length+2)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return nil, err
		}
		return string(buf[:length]), nil
	case '*':
		length, err := strconv.Atoi(line)
		if err != nil {
			return nil, err
		}
		if length == -1 {
			return nil, nil
		}
		values := make([]any, 0, length)
		for i := 0; i < length; i++ {
			value, err := readRESP(reader)
			if err != nil {
				return nil, err
			}
			values = append(values, value)
		}
		return values, nil
	default:
		return nil, fmt.Errorf("unknown RESP prefix %q", prefix)
	}
}

func parseAutoClaimReply(reply any) (string, []Message, error) {
	top, ok := reply.([]any)
	if !ok || len(top) < 2 {
		return "", nil, fmt.Errorf("unexpected XAUTOCLAIM reply: %T", reply)
	}
	cursor, _ := top[0].(string)
	entries, ok := top[1].([]any)
	if !ok {
		return cursor, nil, nil
	}

	messages := make([]Message, 0, len(entries))
	for _, entry := range entries {
		entryItems, ok := entry.([]any)
		if !ok || len(entryItems) < 2 {
			continue
		}
		id, _ := entryItems[0].(string)
		fieldPairs, _ := entryItems[1].([]any)
		fields := map[string]string{}
		for i := 0; i+1 < len(fieldPairs); i += 2 {
			key, _ := fieldPairs[i].(string)
			value, _ := fieldPairs[i+1].(string)
			fields[key] = value
		}
		messages = append(messages, Message{ID: id, Fields: fields})
	}
	return cursor, messages, nil
}

func parseStreamMessages(reply any) ([]Message, error) {
	streams, ok := reply.([]any)
	if !ok || len(streams) == 0 {
		return nil, nil
	}

	var messages []Message
	for _, streamReply := range streams {
		streamItems, ok := streamReply.([]any)
		if !ok || len(streamItems) < 2 {
			continue
		}
		entries, ok := streamItems[1].([]any)
		if !ok {
			continue
		}
		for _, entry := range entries {
			entryItems, ok := entry.([]any)
			if !ok || len(entryItems) < 2 {
				continue
			}
			id, _ := entryItems[0].(string)
			fieldPairs, _ := entryItems[1].([]any)
			fields := map[string]string{}
			for i := 0; i+1 < len(fieldPairs); i += 2 {
				key, _ := fieldPairs[i].(string)
				value, _ := fieldPairs[i+1].(string)
				fields[key] = value
			}
			messages = append(messages, Message{ID: id, Fields: fields})
		}
	}
	return messages, nil
}
