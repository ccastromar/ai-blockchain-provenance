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

type Client struct {
	addr     string
	password string
}

type Message struct {
	ID     string
	Fields map[string]string
}

func NewClient(addr string, password string) *Client {
	return &Client{addr: addr, password: password}
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
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	deadline, ok := ctx.Deadline()
	if ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	}

	reader := bufio.NewReader(conn)
	if c.password != "" {
		if err := writeCommand(conn, []string{"AUTH", c.password}); err != nil {
			return nil, err
		}
		if _, err := readRESP(reader); err != nil {
			return nil, err
		}
	}

	if err := writeCommand(conn, args); err != nil {
		return nil, err
	}
	return readRESP(reader)
}

func writeCommand(conn net.Conn, args []string) error {
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
		return nil, errors.New(line)
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
