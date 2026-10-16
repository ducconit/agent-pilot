// mcp_dispatch.go maps MCP tool calls onto bridge commands and formats the
// result envelope returned to the client (plain text + isError flag).

package mcp

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/ducconit/agent-pilot-extension/cli/bridge"
	"github.com/ducconit/agent-pilot-extension/cli/config"
	"github.com/ducconit/agent-pilot-extension/cli/feedback"
)

// mcpToolBridgeMap maps 1-to-1 pass-through MCP tool names onto their
// corresponding bridge command names (Table-Driven Command Registry).
var mcpToolBridgeMap = map[string]string{
	"browser_run_actions":           "batch.run",
	"browser_open_tab":              "tabs.create",
	"browser_list_tabs":             "tabs.listAll",
	"browser_navigate":              "tabs.update",
	"browser_click":                 "page.click",
	"browser_type":                  "page.type",
	"browser_scroll":                "page.scroll",
	"browser_fill_form":             "page.fillForm",
	"browser_get_element":           "page.getElement",
	"browser_get_devtools_data":     "devtools.getData",
	"browser_pick_color":            "page.pickColor",
	"browser_list_instances":        "instances.list",
	"browser_select_instance":       "instances.select",
	"browser_set_busy":              "page.setBusy",
	"browser_start_session":         "session.start",
	"browser_end_session":           "session.end",
	"browser_evaluate":              "page.evaluate",
	"browser_upload_file":           "page.uploadFile",
	"browser_handle_dialog":         "page.handleDialog",
	"browser_hover":                 "page.hover",
	"browser_drag":                  "page.drag",
	"browser_press_key":             "page.pressKey",
	"browser_wait_for":              "page.waitFor",
	"browser_emulate":               "emulation.set",
	"browser_resize_page":           "emulation.resize",
	"browser_list_network_requests": "network.listRequests",
	"browser_get_network_request":   "network.getResponseBody",
	"browser_performance_trace":     "performance.trace",
	"browser_performance_metrics":   "performance.metrics",
	"browser_manage_extensions":     "extensions.manage",
}

func executeToolCall(name string, args map[string]interface{}) (string, bool) {
	port := config.DefaultBridgePort()

	if bridgeMethod, ok := mcpToolBridgeMap[name]; ok {
		res, err := bridge.DispatchCommand(bridgeMethod, args, port)
		return formatToolResult(res, err)
	}

	switch name {
	case "browser_snapshot":
		res, err := bridge.DispatchCommand("page.snapshot", args, port)
		if err != nil {
			return fmt.Sprintf("Error: %v", err), true
		}
		if str, ok := res.(string); ok {
			return str, false
		}
		return formatToolResult(res, nil)

	case "browser_screenshot":
		res, err := bridge.DispatchCommand("page.screenshot", args, port)
		return processScreenshotResult(res, err, args)

	case "browser_get_pending_feedback":
		limit := config.DefaultFeedbackListLimit
		if l, ok := args["limit"].(float64); ok && l > 0 {
			limit = int(l)
		}
		sid, _ := args["sessionId"].(string)
		clear, _ := args["clear"].(bool)
		res, err := feedback.GetPendingFeedback(limit, sid, clear)
		return formatToolResult(res, err)

	case "browser_wait_for_feedback":
		timeout := config.DefaultFeedbackTimeoutSec
		if t, ok := args["timeout"].(float64); ok && t > 0 {
			timeout = int(t)
		}
		res, err := bridge.DispatchFeedbackWait(timeout, args["tabId"], port)
		return formatToolResult(res, err)

	case "browser_take_heapsnapshot":
		method := "memory.heapSnapshot"
		if cg, ok := args["collectGarbage"].(bool); ok && cg {
			method = "memory.collectGarbage"
		}
		res, err := bridge.DispatchCommand(method, args, port)
		return formatToolResult(res, err)

	default:
		return fmt.Sprintf("Unknown tool: %s", name), true
	}
}

func formatToolResult(res interface{}, err error) (string, bool) {
	if err != nil {
		return fmt.Sprintf("Error: %v", err), true
	}
	bytes, mErr := json.MarshalIndent(res, "", "  ")
	if mErr != nil {
		return fmt.Sprintf("%v", res), false
	}
	return string(bytes), false
}

func processScreenshotResult(res interface{}, err error, args map[string]interface{}) (string, bool) {
	if err != nil {
		return formatToolResult(res, err)
	}

	resMap, ok := res.(map[string]interface{})
	if !ok {
		return formatToolResult(res, nil)
	}

	dataURL, _ := resMap["dataUrl"].(string)
	if dataURL == "" {
		return formatToolResult(res, nil)
	}

	includeBase64 := false
	if b, ok := args["base64"].(bool); ok {
		includeBase64 = b
	} else if s, ok := args["base64"].(string); ok && strings.EqualFold(s, "true") {
		includeBase64 = true
	}

	pathParam, _ := args["path"].(string)

	// When base64 is requested and no file path is specified, return inline dataUrl without writing to disk
	if includeBase64 && pathParam == "" {
		return formatToolResult(res, nil)
	}

	savedPath, byteCount, saveErr := bridge.SaveScreenshotDataURL(dataURL, pathParam)
	if saveErr != nil {
		return fmt.Sprintf("Error: %v", saveErr), true
	}

	absPath, absErr := filepath.Abs(savedPath)
	if absErr != nil {
		return fmt.Sprintf("Error: failed to resolve absolute path for %s: %v", savedPath, absErr), true
	}

	result := make(map[string]interface{}, len(resMap)+2)
	for k, v := range resMap {
		if k != "dataUrl" {
			result[k] = v
		}
	}
	result["path"] = absPath
	result["bytes"] = byteCount
	if includeBase64 {
		result["dataUrl"] = dataURL
	}

	return formatToolResult(result, nil)
}
