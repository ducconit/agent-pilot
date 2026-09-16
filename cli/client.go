package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DispatchCommand routes the command either via local in-memory bridge or forwarder HTTP
func DispatchCommand(method string, params map[string]interface{}, port int) (interface{}, error) {
	if port <= 0 {
		port = DefaultPort
	}

	addr := fmt.Sprintf("127.0.0.1:%d", port)
	conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
	if err == nil {
		_ = conn.Close()
		// Master bridge is running on port -> forward via HTTP
		return ForwardCommandToActiveServer(method, params, port)
	}

	// Master bridge is NOT running -> start embedded bridge in background
	go func() {
		_ = StartBridgeServer(port)
	}()

	// Wait up to 1 second for server to bind
	time.Sleep(300 * time.Millisecond)

	// Now try dispatching
	return SendCommandToExtension(method, params, 15000)
}

func ExecClick(selector string, x, y float64, tabID interface{}) error {
	params := map[string]interface{}{}
	if selector != "" {
		params["selector"] = selector
	}
	if x > 0 || y > 0 {
		params["x"] = x
		params["y"] = y
	}
	if tabID != nil {
		params["tabId"] = tabID
	}

	res, err := DispatchCommand("page.click", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Clicked successfully: %v\n", res)
	return nil
}

func ExecType(selector, text string, clear, enter bool, tabID interface{}) error {
	params := map[string]interface{}{
		"selector":   selector,
		"text":       text,
		"clear":      clear,
		"pressEnter": enter,
	}
	if tabID != nil {
		params["tabId"] = tabID
	}

	res, err := DispatchCommand("page.type", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Typed text '%s' into '%s': %v\n", text, selector, res)
	return nil
}

func ExecOpen(url string, active bool) error {
	params := map[string]interface{}{
		"url":    url,
		"active": active,
	}
	res, err := DispatchCommand("tabs.create", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Opened tab: %v\n", res)
	return nil
}

func ExecNavigate(url string, tabID interface{}) error {
	params := map[string]interface{}{
		"url": url,
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("tabs.navigate", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Navigated to '%s': %v\n", url, res)
	return nil
}

func ExecScreenshot(mode, selector, outputPath string, tabID interface{}) error {
	params := map[string]interface{}{
		"mode": mode,
	}
	if selector != "" {
		params["selector"] = selector
	}
	if tabID != nil {
		params["tabId"] = tabID
	}

	res, err := DispatchCommand("page.screenshot", params, DefaultPort)
	if err != nil {
		return err
	}

	resMap, _ := res.(map[string]interface{})
	dataURL, _ := resMap["dataUrl"].(string)
	if dataURL == "" {
		return fmt.Errorf("no screenshot dataUrl returned")
	}

	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid screenshot dataUrl format")
	}

	imgBytes, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return fmt.Errorf("failed to decode base64 screenshot: %w", err)
	}

	if outputPath == "" {
		outputPath = fmt.Sprintf("screenshot_%d.png", time.Now().Unix())
	}

	_ = os.MkdirAll(filepath.Dir(outputPath), 0755)
	if err := os.WriteFile(outputPath, imgBytes, 0644); err != nil {
		return fmt.Errorf("failed to write screenshot to %s: %w", outputPath, err)
	}

	fmt.Printf("📸 Screenshot saved to %s (%d bytes)\n", outputPath, len(imgBytes))
	return nil
}

func ExecInspect(selector string, tabID interface{}) error {
	params := map[string]interface{}{
		"selector": selector,
	}
	if tabID != nil {
		params["tabId"] = tabID
	}

	res, err := DispatchCommand("page.getElement", params, DefaultPort)
	if err != nil {
		return err
	}
	resMap, _ := res.(map[string]interface{})
	fmt.Printf("🎯 Element details for '%s':\n", selector)
	for k, v := range resMap {
		fmt.Printf("  - %s: %v\n", k, v)
	}
	return nil
}

func ExecListTabs() error {
	res, err := DispatchCommand("tabs.listAll", map[string]interface{}{}, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("📑 Open Tabs:\n")
	var tabs []interface{}
	if tSlice, ok := res.([]interface{}); ok {
		tabs = tSlice
	} else if resMap, ok := res.(map[string]interface{}); ok {
		if tSlice, ok := resMap["value"].([]interface{}); ok {
			tabs = tSlice
		}
	}
	if len(tabs) > 0 {
		for i, t := range tabs {
			if tm, ok := t.(map[string]interface{}); ok {
				activeTag := ""
				if a, _ := tm["active"].(bool); a {
					activeTag = " [ACTIVE]"
				}
				tabIDStr := fmt.Sprintf("%v", tm["tabId"])
				if f, ok := tm["tabId"].(float64); ok {
					tabIDStr = fmt.Sprintf("%.0f", f)
				}
				fmt.Printf("  %d. [Tab #%s] %s%s\n     URL: %v\n", i+1, tabIDStr, tm["title"], activeTag, tm["url"])
			}
		}
	} else {
		fmt.Printf("%v\n", res)
	}
	return nil
}

func ExecBusy(busy bool, action string, tabID interface{}) error {
	params := map[string]interface{}{
		"busy": busy,
	}
	if action != "" {
		params["action"] = action
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("page.setBusy", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Agent busy indicator set to %v (%s): %v\n", busy, action, res)
	return nil
}

func ExecSession(subcmd string, name string, tabID interface{}) error {
	subcmd = strings.ToLower(strings.TrimSpace(subcmd))
	params := map[string]interface{}{}
	if tabID != nil {
		params["tabId"] = tabID
	}
	if name != "" {
		params["name"] = name
	}

	method := "session.start"
	if subcmd == "stop" || subcmd == "end" || subcmd == "off" || subcmd == "0" || subcmd == "false" {
		method = "session.end"
	} else if subcmd == "status" {
		method = "session.status"
	}

	res, err := DispatchCommand(method, params, DefaultPort)
	if err != nil {
		return err
	}
	if method == "session.start" {
		desc := name
		if desc == "" {
			desc = "Session đang hoạt động"
		}
		fmt.Printf("🚀 Agent session started: cursor and lock shield active continuously. (%s)\n", desc)
	} else if method == "session.end" {
		fmt.Printf("⏹️ Agent session ended: cursor and lock shield dismissed.\n")
	} else {
		resJSON, err := json.MarshalIndent(res, "", "  ")
		if err != nil {
			fmt.Printf("📊 Session status: %v\n", res)
		} else {
			fmt.Printf("📊 Session status:\n%s\n", string(resJSON))
		}
	}
	return nil
}

func ExecEvaluate(expression string, tabID interface{}) error {
	params := map[string]interface{}{
		"expression": expression,
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("page.evaluate", params, DefaultPort)
	if err != nil {
		return err
	}
	if res == nil {
		fmt.Println("undefined")
		return nil
	}
	switch v := res.(type) {
	case string:
		fmt.Println(v)
	case map[string]interface{}:
		jsonB, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			fmt.Printf("%v\n", v)
		} else {
			fmt.Println(string(jsonB))
		}
	case []interface{}:
		jsonB, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			fmt.Printf("%v\n", v)
		} else {
			fmt.Println(string(jsonB))
		}
	default:
		fmt.Printf("%v\n", v)
	}
	return nil
}

func ExecSnapshot(maxElements int, format string, tabID interface{}) error {
	params := map[string]interface{}{
		"maxElements": maxElements,
		"format":      format,
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("page.snapshot", params, DefaultPort)
	if err != nil {
		return err
	}
	if str, ok := res.(string); ok {
		fmt.Println(str)
		return nil
	}
	jsonB, err := json.MarshalIndent(res, "", "  ")
	if err != nil {
		fmt.Printf("%v\n", res)
	} else {
		fmt.Println(string(jsonB))
	}
	return nil
}

func ExecFillForm(fields []map[string]interface{}, submitSelector string, pressEnter bool, tabID interface{}) error {
	params := map[string]interface{}{
		"fields": fields,
	}
	if submitSelector != "" {
		params["submitSelector"] = submitSelector
	}
	if pressEnter {
		params["pressEnter"] = true
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("page.fillForm", params, DefaultPort)
	if err != nil {
		return err
	}
	jsonB, err := json.MarshalIndent(res, "", "  ")
	if err != nil {
		fmt.Printf("✅ Form filled: %v\n", res)
	} else {
		fmt.Printf("✅ Form filled:\n%s\n", string(jsonB))
	}
	return nil
}

func ExecHover(selector string, tabID interface{}) error {
	params := map[string]interface{}{
		"selector": selector,
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("page.hover", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Hovered on %s: %v\n", selector, res)
	return nil
}

func ExecDrag(fromSelector, toSelector string, steps int, tabID interface{}) error {
	params := map[string]interface{}{
		"from":  fromSelector,
		"to":    toSelector,
		"steps": steps,
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("page.drag", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Dragged %s -> %s: %v\n", fromSelector, toSelector, res)
	return nil
}

func ExecPressKey(key, selector string, tabID interface{}) error {
	params := map[string]interface{}{
		"key": key,
	}
	if selector != "" {
		params["selector"] = selector
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("page.pressKey", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Key dispatched (%s): %v\n", key, res)
	return nil
}

func ExecWaitFor(selector, text, state string, timeoutMs int, tabID interface{}) error {
	params := map[string]interface{}{}
	if selector != "" {
		params["selector"] = selector
	}
	if text != "" {
		params["text"] = text
	}
	if state != "" {
		params["state"] = state
	}
	if timeoutMs > 0 {
		params["timeoutMs"] = timeoutMs
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("page.waitFor", params, DefaultPort)
	if err != nil {
		return err
	}
	if resMap, ok := res.(map[string]interface{}); ok {
		if success, ok := resMap["success"].(bool); ok && !success {
			return fmt.Errorf("%v", resMap["error"])
		}
	}
	fmt.Printf("✅ Wait successful: %v\n", res)
	return nil
}

func ExecUploadFile(selector string, files []string, tabID interface{}) error {
	params := map[string]interface{}{
		"selector": selector,
		"files":    files,
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("page.uploadFile", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Files uploaded to %s: %v\n", selector, res)
	return nil
}

func ExecHandleDialog(accept bool, promptText string, tabID interface{}) error {
	params := map[string]interface{}{
		"accept": accept,
	}
	if promptText != "" {
		params["promptText"] = promptText
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("page.handleDialog", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Dialog handled (accept=%v): %v\n", accept, res)
	return nil
}

func ExecEmulate(network, cpu, theme string, tabID interface{}) error {
	params := map[string]interface{}{}
	if network != "" {
		params["networkConditions"] = network
	}
	if cpu != "" {
		params["cpuThrottlingRate"] = cpu
	}
	if theme != "" {
		params["colorScheme"] = theme
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("emulation.set", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Emulation configured: %v\n", res)
	return nil
}

func ExecResizePage(width, height int, tabID interface{}) error {
	params := map[string]interface{}{
		"width":  width,
		"height": height,
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("emulation.resize", params, DefaultPort)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Viewport resized to %dx%d: %v\n", width, height, res)
	return nil
}

func ExecListNetworkRequests(filterUrl, method, resType string, limit int, tabID interface{}) error {
	params := map[string]interface{}{}
	if filterUrl != "" {
		params["filterUrl"] = filterUrl
	}
	if method != "" {
		params["method"] = method
	}
	if resType != "" {
		params["resourceType"] = resType
	}
	if limit > 0 {
		params["limit"] = limit
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("network.listRequests", params, DefaultPort)
	if err != nil {
		return err
	}
	jsonB, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(jsonB))
	return nil
}

func ExecGetNetworkResponseBody(requestId string, tabID interface{}) error {
	params := map[string]interface{}{
		"requestId": requestId,
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("network.getResponseBody", params, DefaultPort)
	if err != nil {
		return err
	}
	jsonB, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(jsonB))
	return nil
}

func ExecPerformanceTrace(action, categories string, tabID interface{}) error {
	params := map[string]interface{}{
		"action": action,
	}
	if categories != "" {
		params["categories"] = categories
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("performance.trace", params, DefaultPort)
	if err != nil {
		return err
	}
	jsonB, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(jsonB))
	return nil
}

func ExecPerformanceMetrics(tabID interface{}) error {
	params := map[string]interface{}{}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("performance.metrics", params, DefaultPort)
	if err != nil {
		return err
	}
	jsonB, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(jsonB))
	return nil
}

func ExecTakeHeapSnapshot(tabID interface{}) error {
	params := map[string]interface{}{}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := DispatchCommand("memory.heapSnapshot", params, DefaultPort)
	if err != nil {
		return err
	}
	jsonB, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(jsonB))
	return nil
}

func ExecManageExtensions(action, extensionID string, enabled *bool) error {
	params := map[string]interface{}{
		"action": action,
	}
	if extensionID != "" {
		params["extensionId"] = extensionID
	}
	if enabled != nil {
		params["enabled"] = *enabled
	}
	res, err := DispatchCommand("extensions.manage", params, DefaultPort)
	if err != nil {
		return err
	}
	jsonB, _ := json.MarshalIndent(res, "", "  ")
	fmt.Println(string(jsonB))
	return nil
}
