// mcp_dispatch.go maps MCP tool calls onto bridge commands and formats the
// result envelope returned to the client (plain text + isError flag).

package main

import (
	"encoding/json"
	"fmt"
)

func executeToolCall(name string, args map[string]interface{}) (string, bool) {
	// Map MCP tool name to bridge action
	switch name {
	case "browser_run_actions":
		res, err := DispatchCommand("batch.run", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_open_tab":
		res, err := DispatchCommand("tabs.create", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_list_tabs":
		res, err := DispatchCommand("tabs.listAll", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_navigate":
		res, err := DispatchCommand("tabs.navigate", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_click":
		res, err := DispatchCommand("page.click", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_type":
		res, err := DispatchCommand("page.type", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_scroll":
		res, err := DispatchCommand("page.scroll", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_snapshot":
		res, err := DispatchCommand("page.snapshot", args, DefaultPort)
		if err != nil {
			return fmt.Sprintf("Error: %v", err), true
		}
		if str, ok := res.(string); ok {
			return str, false
		}
		return formatToolResult(res, nil)

	case "browser_fill_form":
		res, err := DispatchCommand("page.fillForm", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_get_element":
		res, err := DispatchCommand("page.getElement", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_screenshot":
		res, err := DispatchCommand("page.screenshot", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_get_devtools_data":
		res, err := DispatchCommand("devtools.getData", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_pick_color":
		res, err := DispatchCommand("page.pickColor", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_list_instances":
		res, err := DispatchCommand("instances.list", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_select_instance":
		res, err := DispatchCommand("instances.select", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_set_busy":
		res, err := DispatchCommand("page.setBusy", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_start_session":
		res, err := DispatchCommand("session.start", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_end_session":
		res, err := DispatchCommand("session.end", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_get_pending_feedback":
		limit := defaultFeedbackListLimit
		if l, ok := args["limit"].(float64); ok {
			limit = int(l)
		}
		sid, _ := args["sessionId"].(string)
		clear, _ := args["clear"].(bool)
		res, err := GetPendingFeedback(limit, sid, clear)
		return formatToolResult(res, err)

	case "browser_wait_for_feedback":
		timeout := defaultFeedbackTimeoutSec
		if t, ok := args["timeout"].(float64); ok {
			timeout = int(t)
		}
		res := WaitForFeedback(timeout, args["tabId"])
		return formatToolResult(res, nil)

	case "browser_evaluate":
		res, err := DispatchCommand("page.evaluate", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_upload_file":
		res, err := DispatchCommand("page.uploadFile", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_handle_dialog":
		res, err := DispatchCommand("page.handleDialog", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_hover":
		res, err := DispatchCommand("page.hover", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_drag":
		res, err := DispatchCommand("page.drag", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_press_key":
		res, err := DispatchCommand("page.pressKey", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_wait_for":
		res, err := DispatchCommand("page.waitFor", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_emulate":
		res, err := DispatchCommand("emulation.set", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_resize_page":
		res, err := DispatchCommand("emulation.resize", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_list_network_requests":
		res, err := DispatchCommand("network.listRequests", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_get_network_request":
		res, err := DispatchCommand("network.getResponseBody", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_performance_trace":
		res, err := DispatchCommand("performance.trace", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_performance_metrics":
		res, err := DispatchCommand("performance.metrics", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_take_heapsnapshot":
		if cg, ok := args["collectGarbage"].(bool); ok && cg {
			res, err := DispatchCommand("memory.collectGarbage", args, DefaultPort)
			return formatToolResult(res, err)
		}
		res, err := DispatchCommand("memory.heapSnapshot", args, DefaultPort)
		return formatToolResult(res, err)

	case "browser_manage_extensions":
		res, err := DispatchCommand("extensions.manage", args, DefaultPort)
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
