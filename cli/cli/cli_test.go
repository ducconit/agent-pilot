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
			_, _ = w.Write([]byte(`{"success":true,"result":{"console":[{"level":"info","text":"hello"},{"level":"error","text":"boom"}],"errors":[{"text":"uncaught boom"}]}}`))
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
	root2.SetArgs([]string{"metrics", "--gc", "--timeout", "45000", "--no-resources", "--tab", "1103687522", "--port", strconv.Itoa(port)})
	err2 := root2.Execute()

	_ = wPipe.Close()
	os.Stdout = oldStdout
	var outBuf bytes.Buffer
	_, _ = io.Copy(&outBuf, rPipe)

	if err1 != nil {
		t.Fatalf("console errors command failed: %v", err1)
	}
	if err2 != nil {
		t.Fatalf("metrics --gc --timeout command failed: %v", err2)
	}
	if len(received) != 2 {
		t.Fatalf("expected 2 bridge requests, got %d", len(received))
	}

	req1Params, _ := received[0]["params"].(map[string]interface{})
	if received[0]["method"] != "devtools.getData" || req1Params["clear"] != true || req1Params["limit"] != float64(25) {
		t.Fatalf("unexpected console request: %#v", received[0])
	}
	if !strings.Contains(outBuf.String(), `"boom"`) || strings.Contains(outBuf.String(), `"hello"`) {
		t.Fatalf("expected console errors filter to include 'boom' and exclude 'hello', got:\n%s", outBuf.String())
	}

	req2Params, _ := received[1]["params"].(map[string]interface{})
	if received[1]["method"] != "performance.metrics" ||
		req2Params["collectGarbage"] != true ||
		req2Params["timeoutMs"] != float64(45000) ||
		req2Params["includeResources"] != false {
		t.Fatalf("unexpected metrics request: %#v", received[1])
	}
}
