package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
)

func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("failed to create pipe: %v", err)
	}
	os.Stdout = w
	done := make(chan string, 1)
	go func() {
		var buf bytes.Buffer
		_, _ = io.Copy(&buf, r)
		done <- buf.String()
	}()

	fn()

	_ = w.Close()
	os.Stdout = oldStdout
	return <-done
}

func TestValidateToolArguments(t *testing.T) {
	if err := validateToolArguments("browser_open_tab", map[string]interface{}{}); err == nil {
		t.Fatalf("expected missing required parameter error for browser_open_tab")
	}

	if err := validateToolArguments("browser_open_tab", map[string]interface{}{"url": "https://example.com"}); err != nil {
		t.Fatalf("expected valid args to pass, got: %v", err)
	}

	if err := validateToolArguments("browser_type", map[string]interface{}{"selector": "#x"}); err == nil {
		t.Fatalf("expected missing 'text' to be rejected for browser_type")
	}

	if err := validateToolArguments("does_not_exist", map[string]interface{}{}); err == nil {
		t.Fatalf("expected unknown tool error")
	}
}

func TestReadMCPLine(t *testing.T) {
	reader := bufio.NewReaderSize(strings.NewReader("{\"a\":1}\nsecond line\n"), 64*1024)

	line, dropped, err := readMCPLine(reader)
	if err != nil || dropped || string(bytes.TrimSpace(line)) != "{\"a\":1}" {
		t.Fatalf("unexpected first line result: line=%q dropped=%v err=%v", line, dropped, err)
	}

	line, dropped, err = readMCPLine(reader)
	if err != nil || dropped || string(bytes.TrimSpace(line)) != "second line" {
		t.Fatalf("unexpected second line result: line=%q dropped=%v err=%v", line, dropped, err)
	}

	if _, _, err = readMCPLine(reader); err != io.EOF {
		t.Fatalf("expected io.EOF at end of input, got %v", err)
	}
}

func TestReadMCPLineOversizedDropped(t *testing.T) {
	huge := strings.Repeat("x", maxMCPLineBytes+1024) + "\n" + "{\"ok\":true}\n"
	reader := bufio.NewReaderSize(strings.NewReader(huge), 64*1024)

	line, dropped, err := readMCPLine(reader)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !dropped || line != nil {
		t.Fatalf("expected oversized line to be dropped, got line=%d bytes dropped=%v", len(line), dropped)
	}

	line, dropped, err = readMCPLine(reader)
	if err != nil || dropped || string(bytes.TrimSpace(line)) != "{\"ok\":true}" {
		t.Fatalf("expected recovery after oversized line, got line=%q dropped=%v err=%v", line, dropped, err)
	}
}

func TestNotificationReceivesNoResponse(t *testing.T) {
	req := JSONRPCRequest{JSONRPC: "2.0", Method: "notifications/initialized", Params: map[string]interface{}{}}
	out := captureStdout(t, func() {
		handleMCPRequest(&req)
	})
	if out != "" {
		t.Fatalf("notifications must not receive a response, got: %q", out)
	}

	unknownNote := JSONRPCRequest{JSONRPC: "2.0", Method: "notifications/something_else"}
	out = captureStdout(t, func() {
		handleMCPRequest(&unknownNote)
	})
	if out != "" {
		t.Fatalf("unknown notifications must be ignored, got: %q", out)
	}
}

func TestUnknownMethodReturns32601(t *testing.T) {
	req := JSONRPCRequest{JSONRPC: "2.0", ID: float64(7), Method: "does/not/exist"}
	out := captureStdout(t, func() {
		handleMCPRequest(&req)
	})

	var resp map[string]interface{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &resp); err != nil {
		t.Fatalf("invalid JSON-RPC response %q: %v", out, err)
	}
	errObj, _ := resp["error"].(map[string]interface{})
	if errObj == nil || errObj["code"].(float64) != -32601 {
		t.Fatalf("expected -32601 method not found response, got: %s", out)
	}
}

func TestToolsCallMissingRequiredIsError(t *testing.T) {
	req := JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      float64(11),
		Method:  "tools/call",
		Params: map[string]interface{}{
			"name":      "browser_open_tab",
			"arguments": map[string]interface{}{},
		},
	}
	out := captureStdout(t, func() {
		handleMCPRequest(&req)
	})

	var resp struct {
		Result struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &resp); err != nil {
		t.Fatalf("invalid response %q: %v", out, err)
	}
	if !resp.Result.IsError || len(resp.Result.Content) == 0 || !strings.Contains(resp.Result.Content[0].Text, "missing required parameter") {
		t.Fatalf("expected missing-parameter error result, got: %s", out)
	}
}

func TestToolsListDoesNotDispatch(t *testing.T) {
	req := JSONRPCRequest{JSONRPC: "2.0", ID: float64(3), Method: "tools/list"}
	out := captureStdout(t, func() {
		handleMCPRequest(&req)
	})
	if !strings.Contains(out, "browser_run_actions") {
		t.Fatalf("expected tools/list to return the registry, got: %s", out)
	}
}
