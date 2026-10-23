package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestMCPToolsRegistry(t *testing.T) {
	expectedCount := 57
	if len(mcpTools) != expectedCount {
		t.Fatalf("expected %d tools, got %d", expectedCount, len(mcpTools))
	}

	requiredTools := []string{
		"browser_get_css_styles", "browser_lighthouse_audit", "browser_lighthouse_analyze_audit",
		"browser_performance_analyze_insight", "browser_screencast_start", "browser_screencast_stop",
		"browser_create_context", "browser_list_contexts", "browser_close_context",
		"browser_service_workers", "browser_accessibility_snapshot", "browser_devtools_status", "browser_analyze_heapsnapshot",
		"browser_list_3p_developer_tools", "browser_execute_3p_developer_tool",
		"browser_list_webmcp_tools", "browser_execute_webmcp_tool",
		"browser_get_os_app_state", "browser_install_pwa", "browser_launch_pwa", "browser_uninstall_pwa",
		"browser_run_actions", "browser_open_tab", "browser_close_tab", "browser_list_tabs", "browser_navigate",
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

	extensionTool := toolMap["browser_manage_extensions"]
	properties, _ := extensionTool.InputSchema["properties"].(map[string]interface{})
	actionSchema := fmt.Sprint(properties["action"])
	for _, action := range []string{"install", "reload", "triggerAction", "uninstall"} {
		if !strings.Contains(actionSchema, action) {
			t.Errorf("browser_manage_extensions schema missing action %q", action)
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
