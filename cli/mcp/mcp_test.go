package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/ducconit/agent-pilot-extension/cli/config"
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

	if err := validateToolArguments("browser_type", map[string]interface{}{"text": "hello"}); err != nil {
		t.Fatalf("expected browser_type with only 'text' (no selector) to pass, got: %v", err)
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
	huge := strings.Repeat("x", config.MaxMCPLineBytes+1024) + "\n" + "{\"ok\":true}\n"
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

// TestMCPToolDispatchTargetsExist guards against the class of bug where an MCP
// tool dispatching to a method the extension does not implement (e.g. a stale
// "tabs.navigate" route) silently returns "Unknown method".
func TestMCPToolDispatchTargetsExist(t *testing.T) {
	// Methods served by the Go bridge itself instead of the extension
	bridgeLocal := map[string]bool{
		"instances.list":   true,
		"instances.select": true,
	}

	// Extension handler keys: `"method": async (...)` in each handler module and
	// legacy aliases `"method": someHandlers[...]` in agent-handlers/index.js.
	handlerFiles, err := filepath.Glob(filepath.Join("..", "..", "extensions", "background", "agent-handlers", "*.js"))
	if err != nil || len(handlerFiles) == 0 {
		t.Skipf("extension handler modules not found (running outside the repo?): %v", err)
	}

	keyPattern := regexp.MustCompile(`"([a-zA-Z][a-zA-Z0-9.\-]*)"\s*:\s*(?:async\s*\(|[a-zA-Z]+Handlers\[)`)
	supported := map[string]bool{}
	for _, file := range handlerFiles {
		data, readErr := os.ReadFile(file)
		if readErr != nil {
			t.Fatalf("cannot read %s: %v", file, readErr)
		}
		for _, match := range keyPattern.FindAllStringSubmatch(string(data), -1) {
			supported[match[1]] = true
		}
	}
	if len(supported) == 0 {
		t.Fatal("no extension handler methods parsed; the handler registry format changed")
	}

	dispatchSource, err := os.ReadFile("dispatch.go")
	if err != nil {
		t.Fatalf("cannot read mcp_dispatch.go: %v", err)
	}
	targetPattern := regexp.MustCompile(`DispatchCommand\("([a-zA-Z][a-zA-Z0-9.\-]*)"`)
	targets := targetPattern.FindAllStringSubmatch(string(dispatchSource), -1)
	if len(targets) == 0 {
		t.Fatal("no DispatchCommand targets found in mcp_dispatch.go")
	}

	for _, match := range targets {
		method := match[1]
		if supported[method] || bridgeLocal[method] {
			continue
		}
		t.Errorf("MCP tool dispatches to %q, but no extension handler implements it", method)
	}
}
