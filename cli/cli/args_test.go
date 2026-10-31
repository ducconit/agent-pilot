package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ducconit/agent-pilot/cli/config"
)

func TestParseBusyArgs_Default(t *testing.T) {
	isBusy, action, tab, err := ParseBusyArgs([]string{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !isBusy {
		t.Errorf("expected isBusy=true by default, got false")
	}
	if action != "AI Agent đang thao tác..." {
		t.Errorf("expected default action description, got: %s", action)
	}
	if tab != nil {
		t.Errorf("expected tab=nil, got: %v", tab)
	}
}

func TestParseBusyArgs_PositionalFirst(t *testing.T) {
	// e.g. agent-pilot busy on --action "Loading page" --tab 42
	isBusy, action, tab, err := ParseBusyArgs([]string{"on", "--action", "Loading page", "--tab", "42"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !isBusy {
		t.Errorf("expected isBusy=true, got false")
	}
	if action != "Loading page" {
		t.Errorf("expected action 'Loading page', got: %s", action)
	}
	if tab != 42 {
		t.Errorf("expected tab=42, got: %v", tab)
	}
}

func TestParseBusyArgs_PositionalLast(t *testing.T) {
	// e.g. agent-pilot busy --tab 100 --action "Typing" off
	isBusy, action, tab, err := ParseBusyArgs([]string{"--tab", "100", "--action", "Typing", "off"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if isBusy {
		t.Errorf("expected isBusy=false, got true")
	}
	if action != "Typing" {
		t.Errorf("expected action 'Typing', got: %s", action)
	}
	if tab != 100 {
		t.Errorf("expected tab=100, got: %v", tab)
	}
}

func TestParseBusyArgs_Aliases(t *testing.T) {
	cases := []struct {
		val      string
		expected bool
	}{
		{"false", false},
		{"0", false},
		{"off", false},
		{"true", true},
		{"1", true},
		{"on", true},
	}

	for _, c := range cases {
		isBusy, _, _, err := ParseBusyArgs([]string{c.val})
		if err != nil {
			t.Fatalf("unexpected error for %s: %v", c.val, err)
		}
		if isBusy != c.expected {
			t.Errorf("for %s expected isBusy=%v, got %v", c.val, c.expected, isBusy)
		}
	}
}

func TestParseBusyArgs_ActionValueIsStateKeyword(t *testing.T) {
	// e.g. agent-pilot busy --action "on" off
	isBusy, action, tab, err := ParseBusyArgs([]string{"--action", "on", "off"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if isBusy {
		t.Errorf("expected isBusy=false, got true")
	}
	if action != "on" {
		t.Errorf("expected action 'on', got: %s", action)
	}
	if tab != nil {
		t.Errorf("expected tab=nil, got: %v", tab)
	}
}

func TestParseSessionArgs_Default(t *testing.T) {
	subcmd, name, tab, err := ParseSessionArgs([]string{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if subcmd != "start" {
		t.Errorf("expected default subcmd='start', got: %s", subcmd)
	}
	if name != "AI Agent Session" {
		t.Errorf("expected default name='AI Agent Session', got: %s", name)
	}
	if tab != nil {
		t.Errorf("expected tab=nil, got: %v", tab)
	}
}

func TestParseSessionArgs_EndAndStatus(t *testing.T) {
	subcmd, _, tab, err := ParseSessionArgs([]string{"end", "--tab", "42"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if subcmd != "end" {
		t.Errorf("expected subcmd='end', got: %s", subcmd)
	}
	if tab != 42 {
		t.Errorf("expected tab=42, got: %v", tab)
	}

	subcmd2, _, _, err2 := ParseSessionArgs([]string{"status"})
	if err2 != nil {
		t.Fatalf("unexpected error: %v", err2)
	}
	if subcmd2 != "status" {
		t.Errorf("expected subcmd='status', got: %s", subcmd2)
	}
}

func TestParseSessionArgs_CustomName(t *testing.T) {
	subcmd, name, tab, err := ParseSessionArgs([]string{"start", "--name", "Checkout Flow Regression", "--tab", "101"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if subcmd != "start" {
		t.Errorf("expected subcmd='start', got: %s", subcmd)
	}
	if name != "Checkout Flow Regression" {
		t.Errorf("expected name='Checkout Flow Regression', got: %s", name)
	}
	if tab != 101 {
		t.Errorf("expected tab=101, got: %v", tab)
	}
}

func TestParseEvalArgs(t *testing.T) {
	// 1. Positional script with --tab after
	script, tab, err := parseEvalArgs([]string{"document.title", "--tab", "42"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if script != "document.title" {
		t.Errorf("expected script='document.title', got: %s", script)
	}
	if tab != 42 {
		t.Errorf("expected tab=42, got: %v", tab)
	}

	// 2. --tab before positional script
	script, tab, err = parseEvalArgs([]string{"--tab", "100", "window.location.href"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if script != "window.location.href" {
		t.Errorf("expected script='window.location.href', got: %s", script)
	}
	if tab != 100 {
		t.Errorf("expected tab=100, got: %v", tab)
	}

	// 3. -f file argument
	tmpFile := t.TempDir() + "/test_script.js"
	if err := os.WriteFile(tmpFile, []byte("console.log('hello from file')"), 0644); err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	script, tab, err = parseEvalArgs([]string{"-f", tmpFile, "--tab", "77"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if script != "console.log('hello from file')" {
		t.Errorf("expected script content from file, got: %s", script)
	}
	if tab != 77 {
		t.Errorf("expected tab=77, got: %v", tab)
	}

	// 4. Empty arguments error
	_, _, err = parseEvalArgs([]string{})
	if err == nil {
		t.Errorf("expected error for empty args, got nil")
	}

	// 5. parseEvalArgsWithOptions with --arg, --args, and -o
	outPath := t.TempDir() + "/eval_out.json"
	script, tab, extra, err := parseEvalArgsWithOptions([]string{
		"(el, label) => el.id + ':' + label",
		"--arg", "@1",
		"--args", `["primary"]`,
		"-o", outPath,
		"--tab", "55",
	})
	if err != nil {
		t.Fatalf("parseEvalArgsWithOptions failed: %v", err)
	}
	if script != "(el, label) => el.id + ':' + label" {
		t.Errorf("unexpected script: %s", script)
	}
	if tab != 55 {
		t.Errorf("expected tab=55, got %v", tab)
	}
	if extra["filePath"] != outPath {
		t.Errorf("expected filePath=%s, got %v", outPath, extra["filePath"])
	}
	evalArgs, ok := extra["args"].([]interface{})
	if !ok || len(evalArgs) != 2 || evalArgs[0] != "@1" || evalArgs[1] != "primary" {
		t.Errorf("unexpected extra[args]: %#v", extra["args"])
	}
}

func TestParseFillArgs(t *testing.T) {
	tmpJSON := t.TempDir() + "/fields.json"
	jsonContent := `[{"selector":"#email","value":"test@example.com"},{"selector":"#pass","value":"secret123"}]`
	if err := os.WriteFile(tmpJSON, []byte(jsonContent), 0644); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}

	// 1. Positional file first, flags after (the documented CLI usage: agent-pilot fill form.json --submit "#btn-submit")
	fields, submit, enter, tab, err := parseFillArgs([]string{tmpJSON, "--submit", "#btn-submit", "--tab", "42", "--enter"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(fields) != 2 {
		t.Errorf("expected 2 fields, got %d", len(fields))
	}
	if submit != "#btn-submit" {
		t.Errorf("expected submit='#btn-submit', got %s", submit)
	}
	if !enter {
		t.Errorf("expected enter=true, got false")
	}
	if tab != 42 {
		t.Errorf("expected tab=42, got %v", tab)
	}

	// 2. Flags first, positional file after
	fields, submit, enter, tab, err = parseFillArgs([]string{"--tab", "99", "--submit", "@5", tmpJSON})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(fields) != 2 {
		t.Errorf("expected 2 fields, got %d", len(fields))
	}
	if submit != "@5" {
		t.Errorf("expected submit='@5', got %s", submit)
	}
	if tab != 99 {
		t.Errorf("expected tab=99, got %v", tab)
	}

	// 3. Raw JSON string directly
	fields, submit, _, _, err = parseFillArgs([]string{`[{"selector":"#q","value":"search term"}]`, "--submit", "#search-btn"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(fields) != 1 || fields[0]["value"] != "search term" {
		t.Errorf("unexpected fields from inline JSON: %v", fields)
	}
	if submit != "#search-btn" {
		t.Errorf("expected submit='#search-btn', got %s", submit)
	}

	// 4. Missing arguments error
	_, _, _, _, err = parseFillArgs([]string{})
	if err == nil {
		t.Errorf("expected error for empty args, got nil")
	}

	// 5. Invalid JSON error
	_, _, _, _, err = parseFillArgs([]string{"invalid-not-json"})
	if err == nil {
		t.Errorf("expected error for invalid JSON string, got nil")
	}
}

func TestParseWaitArgs(t *testing.T) {
	// 1. Selector only
	sel, text, state, timeout, tab, err := parseWaitArgs([]string{"#submit"})
	if err != nil || sel != "#submit" || text != "" || state != "visible" || timeout != 10000 || tab != nil {
		t.Fatalf("case 1 failed: sel=%s, text=%s, err=%v", sel, text, err)
	}

	// 2. Multi-word text without flags
	sel, text, state, timeout, tab, err = parseWaitArgs([]string{"Quan trắc môi trường"})
	if err != nil || sel != "" || text != "Quan trắc môi trường" || state != "visible" || timeout != 10000 || tab != nil {
		t.Fatalf("case 2 failed: sel=%s, text=%s, err=%v", sel, text, err)
	}

	// 3. Ref selector with flags after
	sel, text, state, timeout, tab, err = parseWaitArgs([]string{"@18", "--tab", "123", "--timeout", "3000"})
	if err != nil || sel != "@18" || text != "" || timeout != 3000 || tab != 123 {
		t.Fatalf("case 3 failed: sel=%s, timeout=%d, tab=%v, err=%v", sel, timeout, tab, err)
	}

	// 4. Flags before positional
	sel, text, state, timeout, tab, err = parseWaitArgs([]string{"--timeout", "5000", "--tab", "456", "#my-btn"})
	if err != nil || sel != "#my-btn" || timeout != 5000 || tab != 456 {
		t.Fatalf("case 4 failed: sel=%s, timeout=%d, tab=%v, err=%v", sel, timeout, tab, err)
	}

	// 5. Explicit --text flag
	sel, text, state, timeout, tab, err = parseWaitArgs([]string{"--text", "Save Changes", "--state", "attached"})
	if err != nil || sel != "" || text != "Save Changes" || state != "attached" {
		t.Fatalf("case 5 failed: text=%s, state=%s, err=%v", text, state, err)
	}

	// 6. Text first with flags after (previously broken by standard flag.Parse)
	sel, text, state, timeout, tab, err = parseWaitArgs([]string{"Quan trắc", "--timeout", "3000", "--tab", "1734673232"})
	if err != nil || sel != "" || text != "Quan trắc" || timeout != 3000 || tab != 1734673232 {
		t.Fatalf("case 6 failed: sel=%s, text=%s, timeout=%d, tab=%v, err=%v", sel, text, timeout, tab, err)
	}

	// 7. Empty args waits for document readyState with default timeout
	sel, text, state, timeout, tab, err = parseWaitArgs([]string{})
	if err != nil || sel != "" || text != "" || state != "visible" || timeout != 10000 || tab != nil {
		t.Fatalf("case 7 (empty args readyState wait) failed: sel=%s, text=%s, state=%s, timeout=%d, err=%v", sel, text, state, timeout, err)
	}

	// 7b. Numeric positional argument triggers sleep mode
	sel, text, state, timeout, tab, err = parseWaitArgs([]string{"1500", "--tab", "12"})
	if err != nil || sel != "" || text != "" || state != "sleep" || timeout != 1500 || tab != 12 {
		t.Fatalf("case 7b (numeric sleep) failed: sel=%s, text=%s, state=%s, timeout=%d, tab=%v, err=%v", sel, text, state, timeout, tab, err)
	}

	// 7c. Explicit --sleep / --ms flag triggers sleep mode
	sel, text, state, timeout, tab, err = parseWaitArgs([]string{"--ms", "2500"})
	if err != nil || sel != "" || text != "" || state != "sleep" || timeout != 2500 {
		t.Fatalf("case 7c (--ms sleep) failed: state=%s, timeout=%d, err=%v", state, timeout, err)
	}

	// 8. Negative test: invalid timeout string
	_, _, _, _, _, err = parseWaitArgs([]string{"#btn", "--timeout", "invalid"})
	if err == nil {
		t.Fatalf("expected error for invalid timeout string, got nil")
	}

	// 9. Negative test: non-positive timeout
	_, _, _, _, _, err = parseWaitArgs([]string{"#btn", "--timeout", "-100"})
	if err == nil {
		t.Fatalf("expected error for negative timeout, got nil")
	}

	// 10. Negative test: invalid tab string
	_, _, _, _, _, err = parseWaitArgs([]string{"#btn", "--tab", "not-a-number"})
	if err == nil {
		t.Fatalf("expected error for invalid tab string, got nil")
	}

	// Negative tab IDs identify tabs in isolated browser contexts.
	_, _, _, _, tab, err = parseWaitArgs([]string{"#btn", "--tab", "-5"})
	if err != nil || tab != -5 {
		t.Fatalf("expected isolated tab -5, got %v, error %v", tab, err)
	}

	// 13. Dash-leading text value (e.g. -Loading)
	sel, text, state, timeout, tab, err = parseWaitArgs([]string{"--text", "-Loading"})
	if err != nil || text != "-Loading" {
		t.Fatalf("case 13 failed: text=%s, err=%v", text, err)
	}

	// 14. Negative test: unknown flag should be rejected
	_, _, _, _, _, err = parseWaitArgs([]string{"#submit", "--ta", "42"})
	if err == nil {
		t.Fatalf("expected error for unknown flag --ta, got nil")
	}
}

func TestExecScreenshotWithOptions_ClipValidation(t *testing.T) {
	// 1. Invalid part count
	err := ExecScreenshotWithOptions("region", "", "10,20,30", "", nil)
	if err == nil || !strings.Contains(err.Error(), "expected 'x,y,width,height'") {
		t.Fatalf("expected part count error, got: %v", err)
	}

	// 2. Non-numeric coordinate
	err = ExecScreenshotWithOptions("region", "", "10,abc,30,40", "", nil)
	if err == nil || !strings.Contains(err.Error(), "invalid clip y coordinate") {
		t.Fatalf("expected non-numeric y error, got: %v", err)
	}

	// 3. Zero or negative width
	err = ExecScreenshotWithOptions("region", "", "10,20,0,40", "", nil)
	if err == nil || !strings.Contains(err.Error(), "width and height must be > 0") {
		t.Fatalf("expected dimensions > 0 error, got: %v", err)
	}
}

func TestExtractBridgePort(t *testing.T) {
	args, port, _, err := extractBridgeOptions([]string{"https://example.test", "--bridge-port", "58766", "--format", "json"})
	if err != nil {
		t.Fatalf("extractBridgeOptions failed: %v", err)
	}
	if port != 58766 {
		t.Fatalf("port = %d, want 58766", port)
	}
	if len(args) != 3 || args[1] != "--format" || args[2] != "json" {
		t.Fatalf("filtered args = %#v", args)
	}

	_, _, _, err = extractBridgeOptions([]string{"--bridge-port=invalid"})
	if err == nil {
		t.Fatal("expected invalid bridge port to fail")
	}
}

func TestExtractBridgePortSupportsPortAlias(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want int
	}{
		{name: "long alias", args: []string{"--port", "58767", "tabs"}, want: 58767},
		{name: "equals alias", args: []string{"--port=58768", "#app"}, want: 58768},
		{name: "legacy single dash alias", args: []string{"-port", "58769", "#app"}, want: 58769},
		{name: "legacy equals alias", args: []string{"-port=58770", "#app"}, want: 58770},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args, port, _, err := extractBridgeOptions(tt.args)
			if err != nil {
				t.Fatalf("extractBridgeOptions failed: %v", err)
			}
			if port != tt.want {
				t.Fatalf("port = %d, want %d", port, tt.want)
			}
			if len(args) != 1 || args[0] != tt.args[len(tt.args)-1] {
				t.Fatalf("filtered args = %#v", args)
			}
		})
	}
}

func TestExplicitPortOverrideWinsForBrowserCommand(t *testing.T) {
	t.Setenv("AGENT_PILOT_PORT", "58765")
	t.Cleanup(func() { _ = config.SetBridgePortOverride(0) })

	args, port, _, err := extractBridgeOptions([]string{"--port", "58766", "tabs"})
	if err != nil {
		t.Fatalf("extractBridgeOptions failed: %v", err)
	}
	if len(args) != 1 || args[0] != "tabs" {
		t.Fatalf("filtered args = %#v", args)
	}
	if err := config.SetBridgePortOverride(port); err != nil {
		t.Fatalf("SetBridgePortOverride failed: %v", err)
	}
	if got := config.DefaultBridgePort(); got != 58766 {
		t.Fatalf("selected bridge port = %d, want 58766", got)
	}
}

func TestTabsCommandUsesExplicitPortAlias(t *testing.T) {
	requests := make(chan map[string]interface{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		requests <- request
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"result":[]}`))
	}))
	defer server.Close()

	serverURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	port, err := strconv.Atoi(serverURL.Port())
	if err != nil {
		t.Fatalf("parse test server port: %v", err)
	}

	t.Setenv("AGENT_PILOT_PORT", "1")
	_ = config.SetBridgePortOverride(0)
	t.Cleanup(func() { _ = config.SetBridgePortOverride(0) })

	root := newRootCommand()
	root.SetArgs([]string{"tabs", "--port", strconv.Itoa(port), "--instance-id", "browser-test"})
	if err := root.Execute(); err != nil {
		t.Fatalf("tabs command failed: %v", err)
	}

	select {
	case request := <-requests:
		if request["method"] != "tabs.listAll" {
			t.Fatalf("method = %v, want tabs.listAll", request["method"])
		}
		params, ok := request["params"].(map[string]interface{})
		if !ok || params["instanceId"] != "browser-test" {
			t.Fatalf("params instanceId = %#v, want browser-test", params["instanceId"])
		}
	case <-time.After(time.Second):
		t.Fatal("tabs command did not reach the explicitly selected bridge port")
	}
}

func TestApplyInlineWaitAndNegativePositionalArgs(t *testing.T) {
	// 1. Flags after positional arguments with inline wait
	cmdArgs, err := parseCmdArgs(
		[]string{"#search", "hello world", "--clear", "--enter", "--wait", "250ms", "--wait-for", ".results", "--wait-text", "Found", "--tab", "99"},
		withInlineWaitFlags(
			FlagDef{Name: "tab", Aliases: []string{"t"}},
			FlagDef{Name: "clear", IsBool: true},
			FlagDef{Name: "enter", IsBool: true},
		),
	)
	if err != nil {
		t.Fatalf("unexpected parseCmdArgs error: %v", err)
	}
	if len(cmdArgs.Positional) != 2 || cmdArgs.Positional[0] != "#search" || cmdArgs.Positional[1] != "hello world" {
		t.Fatalf("unexpected positional args: %v", cmdArgs.Positional)
	}
	if !cmdArgs.Bool("clear") || !cmdArgs.Bool("enter") {
		t.Fatalf("expected clear=true and enter=true")
	}
	extra := map[string]interface{}{}
	if err := cmdArgs.ApplyInlineWait(extra); err != nil {
		t.Fatalf("unexpected ApplyInlineWait error: %v", err)
	}
	if extra["waitMs"] != 250 || extra["waitForSelector"] != ".results" || extra["waitForText"] != "Found" {
		t.Fatalf("unexpected inline wait extra map: %v", extra)
	}

	// 2. Negative numeric positional argument (e.g. agent-pilot scroll -300 --tab 42)
	scrollArgs, err := parseCmdArgs(
		[]string{"-300", "--tab", "42"},
		withInlineWaitFlags(FlagDef{Name: "tab", Aliases: []string{"t"}}),
	)
	if err != nil {
		t.Fatalf("expected negative number to be accepted as positional arg, got err: %v", err)
	}
	if len(scrollArgs.Positional) != 1 || scrollArgs.Positional[0] != "-300" {
		t.Fatalf("expected positional '-300', got: %v", scrollArgs.Positional)
	}

	// 3. WebAuthn --verified alias for --user-verified
	webauthnArgs, err := parseCmdArgs(
		[]string{"verify", "--id", "auth-1", "--verified=true", "--tab", "123"},
		[]FlagDef{
			{Name: "action", Aliases: []string{"a"}},
			{Name: "authenticator-id", Aliases: []string{"id", "auth-id"}},
			{Name: "user-verified", Aliases: []string{"verified"}},
			{Name: "tab", Aliases: []string{"t"}},
		},
	)
	if err != nil {
		t.Fatalf("unexpected parseCmdArgs error for webauthn --verified: %v", err)
	}
	if webauthnArgs.Flags["user-verified"] != "true" || webauthnArgs.Flags["authenticator-id"] != "auth-1" {
		t.Fatalf("unexpected webauthn flags: %#v", webauthnArgs.Flags)
	}
}
