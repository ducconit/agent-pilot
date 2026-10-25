package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/ducconit/agent-pilot-extension/cli/config"
	"github.com/ducconit/agent-pilot-extension/cli/version"
)

func TestNormalizeJSONNumbersForDisplay_AvoidsScientificNotationForLargeTabID(t *testing.T) {
	raw := map[string]interface{}{
		"tabId": float64(1103687522),
		"cls":   float64(0.25),
		"nested": []interface{}{
			float64(1734672950),
			float64(3.14),
		},
	}

	formatted := fmt.Sprintf("%v", normalizeJSONNumbersForDisplay(raw))
	if strings.Contains(formatted, "1.103687522e+09") || strings.Contains(formatted, "e+09") {
		t.Fatalf("expected integer formatting without scientific notation, got: %s", formatted)
	}
	if !strings.Contains(formatted, "1103687522") || !strings.Contains(formatted, "1734672950") {
		t.Fatalf("expected exact integer tab IDs in formatted output, got: %s", formatted)
	}
	if !strings.Contains(formatted, "0.25") || !strings.Contains(formatted, "3.14") {
		t.Fatalf("expected fractional floats to remain preserved, got: %s", formatted)
	}
}

func TestParseEvalArgsWithTimeout(t *testing.T) {
	script, tab, timeoutMs, err := parseEvalArgsWithTimeout([]string{"window.__stress()", "--tab", "1103687522", "--timeout", "45000"})
	if err != nil {
		t.Fatalf("parseEvalArgsWithTimeout failed: %v", err)
	}
	if script != "window.__stress()" {
		t.Fatalf("script = %q, want window.__stress()", script)
	}
	if tab != 1103687522 {
		t.Fatalf("tab = %v, want 1103687522", tab)
	}
	if timeoutMs != 45000 {
		t.Fatalf("timeoutMs = %d, want 45000", timeoutMs)
	}
}

func TestConsoleAndMetricsCommandsDispatchExpectedPayloads(t *testing.T) {
	var received []map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		received = append(received, req)
		w.Header().Set("Content-Type", "application/json")
		method, _ := req["method"].(string)
		if method == "devtools.getData" {
			_, _ = w.Write([]byte(`{"success":true,"result":{"console":[{"type":"info","text":"hello"},{"type":"error","text":"boom"}]}}`))
			return
		}
		_, _ = w.Write([]byte(`{"success":true,"result":{"success":true,"tabId":1103687522,"garbageCollected":true}}`))
	}))
	defer server.Close()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse server url: %v", err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parse port: %v", err)
	}
	t.Cleanup(func() { _ = config.SetBridgePortOverride(0) })

	oldStdout := os.Stdout
	rPipe, wPipe, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdout = wPipe

	root1 := newRootCommand()
	root1.SetArgs([]string{"console", "errors", "--limit", "25", "--clear", "--tab", "1103687522", "--port", strconv.Itoa(port)})
	err1 := root1.Execute()

	root2 := newRootCommand()
	root2.SetArgs([]string{"metrics", "--gc", "--bring-to-front", "--timeout", "45000", "--no-resources", "--tab", "1103687522", "--port", strconv.Itoa(port)})
	err2 := root2.Execute()

	root3 := newRootCommand()
	root3.SetArgs([]string{"navigate", "http://localhost:5173/products", "--tab", "1103687583", "--port", strconv.Itoa(port)})
	err3 := root3.Execute()

	root4 := newRootCommand()
	root4.SetArgs([]string{"network", "--headers", "--limit", "15", "--tab", "1103687583", "--port", strconv.Itoa(port)})
	err4 := root4.Execute()

	_ = wPipe.Close()
	os.Stdout = oldStdout
	var outBuf bytes.Buffer
	_, _ = io.Copy(&outBuf, rPipe)

	if err1 != nil {
		t.Fatalf("console errors command failed: %v", err1)
	}
	if err2 != nil {
		t.Fatalf("metrics --gc --bring-to-front --timeout command failed: %v", err2)
	}
	if err3 != nil {
		t.Fatalf("navigate <url> --tab command failed: %v", err3)
	}
	if err4 != nil {
		t.Fatalf("network --headers command failed: %v", err4)
	}
	if len(received) != 4 {
		t.Fatalf("expected 4 bridge requests, got %d", len(received))
	}

	req1Params, _ := received[0]["params"].(map[string]interface{})
	if received[0]["method"] != "devtools.getData" ||
		req1Params["type"] != "console" ||
		req1Params["errorsOnly"] != true ||
		req1Params["clear"] != true ||
		req1Params["limit"] != float64(25) {
		t.Fatalf("unexpected console request: %#v", received[0])
	}
	if !strings.Contains(outBuf.String(), `"boom"`) || strings.Contains(outBuf.String(), `"hello"`) {
		t.Fatalf("expected console errors filter to include 'boom' and exclude 'hello', got:\n%s", outBuf.String())
	}

	req2Params, _ := received[1]["params"].(map[string]interface{})
	if received[1]["method"] != "performance.metrics" ||
		req2Params["collectGarbage"] != true ||
		req2Params["bringToFront"] != true ||
		req2Params["timeoutMs"] != float64(45000) ||
		req2Params["includeResources"] != false {
		t.Fatalf("unexpected metrics request: %#v", received[1])
	}

	req3Params, _ := received[2]["params"].(map[string]interface{})
	if received[2]["method"] != "tabs.update" ||
		req3Params["url"] != "http://localhost:5173/products" ||
		req3Params["tabId"] != float64(1103687583) {
		t.Fatalf("unexpected navigate request (expected tabId=1103687583 after positional URL): %#v", received[2])
	}

	req4Params, _ := received[3]["params"].(map[string]interface{})
	if received[3]["method"] != "network.listRequests" ||
		req4Params["includeHeaders"] != true ||
		req4Params["limit"] != float64(15) ||
		req4Params["tabId"] != float64(1103687583) {
		t.Fatalf("unexpected network --headers request: %#v", received[3])
	}
}

func TestVersionCommandAndFlags(t *testing.T) {
	origVer, origCommit, origDate := version.Version, version.Commit, version.Date
	version.Version = "1.0.14-beta"
	version.Commit = "543152d"
	version.Date = "2026-10-25T15:18:10Z"
	t.Cleanup(func() {
		version.Version = origVer
		version.Commit = origCommit
		version.Date = origDate
	})

	runCapture := func(args ...string) (string, error) {
		oldStdout := os.Stdout
		rPipe, wPipe, err := os.Pipe()
		if err != nil {
			t.Fatalf("os.Pipe: %v", err)
		}
		os.Stdout = wPipe
		root := newRootCommand()
		root.SetArgs(normalizeLegacyFlags(args))
		execErr := root.Execute()
		_ = wPipe.Close()
		os.Stdout = oldStdout
		var buf bytes.Buffer
		_, _ = io.Copy(&buf, rPipe)
		return strings.TrimSpace(buf.String()), execErr
	}

	wantFull := "Agent Pilot CLI v1.0.14-beta (543152d, 2026-10-25T15:18:10Z)"
	for _, flagArgs := range [][]string{{"version"}, {"-v"}, {"--version"}, {"-version"}} {
		out, err := runCapture(flagArgs...)
		if err != nil {
			t.Fatalf("args %v failed: %v", flagArgs, err)
		}
		if out != wantFull {
			t.Fatalf("args %v output = %q, want %q", flagArgs, out, wantFull)
		}
	}

	shortOut, err := runCapture("version", "--short")
	if err != nil {
		t.Fatalf("version --short failed: %v", err)
	}
	if shortOut != "v1.0.14-beta" {
		t.Fatalf("version --short = %q, want v1.0.14-beta", shortOut)
	}

	jsonOut, err := runCapture("version", "--json")
	if err != nil {
		t.Fatalf("version --json failed: %v", err)
	}
	var parsed map[string]string
	if err := json.Unmarshal([]byte(jsonOut), &parsed); err != nil {
		t.Fatalf("unmarshal version --json: %v (raw: %s)", err, jsonOut)
	}
	if parsed["version"] != "1.0.14-beta" || parsed["display"] != "v1.0.14-beta" || parsed["commit"] != "543152d" {
		t.Fatalf("unexpected version --json payload: %#v", parsed)
	}
}
