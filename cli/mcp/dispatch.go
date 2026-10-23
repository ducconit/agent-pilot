// mcp_dispatch.go maps MCP tool calls onto bridge commands and formats the
// result envelope returned to the client (plain text + isError flag).

package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ducconit/agent-pilot-extension/cli/bridge"
	"github.com/ducconit/agent-pilot-extension/cli/config"
	"github.com/ducconit/agent-pilot-extension/cli/feedback"
)

var (
	mcpSessionMu         sync.Mutex
	mcpSessionAgentID    = fmt.Sprintf("mcp_%d_%d", os.Getpid(), time.Now().UnixNano())
	mcpSessionLastTabID  int
	mcpSessionInstanceID string
)

func mcpSessionInstance() string {
	mcpSessionMu.Lock()
	defer mcpSessionMu.Unlock()
	return mcpSessionInstanceID
}

func prepareSessionArgs(raw map[string]interface{}) map[string]interface{} {
	cloned := make(map[string]interface{}, len(raw)+3)
	for k, v := range raw {
		cloned[k] = v
	}

	mcpSessionMu.Lock()
	agentID := mcpSessionAgentID
	lastTabID := mcpSessionLastTabID
	instanceID := mcpSessionInstanceID
	mcpSessionMu.Unlock()

	if _, hasAgent := cloned["agentId"]; !hasAgent && agentID != "" {
		cloned["agentId"] = agentID
	}
	if _, hasHint := cloned["agentLastTabId"]; !hasHint && lastTabID != 0 {
		cloned["agentLastTabId"] = lastTabID
	}
	if _, hasInst := cloned["instanceId"]; !hasInst && instanceID != "" {
		cloned["instanceId"] = instanceID
	}
	return cloned
}

func extractPositiveInt(val interface{}) int {
	switch v := val.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return parsed
		}
	}
	return 0
}

func recordSessionOpenedTab(res interface{}) {
	resMap, ok := res.(map[string]interface{})
	if !ok {
		return
	}
	tabID := extractPositiveInt(resMap["id"])
	if tabID == 0 {
		tabID = extractPositiveInt(resMap["tabId"])
	}
	if tabID != 0 {
		mcpSessionMu.Lock()
		mcpSessionLastTabID = tabID
		mcpSessionMu.Unlock()
	}
}

func recordSessionClosedTab(res interface{}, requestedTab interface{}) {
	closedID := extractPositiveInt(requestedTab)
	if resMap, ok := res.(map[string]interface{}); ok {
		if cid := extractPositiveInt(resMap["closedTabId"]); cid != 0 {
			closedID = cid
		} else if tid := extractPositiveInt(resMap["tabId"]); tid != 0 {
			closedID = tid
		}
	}
	mcpSessionMu.Lock()
	if closedID == 0 || mcpSessionLastTabID == closedID {
		mcpSessionLastTabID = 0
	}
	mcpSessionMu.Unlock()
}

func recordSessionBatchOutcome(res interface{}) {
	resMap, ok := res.(map[string]interface{})
	if !ok {
		return
	}
	steps, ok := resMap["results"].([]interface{})
	if !ok {
		return
	}
	mcpSessionMu.Lock()
	defer mcpSessionMu.Unlock()
	for _, rawStep := range steps {
		stepMap, ok := rawStep.(map[string]interface{})
		if !ok {
			continue
		}
		if tid := extractPositiveInt(stepMap["tabId"]); tid != 0 {
			mcpSessionLastTabID = tid
		}
		if closedID := extractPositiveInt(stepMap["closedTabId"]); closedID != 0 && mcpSessionLastTabID == closedID {
			mcpSessionLastTabID = 0
		}
	}
}

// mcpToolBridgeMap maps 1-to-1 pass-through MCP tool names onto their
// corresponding bridge command names (Table-Driven Command Registry).
var mcpToolBridgeMap = map[string]string{
	"browser_get_css_styles":              "css.getStyles",
	"browser_lighthouse_audit":            "lighthouse.audit",
	"browser_lighthouse_analyze_audit":    "lighthouse.analyze",
	"browser_performance_analyze_insight": "performance.analyzeInsight",
	"browser_screencast_start":            "screencast.record",
	"browser_screencast_stop":             "screencast.record",
	"browser_create_context":              "contexts.create",
	"browser_list_contexts":               "contexts.list",
	"browser_close_context":               "contexts.close",
	"browser_service_workers":             "workers.debug",
	"browser_accessibility_snapshot":      "accessibility.snapshot",
	"browser_devtools_status":             "devtools.runtime",
	"browser_heap_capability":             "memory.heapCapability",
	"browser_analyze_heapsnapshot":        "memory.analyzeSnapshot",
	"browser_list_3p_developer_tools":     "developerTools.list",
	"browser_execute_3p_developer_tool":   "developerTools.execute",
	"browser_list_webmcp_tools":           "webmcp.list",
	"browser_execute_webmcp_tool":         "webmcp.execute",
	"browser_get_os_app_state":            "pwa.getOsAppState",
	"browser_install_pwa":                 "pwa.install",
	"browser_launch_pwa":                  "pwa.launch",
	"browser_uninstall_pwa":               "pwa.uninstall",
	"browser_webauthn":                    "webauthn.manage",
	"browser_list_tabs":                   "tabs.listAll",
	"browser_click":                       "page.click",
	"browser_type":                        "page.type",
	"browser_scroll":                      "page.scroll",
	"browser_fill_form":                   "page.fillForm",
	"browser_get_element":                 "page.getElement",
	"browser_get_devtools_data":           "devtools.getData",
	"browser_pick_color":                  "page.pickColor",
	"browser_list_instances":              "instances.list",
	"browser_set_busy":                    "page.setBusy",
	"browser_start_session":               "session.start",
	"browser_evaluate":                    "page.evaluate",
	"browser_handle_dialog":               "page.handleDialog",
	"browser_hover":                       "page.hover",
	"browser_drag":                        "page.drag",
	"browser_press_key":                   "page.pressKey",
	"browser_wait_for":                    "page.waitFor",
	"browser_emulate":                     "emulation.set",
	"browser_resize_page":                 "emulation.resize",
	"browser_list_network_requests":       "network.listRequests",
	"browser_get_network_request":         "network.getResponseBody",
	"browser_performance_trace":           "performance.trace",
	"browser_performance_metrics":         "performance.metrics",
	"browser_manage_extensions":           "extensions.manage",
	"browser_recorder_start":              "flow.record",
	"browser_recorder_stop":               "flow.record",
	"browser_recorder_state":              "flow.state",
	"browser_recorder_replay":             "flow.replay",
	"browser_recorder_export":             "flow.export",
	"browser_recorder_import":             "flow.import",
	"browser_recorder_edit":               "flow.edit",
	"browser_recorder_clear":              "flow.clear",
}

func executeToolCall(name string, rawArgs map[string]interface{}) (string, bool) {
	args := prepareSessionArgs(rawArgs)
	port := BridgePort()
	if name == "browser_recorder_measure" {
		if !bridge.ValidRecorderMeasureTabID(args["tabId"]) {
			return `Error: browser_recorder_measure requires a positive integer tabId`, true
		}
		measureResult, measureErr := bridge.RunRecorderMeasure(args["tabId"], args, port, bridge.DispatchCommand)
		return formatRecorderMeasureResult(measureResult, measureErr)
	}
	if name == "browser_screencast_start" {
		args["action"] = "start"
	}
	if name == "browser_screencast_stop" {
		args["action"] = "stop"
	}
	if name == "browser_recorder_start" {
		args["enabled"] = true
	}
	if name == "browser_recorder_stop" {
		args["enabled"] = false
	}

	if bridgeMethod, ok := mcpToolBridgeMap[name]; ok {
		if name == "browser_evaluate" {
			if err := bridge.EnrichEvaluateArgs(args); err != nil {
				return fmt.Sprintf("Error: %v", err), true
			}
			expr, _ := args["expression"].(string)
			script, _ := args["script"].(string)
			code, _ := args["code"].(string)
			if strings.TrimSpace(expr) == "" && strings.TrimSpace(script) == "" && strings.TrimSpace(code) == "" {
				return `Error: missing required parameter "expression" or "script" for tool "browser_evaluate"`, true
			}
		}
		res, err := bridge.DispatchCommand(bridgeMethod, args, port)
		if name == "browser_evaluate" && err == nil {
			res, err = bridge.ProcessEvaluateResult(res, args)
		}
		if strings.HasPrefix(name, "browser_recorder_") {
			return formatRecorderToolResult(res, err)
		}
		return formatToolResult(res, err)
	}

	switch name {
	case "browser_run_actions":
		if err := bridge.EnrichBatchUploadArgs(args); err != nil {
			return fmt.Sprintf("Error: %v", err), true
		}
		res, err := bridge.DispatchCommand("batch.run", args, port)
		if err == nil {
			recordSessionBatchOutcome(res)
			res, err = bridge.ProcessBatchScreenshots(res)
		}
		return formatToolResult(res, err)

	case "browser_open_tab":
		res, err := bridge.DispatchCommand("tabs.create", args, port)
		if err == nil {
			recordSessionOpenedTab(res)
		}
		return formatToolResult(res, err)

	case "browser_close_tab":
		res, err := bridge.DispatchCommand("tabs.remove", args, port)
		if err == nil {
			recordSessionClosedTab(res, args["tabId"])
		}
		return formatToolResult(res, err)

	case "browser_navigate":
		navAction, _ := args["action"].(string)
		navAction = strings.ToLower(strings.TrimSpace(navAction))
		urlStr, _ := args["url"].(string)
		if (navAction == "" || navAction == "url") && strings.TrimSpace(urlStr) == "" {
			return `Error: missing required parameter "url" for tool "browser_navigate" when action is "url"`, true
		}
		res, err := bridge.DispatchCommand("tabs.update", args, port)
		if err == nil {
			recordSessionOpenedTab(res)
		}
		return formatToolResult(res, err)

	case "browser_select_instance":
		res, err := bridge.DispatchCommand("instances.select", args, port)
		if err == nil {
			if instID, ok := args["instanceId"].(string); ok && instID != "" {
				mcpSessionMu.Lock()
				mcpSessionInstanceID = instID
				mcpSessionMu.Unlock()
			}
		}
		return formatToolResult(res, err)

	case "browser_end_session":
		res, err := bridge.DispatchCommand("session.end", args, port)
		if err == nil {
			if closeTab, _ := args["closeTab"].(bool); closeTab {
				recordSessionClosedTab(res, args["tabId"])
			}
		}
		return formatToolResult(res, err)

	case "browser_upload_file":
		if err := bridge.EnrichUploadArgs(args); err != nil {
			return fmt.Sprintf("Error: %v", err), true
		}
		res, err := bridge.DispatchCommand("page.uploadFile", args, port)
		return formatToolResult(res, err)

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
		action, _ := args["action"].(string)
		action = strings.ToLower(strings.TrimSpace(action))
		if action == "gc" {
			method = "memory.collectGarbage"
		}
		res, err := bridge.DispatchCommand(method, args, port)
		return formatToolResult(res, err)

	default:
		return fmt.Sprintf("Unknown tool: %s", name), true
	}
}

func formatRecorderMeasureResult(result map[string]interface{}, err error) (string, bool) {
	encoded, marshalErr := json.MarshalIndent(result, "", "  ")
	if marshalErr != nil {
		return fmt.Sprintf("Error: could not encode recorder measure result: %v", marshalErr), true
	}
	success, hasSuccess := result["success"].(bool)
	return string(encoded), err != nil || !hasSuccess || !success
}

func formatRecorderToolResult(result interface{}, err error) (string, bool) {
	if err != nil {
		return formatToolResult(result, err)
	}
	if bridge.RecorderResultFailure(result) == nil {
		return formatToolResult(result, nil)
	}
	encoded, marshalErr := json.MarshalIndent(result, "", "  ")
	if marshalErr != nil {
		return fmt.Sprintf("Error: could not encode recorder result: %v", marshalErr), true
	}
	return string(encoded), true
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

func validateMCPUploadPath(p string) error {
	_, err := bridge.ValidateUploadFilePath(p)
	return err
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
	if pathParam == "" {
		pathParam, _ = args["savePath"].(string)
	}
	if pathParam == "" {
		pathParam, _ = args["outputPath"].(string)
	}

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
