// client_cdp_commands.go implements the CDP-backed commands: dialog handling,
// emulation, viewport resizing, network inspection, performance tracing/metrics,
// heap snapshots and extension management. Most simply marshal the bridge result
// as indented JSON to stdout.

package cli

import (
	"encoding/json"
	"fmt"

	"github.com/ducconit/agent-pilot-extension/cli/bridge"
	"github.com/ducconit/agent-pilot-extension/cli/config"
)

func ExecCdpStatus(tabID interface{}) error {
	params := map[string]interface{}{}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := bridge.DispatchCommand("cdp.status", params, config.DefaultBridgePort())
	if err != nil {
		return err
	}
	resMap, _ := res.(map[string]interface{})
	attached, _ := resMap["attached"].(bool)
	if attached {
		fmt.Printf("🟢 CDP attached (trusted input available) — tab %v\n", resMap["tabId"])
	} else {
		fmt.Printf("🔴 CDP NOT attached — %v\n   Hint: %v\n", resMap["error"], resMap["hint"])
	}
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
	res, err := bridge.DispatchCommand("page.handleDialog", params, config.DefaultBridgePort())
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
	res, err := bridge.DispatchCommand("emulation.set", params, config.DefaultBridgePort())
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
	res, err := bridge.DispatchCommand("emulation.resize", params, config.DefaultBridgePort())
	if err != nil {
		return err
	}
	fmt.Printf("✅ Viewport resized to %dx%d: %v\n", width, height, res)
	return nil
}

func dispatchAndPrintJSON(method string, params map[string]interface{}, tabID interface{}) error {
	if params == nil {
		params = map[string]interface{}{}
	}
	if tabID != nil {
		params["tabId"] = tabID
	}
	res, err := bridge.DispatchCommand(method, params, config.DefaultBridgePort())
	if err != nil {
		return err
	}
	jsonB, err := json.MarshalIndent(res, "", "  ")
	if err != nil {
		fmt.Printf("%v\n", res)
		return nil
	}
	fmt.Println(string(jsonB))
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
	return dispatchAndPrintJSON("network.listRequests", params, tabID)
}

func ExecGetNetworkResponseBody(requestId string, tabID interface{}) error {
	params := map[string]interface{}{
		"requestId": requestId,
	}
	return dispatchAndPrintJSON("network.getResponseBody", params, tabID)
}

func ExecPerformanceTrace(action, categories string, tabID interface{}) error {
	params := map[string]interface{}{
		"action": action,
	}
	if categories != "" {
		params["categories"] = categories
	}
	return dispatchAndPrintJSON("performance.trace", params, tabID)
}

func ExecPerformanceMetrics(tabID interface{}) error {
	return dispatchAndPrintJSON("performance.metrics", nil, tabID)
}

func ExecTakeHeapSnapshot(gc bool, tabID interface{}) error {
	method := "memory.heapSnapshot"
	if gc {
		method = "memory.collectGarbage"
	}
	return dispatchAndPrintJSON(method, nil, tabID)
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
	return dispatchAndPrintJSON("extensions.manage", params, nil)
}
