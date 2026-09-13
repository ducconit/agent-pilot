package main

import (
	"encoding/base64"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DispatchCommand routes the command either via local in-memory bridge or forwarder HTTP
func DispatchCommand(method string, params map[string]interface{}, port int) (map[string]interface{}, error) {
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

	dataURL, _ := res["dataUrl"].(string)
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
	fmt.Printf("🎯 Element details for '%s':\n", selector)
	for k, v := range res {
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
	if tabs, ok := res["value"].([]interface{}); ok {
		for i, t := range tabs {
			if tm, ok := t.(map[string]interface{}); ok {
				activeTag := ""
				if a, _ := tm["active"].(bool); a {
					activeTag = " [ACTIVE]"
				}
				fmt.Printf("  %d. [Tab #%v] %s%s\n     URL: %v\n", i+1, tm["tabId"], tm["title"], activeTag, tm["url"])
			}
		}
	} else {
		fmt.Printf("%v\n", res)
	}
	return nil
}
