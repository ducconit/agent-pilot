// mcp_dispatch.go maps MCP tool calls onto bridge commands and formats the
// result envelope returned to the client (plain text + isError flag).

package mcp

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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
	mcpScreenshotSeq     int64
)

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
	if _, hasHint := cloned["agentLastTabId"]; !hasHint && lastTabID > 0 {
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
	if tabID <= 0 {
		tabID = extractPositiveInt(resMap["tabId"])
	}
	if tabID > 0 {
		mcpSessionMu.Lock()
		mcpSessionLastTabID = tabID
		mcpSessionMu.Unlock()
	}
}

func recordSessionClosedTab(res interface{}, requestedTab interface{}) {
	closedID := extractPositiveInt(requestedTab)
	if resMap, ok := res.(map[string]interface{}); ok {
		if cid := extractPositiveInt(resMap["closedTabId"]); cid > 0 {
			closedID = cid
		} else if tid := extractPositiveInt(resMap["tabId"]); tid > 0 {
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
		if tid := extractPositiveInt(stepMap["tabId"]); tid > 0 {
			mcpSessionLastTabID = tid
		}
		if closedID := extractPositiveInt(stepMap["closedTabId"]); closedID > 0 && mcpSessionLastTabID == closedID {
			mcpSessionLastTabID = 0
		}
	}
}

func executeToolCall(name string, rawArgs map[string]interface{}) (string, bool) {
	args := prepareSessionArgs(rawArgs)

	// Map MCP tool name to bridge action
	switch name {
	case "browser_run_actions":
		res, err := bridge.DispatchCommand("batch.run", args, config.DefaultBridgePort())
		if err == nil {
			recordSessionBatchOutcome(res)
		}
		return formatToolResult(res, err)

	case "browser_open_tab":
		res, err := bridge.DispatchCommand("tabs.create", args, config.DefaultBridgePort())
		if err == nil {
			recordSessionOpenedTab(res)
		}
		return formatToolResult(res, err)

	case "browser_close_tab":
		res, err := bridge.DispatchCommand("tabs.remove", args, config.DefaultBridgePort())
		if err == nil {
			recordSessionClosedTab(res, args["tabId"])
		}
		return formatToolResult(res, err)

	case "browser_list_tabs":
		res, err := bridge.DispatchCommand("tabs.listAll", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_navigate":
		res, err := bridge.DispatchCommand("tabs.update", args, config.DefaultBridgePort())
		if err == nil {
			recordSessionOpenedTab(res)
		}
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
		return processScreenshotResult(res, err, args)

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
		if err == nil {
			if instID, ok := args["instanceId"].(string); ok && instID != "" {
				mcpSessionMu.Lock()
				mcpSessionInstanceID = instID
				mcpSessionMu.Unlock()
			}
		}
		return formatToolResult(res, err)

	case "browser_set_busy":
		res, err := bridge.DispatchCommand("page.setBusy", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_start_session":
		res, err := bridge.DispatchCommand("session.start", args, config.DefaultBridgePort())
		return formatToolResult(res, err)

	case "browser_end_session":
		res, err := bridge.DispatchCommand("session.end", args, config.DefaultBridgePort())
		if err == nil {
			if closeTab, _ := args["closeTab"].(bool); closeTab {
				recordSessionClosedTab(res, args["tabId"])
			}
		}
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
		if filesRaw, ok := args["files"].([]interface{}); ok {
			for _, f := range filesRaw {
				if fStr, ok := f.(string); ok {
					if err := validateMCPUploadPath(fStr); err != nil {
						return fmt.Sprintf("Error: %v", err), true
					}
				}
			}
		} else if fStr, ok := args["filePath"].(string); ok && fStr != "" {
			if err := validateMCPUploadPath(fStr); err != nil {
				return fmt.Sprintf("Error: %v", err), true
			}
		}
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

func validateMCPUploadPath(p string) error {
	clean := filepath.ToSlash(filepath.Clean(p))
	if abs, err := filepath.Abs(p); err == nil {
		clean = filepath.ToSlash(abs)
	}
	lower := strings.ToLower(clean)
	for _, sub := range []string{
		"/.ssh/", "/.aws/", "/.gnupg/", "/.kube/", "/.config/gcloud/",
		"/etc/shadow", "/etc/passwd", "/etc/gshadow", "/proc/", "/sys/",
	} {
		if strings.Contains(lower, sub) {
			return fmt.Errorf("refusing to upload sensitive system/credential file %q", p)
		}
	}
	return nil
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

	outputPath := pathParam
	if outputPath != "" {
		cleanPath := filepath.Clean(outputPath)
		ext := strings.ToLower(filepath.Ext(cleanPath))
		if ext != ".png" && ext != ".jpg" && ext != ".jpeg" && ext != ".webp" {
			return fmt.Sprintf("Error: unsupported screenshot file extension %q (allowed: .png, .jpg, .jpeg, .webp)", ext), true
		}

		checkPath := cleanPath
		if absCheck, absErr := filepath.Abs(cleanPath); absErr == nil {
			checkPath = filepath.ToSlash(absCheck)
		}

		// Guard against sensitive system paths and directory traversal into restricted areas
		for _, forbidden := range []string{"/etc", "/proc", "/sys", "/dev", "/boot", "/root"} {
			if checkPath == forbidden || strings.HasPrefix(checkPath, forbidden+"/") ||
				cleanPath == forbidden || strings.HasPrefix(cleanPath, forbidden+"/") {
				return fmt.Sprintf("Error: writing to sensitive system path %q is not permitted", cleanPath), true
			}
		}
		if strings.Contains(checkPath, ".ssh") || strings.Contains(checkPath, "authorized_keys") ||
			strings.HasSuffix(checkPath, ".bashrc") || strings.HasSuffix(checkPath, ".zshrc") ||
			strings.HasSuffix(checkPath, ".profile") {
			return fmt.Sprintf("Error: writing to sensitive user configuration %q is not permitted", cleanPath), true
		}
		outputPath = cleanPath
	} else {
		seq := atomic.AddInt64(&mcpScreenshotSeq, 1)
		outputPath = filepath.Join(os.TempDir(), fmt.Sprintf("screenshot_%d_%d_%d.png", time.Now().UnixMilli(), os.Getpid(), seq))
	}

	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return "Error: invalid screenshot dataUrl format", true
	}

	imgBytes, b64Err := base64.StdEncoding.DecodeString(parts[1])
	if b64Err != nil {
		return fmt.Sprintf("Error: failed to decode base64 screenshot: %v", b64Err), true
	}

	if dir := filepath.Dir(outputPath); dir != "" && dir != "." {
		if mkErr := os.MkdirAll(dir, 0755); mkErr != nil {
			return fmt.Sprintf("Error: failed to create directory %s: %v", dir, mkErr), true
		}
	}

	if writeErr := os.WriteFile(outputPath, imgBytes, 0644); writeErr != nil {
		return fmt.Sprintf("Error: failed to write screenshot to %s: %v", outputPath, writeErr), true
	}

	absPath, absErr := filepath.Abs(outputPath)
	if absErr != nil {
		return fmt.Sprintf("Error: failed to resolve absolute path for %s: %v", outputPath, absErr), true
	}

	result := make(map[string]interface{})
	for k, v := range resMap {
		if k != "dataUrl" {
			result[k] = v
		}
	}
	result["path"] = absPath
	result["bytes"] = len(imgBytes)
	if includeBase64 {
		result["dataUrl"] = dataURL
	}

	return formatToolResult(result, nil)
}
