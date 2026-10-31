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

	"github.com/ducconit/agent-pilot/cli/config"
	"github.com/ducconit/agent-pilot/cli/version"
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

	root5 := newRootCommand()
	root5.SetArgs([]string{"open", "https://example.com", "--context", "ctx-123", "--isolated", "iso-name", "--headless", "--port", strconv.Itoa(port)})
	err5 := root5.Execute()

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
	if err5 != nil {
		t.Fatalf("open --context --isolated --headless command failed: %v", err5)
	}
	if len(received) != 5 {
		t.Fatalf("expected 5 bridge requests, got %d", len(received))
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

	req5Params, _ := received[4]["params"].(map[string]interface{})
	if received[4]["method"] != "tabs.create" ||
		req5Params["contextId"] != "ctx-123" ||
		req5Params["isolatedContext"] != "iso-name" ||
		req5Params["headless"] != true {
		t.Fatalf("unexpected open --context --isolated --headless request: %#v", received[4])
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

func TestOpenWithTabFlagCloseMultipleAndTabsAliases(t *testing.T) {
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
		params, _ := req["params"].(map[string]interface{})
		switch method {
		case "tabs.listAll":
			_, _ = w.Write([]byte(`{"success":true,"result":[{"tabId":1734693240,"title":"Tab A","url":"https://jenkins.sphoton.com/a","active":true},{"tabId":1734693246,"title":"Tab B","url":"https://jenkins.sphoton.com/b","active":false}]}`))
		case "tabs.remove":
			tid := params["tabId"]
			if tid == float64(999999) {
				_, _ = w.Write([]byte(`{"success":false,"error":"Tab #999999 not found"}`))
				return
			}
			_, _ = fmt.Fprintf(w, `{"success":true,"result":{"success":true,"closedTabId":%v}}`, tid)
		case "page.screenshot":
			_, _ = w.Write([]byte(`{"success":true,"result":{"dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==","annotated":true}}`))
		default:
			_, _ = w.Write([]byte(`{"success":true,"result":{"id":1734693237,"title":"Jenkins","url":"https://jenkins.sphoton.com/job/Dulichso/configure"}}`))
		}
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

	runCmd := func(args ...string) (string, error) {
		oldStdout := os.Stdout
		rPipe, wPipe, err := os.Pipe()
		if err != nil {
			t.Fatalf("os.Pipe: %v", err)
		}
		os.Stdout = wPipe
		root := newRootCommand()
		root.SetArgs(normalizeLegacyFlags(append(args, "--port", strconv.Itoa(port))))
		execErr := root.Execute()
		_ = wPipe.Close()
		os.Stdout = oldStdout
		var buf bytes.Buffer
		_, _ = io.Copy(&buf, rPipe)
		return buf.String(), execErr
	}

	// 1. `open <url> --tab <id>` dispatches `tabs.update` on that tab instead of leaking a new tab
	outOpen, err := runCmd("open", "https://jenkins.sphoton.com/job/Dulichso/configure", "--tab", "1734693237")
	if err != nil {
		t.Fatalf("open --tab failed: %v", err)
	}
	if !strings.Contains(outOpen, "[Tab #1734693237]") {
		t.Fatalf("expected [Tab #1734693237] tag in open output, got: %s", outOpen)
	}
	if len(received) != 1 || received[0]["method"] != "tabs.update" {
		t.Fatalf("expected open --tab to dispatch tabs.update, got: %#v", received)
	}
	openParams, _ := received[0]["params"].(map[string]interface{})
	if openParams["tabId"] != float64(1734693237) || openParams["url"] != "https://jenkins.sphoton.com/job/Dulichso/configure" {
		t.Fatalf("unexpected open --tab params: %#v", openParams)
	}

	// 2. `list` and `ls` aliases work for `tabs`
	outList, err := runCmd("list")
	if err != nil {
		t.Fatalf("agent-pilot list alias failed: %v", err)
	}
	if !strings.Contains(outList, "[Tab #1734693240]") || !strings.Contains(outList, "[Tab #1734693246]") {
		t.Fatalf("unexpected list output: %s", outList)
	}

	// 3. `close <id1> <id2>` closes multiple tabs in order and deduplicates
	received = nil
	outCloseMulti, err := runCmd("close", "1734693240", "1734693246", "1734693240")
	if err != nil {
		t.Fatalf("close multiple tab IDs failed: %v", err)
	}
	if len(received) != 2 || received[0]["method"] != "tabs.remove" || received[1]["method"] != "tabs.remove" {
		t.Fatalf("expected 2 deduplicated tabs.remove calls, got %d: %#v", len(received), received)
	}
	if !strings.Contains(outCloseMulti, "[Tab #1734693240]") || !strings.Contains(outCloseMulti, "[Tab #1734693246]") {
		t.Fatalf("expected closed tab tags in output, got: %s", outCloseMulti)
	}

	// 4. `close --all` queries tabs.listAll and closes every open tab in the group
	received = nil
	if _, err := runCmd("close", "--all"); err != nil {
		t.Fatalf("close --all failed: %v", err)
	}
	if len(received) != 3 || received[0]["method"] != "tabs.listAll" || received[1]["method"] != "tabs.remove" || received[2]["method"] != "tabs.remove" {
		t.Fatalf("expected tabs.listAll + 2 tabs.remove calls for close --all, got: %#v", received)
	}

	// 5. `close <id1> <missing_id> <id3>` continues past failing tab and aggregates error
	received = nil
	outPartial, partialErr := runCmd("close", "1734693240", "999999", "1734693246")
	if partialErr == nil || !strings.Contains(partialErr.Error(), "Tab #999999 not found") {
		t.Fatalf("expected aggregated error for missing tab 999999, got: %v", partialErr)
	}
	if len(received) != 3 {
		t.Fatalf("expected all 3 tabs.remove calls to be attempted despite middle failure, got %d", len(received))
	}
	if !strings.Contains(outPartial, "[Tab #1734693240]") || !strings.Contains(outPartial, "[Tab #1734693246]") {
		t.Fatalf("expected both valid tabs to be closed and printed, got: %s", outPartial)
	}

	// 6. `key` supports multi-key sequences (positional and comma-separated), --delay, --repeat, and preserves literal "," / "Ctrl+,"
	received = nil
	outKeys, err := runCmd("key", "Ctrl+a", "Ctrl+v, 1, 2, 3", "Enter", "--delay", "25", "--repeat", "2", "--selector", "#otp", "--tab", "1734693237")
	if err != nil {
		t.Fatalf("multi-key command failed: %v", err)
	}
	if len(received) != 1 || received[0]["method"] != "page.pressKey" {
		t.Fatalf("expected 1 page.pressKey call, got: %#v", received)
	}
	keyParams, _ := received[0]["params"].(map[string]interface{})
	rawKeys, ok := keyParams["keys"].([]interface{})
	if !ok || len(rawKeys) != 6 {
		t.Fatalf("expected 6 expanded keys in params['keys'], got: %#v", keyParams["keys"])
	}
	wantKeys := []string{"Ctrl+a", "Ctrl+v", "1", "2", "3", "Enter"}
	for i, w := range wantKeys {
		if rawKeys[i] != w {
			t.Fatalf("key[%d] = %v, want %s", i, rawKeys[i], w)
		}
	}
	if keyParams["delayMs"] != float64(25) || keyParams["repeat"] != float64(2) || keyParams["selector"] != "#otp" {
		t.Fatalf("unexpected key params: %#v", keyParams)
	}
	if !strings.Contains(outKeys, "Ctrl+a, Ctrl+v, 1, 2, 3, Enter") {
		t.Fatalf("expected sequence summary in key output, got: %s", outKeys)
	}

	expandedLiteralComma := expandKeyArgs([]string{",", "Ctrl+,"})
	if len(expandedLiteralComma) != 2 || expandedLiteralComma[0] != "," || expandedLiteralComma[1] != "Ctrl+," {
		t.Fatalf("expandKeyArgs failed to preserve literal comma / Ctrl+,: %#v", expandedLiteralComma)
	}

	// 7. `screenshot` forwards repeatable --arrow, --callout, --badge, --box, --circle, --icon, --redact, and --spotlight flags
	received = nil
	tmpShot := t.TempDir() + "/guide.png"
	_, err = runCmd(
		"screenshot", "-o", tmpShot,
		"--badge", "1:@1:Nhập Email",
		"--badge", "2:@2:Nhập Mật khẩu",
		"--arrow", "@1->@2|cyan:Tiếp",
		"--callout", "@3:Bấm Đăng nhập|green|top",
		"--box", "#err|red|dashed:Lỗi",
		"--circle", "#bell|amber",
		"--icon", "check:@1",
		"--icon", "click:@3",
		"--redact", "#token",
		"--spotlight",
		"--tab", "1734693237",
	)
	if err != nil {
		t.Fatalf("screenshot with rich annotations failed: %v", err)
	}
	if len(received) != 1 || received[0]["method"] != "page.screenshot" {
		t.Fatalf("expected 1 page.screenshot call, got: %#v", received)
	}
	shotParams, _ := received[0]["params"].(map[string]interface{})
	badgesSlice, _ := shotParams["badges"].([]interface{})
	iconsSlice, _ := shotParams["icons"].([]interface{})
	if len(badgesSlice) != 2 || len(iconsSlice) != 2 || shotParams["spotlight"] != true {
		t.Fatalf("unexpected screenshot annotation params: %#v", shotParams)
	}
}
