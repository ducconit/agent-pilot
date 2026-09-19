// mcp_dispatch.go maps MCP tool calls onto bridge commands and formats the
// result envelope returned to the client (plain text + isError flag).

package mcp

import (
	"encoding/json"
	"fmt"

	"github.com/ducconit/agent-pilot/cli/internal/bridge"
	"github.com/ducconit/agent-pilot/cli/internal/config"
	"github.com/ducconit/agent-pilot/cli/internal/feedback"
)

func executeToolCall(name string, args map[string]interface{}) (string, bool) {
	// Map MCP tool name to bridge action
	switch name {
	case "browser_run_actions":
		res, err := bridge.DispatchCommand("batch.run", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_open_tab":
		res, err := bridge.DispatchCommand("tabs.create", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_list_tabs":
		res, err := bridge.DispatchCommand("tabs.listAll", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_navigate":
		res, err := bridge.DispatchCommand("tabs.update", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_click":
		res, err := bridge.DispatchCommand("page.click", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_type":
		res, err := bridge.DispatchCommand("page.type", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_scroll":
		res, err := bridge.DispatchCommand("page.scroll", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_snapshot":
		res, err := bridge.DispatchCommand("page.snapshot", args, config.DefaultBridgePort())
		if err != nil {
			return fmt.Sprintf("Error: %v", err), true
		}
		if str, ok := res.(string); ok {
			return str, false
		}
		return formatToolResult(res, nil)

	case "browser_fill_form":
		res, err := bridge.DispatchCommand("page.fillForm", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_get_element":
		res, err := bridge.DispatchCommand("page.getElement", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_screenshot":
		res, err := bridge.DispatchCommand("page.screenshot", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_get_devtools_data":
		res, err := bridge.DispatchCommand("devtools.getData", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_pick_color":
		res, err := bridge.DispatchCommand("page.pickColor", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_list_instances":
		res, err := bridge.DispatchCommand("instances.list", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_select_instance":
		res, err := bridge.DispatchCommand("instances.select", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_set_busy":
		res, err := bridge.DispatchCommand("page.setBusy", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_start_session":
		res, err := bridge.DispatchCommand("session.start", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_end_session":
		res, err := bridge.DispatchCommand("session.end", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_get_pending_feedback":
		limit := config.DefaultFeedbackListLimit
		if l, ok := args["limit"].(float64); ok {
			limit = int(l)
		}
		sid, _ := args["sessionId"].(string)
		clear, _ := args["clear"].(bool)
		res, err := feedback.GetPendingFeedback(limit, sid, clear)
		return formatToolResult(res, err)

	case "browser_wait_for_feedback":
		timeout := config.DefaultFeedbackTimeoutSec
		if t, ok := args["timeout"].(float64); ok {
			timeout = int(t)
		}
		res := feedback.WaitForFeedback(timeout, args["tabId"])
		return formatToolResult(res, nil)

	case "browser_evaluate":
		res, err := bridge.DispatchCommand("page.evaluate", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_upload_file":
		res, err := bridge.DispatchCommand("page.uploadFile", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_handle_dialog":
		res, err := bridge.DispatchCommand("page.handleDialog", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_hover":
		res, err := bridge.DispatchCommand("page.hover", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_drag":
		res, err := bridge.DispatchCommand("page.drag", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_press_key":
		res, err := bridge.DispatchCommand("page.pressKey", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_wait_for":
		res, err := bridge.DispatchCommand("page.waitFor", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_emulate":
		res, err := bridge.DispatchCommand("emulation.set", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_resize_page":
		res, err := bridge.DispatchCommand("emulation.resize", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_list_network_requests":
		res, err := bridge.DispatchCommand("network.listRequests", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_get_network_request":
		res, err := bridge.DispatchCommand("network.getResponseBody", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_performance_trace":
		res, err := bridge.DispatchCommand("performance.trace", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_performance_metrics":
		res, err := bridge.DispatchCommand("performance.metrics", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_take_heapsnapshot":
		if cg, ok := args["collectGarbage"].(bool); ok && cg {
			res, err := bridge.DispatchCommand("memory.collectGarbage", args, config.DefaultBridgePort())
			return formatToolResult(res, err)
		}
		res, err := bridge.DispatchCommand("memory.heapSnapshot", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_manage_extensions":
		res, err := bridge.DispatchCommand("extensions.manage", args, config.DefaultBridgePort())
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
