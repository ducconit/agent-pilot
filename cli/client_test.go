package main

import (
	"encoding/json"
	"os"
	"testing"
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

func TestMCPToolsRegistry(t *testing.T) {
	expectedCount := 35
	if len(mcpTools) != expectedCount {
		t.Fatalf("expected %d tools, got %d", expectedCount, len(mcpTools))
	}

	requiredTools := []string{
		"browser_run_actions", "browser_open_tab", "browser_list_tabs", "browser_navigate",
		"browser_click", "browser_type", "browser_scroll", "browser_snapshot", "browser_fill_form",
		"browser_get_element", "browser_screenshot", "browser_get_devtools_data", "browser_pick_color",
		"browser_list_instances", "browser_select_instance", "browser_set_busy", "browser_start_session",
		"browser_end_session", "browser_get_pending_feedback", "browser_wait_for_feedback", "browser_evaluate",
		"browser_upload_file", "browser_handle_dialog", "browser_hover", "browser_drag",
		"browser_press_key", "browser_wait_for", "browser_emulate", "browser_resize_page",
		"browser_list_network_requests", "browser_get_network_request", "browser_performance_trace",
		"browser_performance_metrics", "browser_take_heapsnapshot", "browser_manage_extensions",
	}

	toolMap := make(map[string]ToolInfo)
	for _, tool := range mcpTools {
		if tool.Name == "" {
			t.Errorf("found tool with empty name")
		}
		if tool.Description == "" {
			t.Errorf("tool %s has empty description", tool.Name)
		}
		if tool.InputSchema == nil {
			t.Errorf("tool %s has nil inputSchema", tool.Name)
		}
		toolMap[tool.Name] = tool
	}

	for _, name := range requiredTools {
		if _, ok := toolMap[name]; !ok {
			t.Errorf("missing expected tool: %s", name)
		}
	}

	// Test ExportMCPSchemas to temp dir
	tmpDir := t.TempDir() + "/mcp_test"
	if err := ExportMCPSchemas(tmpDir); err != nil {
		t.Fatalf("ExportMCPSchemas failed: %v", err)
	}

	for _, name := range requiredTools {
		schemaPath := tmpDir + "/" + name + ".json"
		data, err := os.ReadFile(schemaPath)
		if err != nil {
			t.Errorf("failed to read exported schema for %s: %v", name, err)
			continue
		}
		var parsed map[string]interface{}
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Errorf("exported schema for %s is invalid JSON: %v", name, err)
		}
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

	// 7. Empty args should return error
	_, _, _, _, _, err = parseWaitArgs([]string{})
	if err == nil {
		t.Fatalf("expected error for empty args, got nil")
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

	// 11. Negative test: non-positive tab ID
	_, _, _, _, _, err = parseWaitArgs([]string{"#btn", "--tab", "-5"})
	if err == nil {
		t.Fatalf("expected error for negative tab ID, got nil")
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

func TestDeriveCommandTimeout(t *testing.T) {
	// 1. Default timeout fallback
	to := DeriveCommandTimeout("page.click", nil, 0)
	if to != 15000 {
		t.Errorf("expected 15000, got %d", to)
	}

	// 2. Custom default timeout
	to = DeriveCommandTimeout("page.click", nil, 5000)
	if to != 5000 {
		t.Errorf("expected 5000, got %d", to)
	}

	// 3. batch.run base minimum 300,000ms (5 minutes)
	to = DeriveCommandTimeout("batch.run", nil, 10000)
	if to != 300000 {
		t.Errorf("expected 300000, got %d", to)
	}

	// 4. page.waitFor with explicit timeoutMs (int)
	to = DeriveCommandTimeout("page.waitFor", map[string]interface{}{"timeoutMs": 20000}, 0)
	if to != 25000 {
		t.Errorf("expected 25000, got %d", to)
	}

	// 5. page.waitFor with explicit timeoutMs (float64 from JSON)
	to = DeriveCommandTimeout("page.waitFor", map[string]interface{}{"timeoutMs": float64(12000)}, 15000)
	if to != 17000 {
		t.Errorf("expected 17000, got %d", to)
	}

	// 6. page.waitFor with timeout alias (int)
	to = DeriveCommandTimeout("page.waitFor", map[string]interface{}{"timeout": 60000}, 0)
	if to != 65000 {
		t.Errorf("expected 65000, got %d", to)
	}

	// 7. batch.run dynamically scaled based on actions
	longBatch := map[string]interface{}{
		"actions": []interface{}{
			map[string]interface{}{"type": "wait", "ms": 200000},
			map[string]interface{}{"type": "sleep", "duration": 200000},
		},
	}
	to = DeriveCommandTimeout("batch.run", longBatch, 0)
	if to != 460000 {
		t.Errorf("expected 460000, got %d", to)
	}

	// 8. batch.run with wait_for_selector timeout > 5m
	selectorWaitBatch := map[string]interface{}{
		"actions": []interface{}{
			map[string]interface{}{"type": "wait_for_selector", "selector": "#long-task", "timeout": 400000},
		},
	}
	to = DeriveCommandTimeout("batch.run", selectorWaitBatch, 0)
	if to != 460000 {
		t.Errorf("expected 460000, got %d", to)
	}

	// 9. batch.run with wait on selector timeout > 5m
	waitSelectorBatch := map[string]interface{}{
		"actions": []interface{}{
			map[string]interface{}{"type": "wait", "selector": ".ready", "timeoutMs": 350000},
		},
	}
	to = DeriveCommandTimeout("batch.run", waitSelectorBatch, 0)
	if to != 410000 {
		t.Errorf("expected 410000, got %d", to)
	}

	// 10. batch.run with navigation loadTimeout and aliases
	navBatch := map[string]interface{}{
		"actions": []interface{}{
			map[string]interface{}{"type": "tabs.update", "url": "https://example.com", "loadTimeout": 400000},
			map[string]interface{}{"type": "tabs.create", "url": "https://example.com/2", "loadTimeout": 200000},
		},
	}
	to = DeriveCommandTimeout("batch.run", navBatch, 0)
	if to != 660000 {
		t.Errorf("expected 660000, got %d", to)
	}
}

func TestBuildClickParams(t *testing.T) {
	// 1. selector only -> synthetic default (no via key)
	p, err := BuildClickParams("#btn", 0, 0, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p["selector"] != "#btn" {
		t.Errorf("expected selector, got %v", p)
	}
	if _, ok := p["via"]; ok {
		t.Errorf("synthetic default should not send via, got %v", p["via"])
	}

	// 2. coordinates + via cdp
	p, err = BuildClickParams("", 733, 668, "cdp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p["x"] != 733.0 || p["y"] != 668.0 {
		t.Errorf("expected coordinates, got %v", p)
	}
	if p["via"] != "cdp" {
		t.Errorf("expected via=cdp, got %v", p["via"])
	}

	// 3. unknown via falls back to synthetic (omitted)
	p, err = BuildClickParams("#btn", 0, 0, "banana")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := p["via"]; ok {
		t.Errorf("invalid via should normalize to synthetic, got %v", p["via"])
	}

	// 4. neither selector nor coords -> error
	if _, err = BuildClickParams("", 0, 0, "cdp"); err == nil {
		t.Error("expected error when no selector and no coordinates")
	}
}

func TestBuildDragParams(t *testing.T) {
	// 1. selector form keeps legacy payload
	p, err := BuildDragParams("#a", "#b", -1, -1, -1, -1, 8, 0, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p["from"] != "#a" || p["to"] != "#b" {
		t.Errorf("expected selectors, got %v", p)
	}
	if p["steps"] != 8 {
		t.Errorf("expected steps=8, got %v", p["steps"])
	}
	if _, ok := p["via"]; ok {
		t.Errorf("synthetic default should not send via")
	}

	// 2. coordinate form with via cdp + hold
	p, err = BuildDragParams("", "", 745, 490, 745, 832, 10, 800, "cdp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p["fromX"] != 745.0 || p["fromY"] != 490.0 || p["toX"] != 745.0 || p["toY"] != 832.0 {
		t.Errorf("expected coordinates, got %v", p)
	}
	if p["holdMs"] != 800 {
		t.Errorf("expected holdMs=800, got %v", p["holdMs"])
	}
	if p["via"] != "cdp" {
		t.Errorf("expected via=cdp, got %v", p["via"])
	}

	// 3. partial coordinates -> error
	if _, err = BuildDragParams("", "", 745, -1, 745, 832, 10, 0, "cdp"); err == nil {
		t.Error("expected error for partial coordinates")
	}

	// 4. no selectors and no coords -> error
	if _, err = BuildDragParams("", "", -1, -1, -1, -1, 8, 0, ""); err == nil {
		t.Error("expected error when nothing is provided")
	}

	// 5. via auto is preserved
	p, err = BuildDragParams("#a", "#b", -1, -1, -1, -1, 8, 0, "auto")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p["via"] != "auto" {
		t.Errorf("expected via=auto, got %v", p["via"])
	}
}
