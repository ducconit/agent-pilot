package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
)

type JSONRPCRequest struct {
	JSONRPC string                 `json:"jsonrpc"`
	ID      interface{}            `json:"id,omitempty"`
	Method  string                 `json:"method"`
	Params  map[string]interface{} `json:"params,omitempty"`
}

type JSONRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id,omitempty"`
	Result  interface{} `json:"result,omitempty"`
	Error   interface{} `json:"error,omitempty"`
}

type ToolInfo struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"inputSchema"`
}

var mcpTools = []ToolInfo{
	{
		Name:        "browser_run_actions",
		Description: "Execute an ordered sequence of browser actions in a single tool call (open, wait, click, type, screenshot, devtools, close).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"actions": map[string]interface{}{
					"type":        "array",
					"description": "List of actions to execute sequentially",
				},
				"tabId": map[string]interface{}{
					"type":        "integer",
					"description": "Target tab ID",
				},
				"stopOnError": map[string]interface{}{
					"type":        "boolean",
					"description": "Stop execution if any step fails (default: true)",
				},
				"omitDataUrls": map[string]interface{}{
					"type":        "boolean",
					"description": "Omit raw Base64 data from screenshot steps to prevent memory bloat",
				},
			},
			"required": []string{"actions"},
		},
	},
	{
		Name:        "browser_open_tab",
		Description: "Open a new browser tab. Defaults to active: false to never interrupt user focus.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"url":    map[string]interface{}{"type": "string", "description": "URL to load"},
				"active": map[string]interface{}{"type": "boolean", "description": "Make tab active (default: false)"},
			},
			"required": []string{"url"},
		},
	},
	{
		Name:        "browser_list_tabs",
		Description: "List all open tabs across all browser windows.",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
	},
	{
		Name:        "browser_navigate",
		Description: "Navigate the active or specified tab to a new URL.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"url":   map[string]interface{}{"type": "string", "description": "Destination URL"},
				"tabId": map[string]interface{}{"type": "integer", "description": "Tab ID to navigate"},
			},
			"required": []string{"url"},
		},
	},
	{
		Name:        "browser_click",
		Description: "Click with the virtual mouse (visual cursor). Set via:'cdp' for trusted CDP input that works on cross-origin iframes, canvas and WebGL apps; via:'auto' falls back to synthetic.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector": map[string]interface{}{"type": "string", "description": "CSS selector to click"},
				"x":        map[string]interface{}{"type": "number", "description": "X coordinate"},
				"y":        map[string]interface{}{"type": "number", "description": "Y coordinate"},
				"via":      map[string]interface{}{"type": "string", "description": "Input backend: synthetic (default), cdp (trusted), auto (cdp with synthetic fallback)"},
				"tabId":    map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_type",
		Description: "Type text into an input or textarea with realistic human keystroke intervals.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector":   map[string]interface{}{"type": "string", "description": "CSS selector of input"},
				"text":       map[string]interface{}{"type": "string", "description": "Text to type"},
				"clear":      map[string]interface{}{"type": "boolean", "description": "Clear field first"},
				"pressEnter": map[string]interface{}{"type": "boolean", "description": "Press Enter after typing"},
				"tabId":      map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"selector", "text"},
		},
	},
	{
		Name:        "browser_scroll",
		Description: "Scroll viewport or active element smoothly by deltaX and deltaY pixels.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"deltaX": map[string]interface{}{"type": "number", "description": "Horizontal scroll offset"},
				"deltaY": map[string]interface{}{"type": "number", "description": "Vertical scroll offset"},
				"tabId":  map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_snapshot",
		Description: "Capture a token-efficient interactive accessibility snapshot of the page with numbered element references (@1, @2, etc.). Enables agents to quickly understand page structure and target elements with minimal token usage.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"maxElements": map[string]interface{}{"type": "integer", "description": "Maximum number of interactive elements to include (default: 80)"},
				"format":      map[string]interface{}{"type": "string", "description": "Output format: 'text' (default, compact tree) or 'json'"},
				"tabId":       map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_fill_form",
		Description: "Fill multiple form fields (inputs, selects, checkboxes, textareas) and optionally submit in a single tool call. Compatible with React Hook Form, Vue, and standard HTML5 forms.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"fields": map[string]interface{}{
					"type":        "array",
					"description": "List of fields to fill: [{selector: '@1' or '#id', value: 'my text', clear: true}]",
					"items": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"selector": map[string]interface{}{"type": "string", "description": "CSS selector or snapshot ref (e.g. '@1')"},
							"value":    map[string]interface{}{"type": []string{"string", "boolean", "number"}, "description": "Value to set (string, boolean for checkbox, etc.)"},
							"clear":    map[string]interface{}{"type": "boolean", "description": "Clear field before typing (default: true)"},
						},
						"required": []string{"selector", "value"},
					},
				},
				"submitSelector": map[string]interface{}{"type": "string", "description": "Optional selector or snapshot ref (e.g. '@4') of submit button to click after filling"},
				"pressEnter":     map[string]interface{}{"type": "boolean", "description": "Press enter on the last input after filling (default: false)"},
				"tabId":          map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"fields"},
		},
	},
	{
		Name:        "browser_get_element",
		Description: "Inspect a DOM element, retrieving bounding box, coordinates, XPath, selector, text content, and optionally computed CSS.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector":      map[string]interface{}{"type": "string", "description": "CSS selector or snapshot ref (e.g. '@1')"},
				"includeStyles": map[string]interface{}{"type": "boolean", "description": "Include computed CSS styles. Omitted by default to minimize token usage."},
				"tabId":         map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"selector"},
		},
	},
	{
		Name:        "browser_screenshot",
		Description: "Capture high-resolution PNG screenshot via CDP hardware acceleration (supports background tabs).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"mode":     map[string]interface{}{"type": "string", "description": "visible, region, element, or full"},
				"selector": map[string]interface{}{"type": "string", "description": "Selector for element mode"},
				"tabId":    map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_get_devtools_data",
		Description: "Retrieve real-time DevTools logs (Console, Network requests, Performance metrics).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"type":         map[string]interface{}{"type": "string", "description": "all, console, network, performance"},
				"filterOrigin": map[string]interface{}{"type": "boolean", "description": "Filter out internal extension logs/warnings (chrome-extension://*). Default: true"},
				"tabId":        map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"limit":        map[string]interface{}{"type": "integer", "description": "Max entries to return"},
				"clear":        map[string]interface{}{"type": "boolean", "description": "Clear buffer after reading"},
			},
		},
	},
	{
		Name:        "browser_pick_color",
		Description: "Sample the pixel color at coordinates (X, Y) or activate the interactive eyedropper loupe.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"x":     map[string]interface{}{"type": "number", "description": "X coordinate"},
				"y":     map[string]interface{}{"type": "number", "description": "Y coordinate"},
				"tabId": map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_list_instances",
		Description: "List all connected browser instances and windows.",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
	},
	{
		Name:        "browser_select_instance",
		Description: "Switch the active target browser instance.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"instanceId": map[string]interface{}{"type": "string", "description": "ID of browser instance"},
			},
			"required": []string{"instanceId"},
		},
	},
	{
		Name:        "browser_set_busy",
		Description: "Display or dismiss the human input lock shield during automated tasks.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"busy":    map[string]interface{}{"type": "boolean", "description": "Enable or disable lock shield"},
				"action":  map[string]interface{}{"type": "string", "description": "Action name shown to user"},
				"session": map[string]interface{}{"type": "boolean", "description": "Keep cursor and lock shield continuously visible throughout the agent session"},
				"tabId":   map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_start_session",
		Description: "Start an active AI Agent session. Keeps the virtual cursor and glowing neon lock shield continuously visible on the tab until ended.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name":  map[string]interface{}{"type": "string", "description": "Session name or task description shown in the action pill"},
				"tabId": map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_end_session",
		Description: "End the active AI Agent session. Fades out and dismisses the virtual cursor and lock shield.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"tabId": map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_get_pending_feedback",
		Description: "Channel B: Retrieve pending human visual UI feedback sessions stored in ~/.agent-pilot/inbox/feedback/.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"limit":     map[string]interface{}{"type": "integer", "description": "Max sessions to return"},
				"sessionId": map[string]interface{}{"type": "string", "description": "Specific session ID"},
				"clear":     map[string]interface{}{"type": "boolean", "description": "Archive sessions after reading"},
			},
		},
	},
	{
		Name:        "browser_wait_for_feedback",
		Description: "Channel A: Reactively pause agent execution until human user submits visual UI feedback.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"timeout": map[string]interface{}{"type": "integer", "description": "Timeout in seconds (default: 120)"},
				"tabId":   map[string]interface{}{"type": "integer", "description": "Optional tab ID filter"},
			},
		},
	},
	{
		Name:        "browser_evaluate",
		Description: "Evaluate a JavaScript expression or script in the context of the page (MAIN world first, with CDP Runtime.evaluate fallback) and return the serialized result.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"expression": map[string]interface{}{"type": "string", "description": "JavaScript expression or script to evaluate"},
				"tabId":      map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"expression"},
		},
	},
	{
		Name:        "browser_upload_file",
		Description: "Upload local files into a file input element (<input type='file'>) using Chrome DevTools Protocol DOM.setFileInputFiles.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector": map[string]interface{}{"type": "string", "description": "CSS selector or @ref of the file input element"},
				"files": map[string]interface{}{
					"type":        "array",
					"items":       map[string]interface{}{"type": "string"},
					"description": "Array of absolute local file paths to upload",
				},
				"tabId": map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"selector", "files"},
		},
	},
	{
		Name:        "browser_handle_dialog",
		Description: "Handle a pending or incoming JavaScript dialog (alert, confirm, prompt) with accept/dismiss and optional prompt text.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"accept":     map[string]interface{}{"type": "boolean", "description": "Whether to accept (true) or dismiss/cancel (false) the dialog (default: true)"},
				"promptText": map[string]interface{}{"type": "string", "description": "Optional text to enter into a prompt() dialog"},
				"tabId":      map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_hover",
		Description: "Simulate human-like virtual mouse hover over an element (triggering mouseenter, mouseover, mousemove).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector": map[string]interface{}{"type": "string", "description": "CSS selector or @ref to hover over"},
				"tabId":    map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"selector"},
		},
	},
	{
		Name:        "browser_drag",
		Description: "Drag from a source to a target element, or between coordinates (fromX/fromY/toX/toY) for canvas/game aiming. Set via:'cdp' for trusted CDP input; via:'auto' falls back to synthetic.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"from":   map[string]interface{}{"type": "string", "description": "Source element selector or @ref"},
				"to":     map[string]interface{}{"type": "string", "description": "Target element selector or @ref"},
				"fromX":  map[string]interface{}{"type": "number", "description": "Source X coordinate (canvas/game)"},
				"fromY":  map[string]interface{}{"type": "number", "description": "Source Y coordinate (canvas/game)"},
				"toX":    map[string]interface{}{"type": "number", "description": "Target X coordinate (canvas/game)"},
				"toY":    map[string]interface{}{"type": "number", "description": "Target Y coordinate (canvas/game)"},
				"steps":  map[string]interface{}{"type": "integer", "description": "Number of interpolation steps (default: 8)"},
				"holdMs": map[string]interface{}{"type": "integer", "description": "Hold at destination before release in ms (slingshot pull)"},
				"via":    map[string]interface{}{"type": "string", "description": "Input backend: synthetic (default), cdp (trusted), auto (cdp with synthetic fallback)"},
				"tabId":  map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_press_key",
		Description: "Dispatch keyboard key event or combination (Enter, Tab, Escape, Control+A, Control+Shift+R...) to active element or selector.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"key":      map[string]interface{}{"type": "string", "description": "Key name or combination (e.g., 'Enter', 'Tab', 'Escape', 'Control+A')"},
				"selector": map[string]interface{}{"type": "string", "description": "Optional target element selector or @ref"},
				"tabId":    map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"key"},
		},
	},
	{
		Name:        "browser_wait_for",
		Description: "Smart wait until a selector or text appears, disappears, or meets state condition with timeout.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector":  map[string]interface{}{"type": "string", "description": "Optional CSS selector or @ref to wait for"},
				"text":      map[string]interface{}{"type": "string", "description": "Optional text to wait for on the page"},
				"state":     map[string]interface{}{"type": "string", "enum": []string{"visible", "attached", "hidden"}, "description": "Desired state (default: visible)"},
				"timeoutMs": map[string]interface{}{"type": "integer", "description": "Timeout in milliseconds (default: 10000)"},
				"tabId":     map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_emulate",
		Description: "Emulate environment conditions: CPU throttling (rate 1/4/6), network conditions (offline, slow-3g, fast-3g, none), dark/light theme.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"cpuThrottlingRate": map[string]interface{}{"type": "number", "description": "CPU throttling rate (1 = normal, 4 = 4x slowdown, 6 = 6x slowdown)"},
				"networkConditions": map[string]interface{}{"type": "string", "description": "Network preset: 'offline', 'slow-3g', 'fast-3g', 'none'"},
				"colorScheme":       map[string]interface{}{"type": "string", "enum": []string{"dark", "light", "default"}, "description": "Color scheme preference"},
				"tabId":             map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_resize_page",
		Description: "Resize browser page viewport metrics (width, height, deviceScaleFactor, mobile) for responsive testing.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"width":             map[string]interface{}{"type": "integer", "description": "Viewport width in pixels"},
				"height":            map[string]interface{}{"type": "integer", "description": "Viewport height in pixels"},
				"deviceScaleFactor": map[string]interface{}{"type": "number", "description": "Device pixel ratio (default: 1)"},
				"mobile":            map[string]interface{}{"type": "boolean", "description": "Whether to emulate mobile screen"},
				"tabId":             map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"width", "height"},
		},
	},
	{
		Name:        "browser_list_network_requests",
		Description: "List recent HTTP/HTTPS network requests captured on the tab with optional filters by URL, method, resourceType.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"filterUrl":    map[string]interface{}{"type": "string", "description": "Filter requests matching URL substring"},
				"method":       map[string]interface{}{"type": "string", "description": "Filter by HTTP method (GET, POST, PUT, DELETE...)"},
				"resourceType": map[string]interface{}{"type": "string", "description": "Filter by resource type (Fetch, XHR, Document, Script...)"},
				"limit":        map[string]interface{}{"type": "integer", "description": "Max requests to return (default: 100)"},
				"tabId":        map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_get_network_request",
		Description: "Get the full response body (JSON/Text) and details for a specific captured network request ID via CDP Network.getResponseBody.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"requestId": map[string]interface{}{"type": "string", "description": "The unique request ID obtained from browser_list_network_requests or devtools data"},
				"tabId":     map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
			"required": []string{"requestId"},
		},
	},
	{
		Name:        "browser_performance_trace",
		Description: "Start or stop DevTools Performance tracing session (Tracing.start/end) to analyze browser timeline and runtime performance.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"action":     map[string]interface{}{"type": "string", "enum": []string{"start", "stop"}, "description": "Action: 'start' to begin recording, 'stop' to end and retrieve metrics"},
				"categories": map[string]interface{}{"type": "string", "description": "Optional trace categories string"},
				"tabId":      map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_performance_metrics",
		Description: "Retrieve live runtime performance metrics from Chrome DevTools Protocol (JSHeapUsedSize, JSHeapTotalSize, LayoutCount, Nodes...).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"tabId": map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_take_heapsnapshot",
		Description: "Capture a heap memory snapshot or trigger garbage collection via CDP HeapProfiler.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"collectGarbage": map[string]interface{}{"type": "boolean", "description": "Set to true to trigger V8 Garbage Collection before or instead of snapshot"},
				"tabId":          map[string]interface{}{"type": "integer", "description": "Target tab ID"},
			},
		},
	},
	{
		Name:        "browser_manage_extensions",
		Description: "List installed browser extensions or enable/disable specific extensions via chrome.management.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"action":      map[string]interface{}{"type": "string", "enum": []string{"list", "setEnabled"}, "description": "Action: 'list' all extensions or 'setEnabled' to toggle"},
				"extensionId": map[string]interface{}{"type": "string", "description": "Extension ID to enable or disable"},
				"enabled":     map[string]interface{}{"type": "boolean", "description": "Target enabled state for setEnabled action"},
			},
		},
	},
}

func RunMCPServer() {
	// Automatically ensure bridge server is listening on port 58765 in background
	go func() {
		_ = StartBridgeServer(DefaultPort)
	}()

	reader := bufio.NewReader(os.Stdin)

	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			log.Printf("[MCP] Read error: %v", err)
			break
		}

		if len(line) == 0 || line[0] == '\n' || line[0] == '\r' {
			continue
		}

		var req JSONRPCRequest
		if err := json.Unmarshal(line, &req); err != nil {
			continue
		}

		handleMCPRequest(&req)
	}
}

func handleMCPRequest(req *JSONRPCRequest) {
	switch req.Method {
	case "initialize":
		sendMCPResponse(req.ID, map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"serverInfo": map[string]interface{}{
				"name":    "agent-pilot",
				"version": ServerVersion,
			},
			"capabilities": map[string]interface{}{
				"tools": map[string]interface{}{},
			},
		}, nil)

	case "notifications/initialized":
		// No response needed for notification

	case "tools/list":
		sendMCPResponse(req.ID, map[string]interface{}{
			"tools": mcpTools,
		}, nil)

	case "tools/call":
		toolName, _ := req.Params["name"].(string)
		args, _ := req.Params["arguments"].(map[string]interface{})
		if args == nil {
			args = make(map[string]interface{})
		}

		resText, isErr := executeToolCall(toolName, args)
		sendMCPResponse(req.ID, map[string]interface{}{
			"content": []map[string]interface{}{
				{
					"type": "text",
					"text": resText,
				},
			},
			"isError": isErr,
		}, nil)

	default:
		sendMCPResponse(req.ID, nil, map[string]interface{}{
			"code":    -32601,
			"message": fmt.Sprintf("Method not found: %s", req.Method),
		})
	}
}

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
		limit := 10
		if l, ok := args["limit"].(float64); ok {
			limit = int(l)
		}
		sid, _ := args["sessionId"].(string)
		clear, _ := args["clear"].(bool)
		res, err := GetPendingFeedback(limit, sid, clear)
		return formatToolResult(res, err)

	case "browser_wait_for_feedback":
		timeout := 120
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

func sendMCPResponse(id interface{}, result interface{}, rpcErr interface{}) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
		Error:   rpcErr,
	}
	bytes, _ := json.Marshal(resp)
	os.Stdout.Write(bytes)
	os.Stdout.Write([]byte("\n"))
}

// ExportMCPSchemas writes each MCP tool schema to a JSON file in the target directory
func ExportMCPSchemas(outDir string) error {
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", outDir, err)
	}

	for _, tool := range mcpTools {
		schema := map[string]interface{}{
			"name":        tool.Name,
			"description": tool.Description,
			"parameters":  tool.InputSchema,
			"inputSchema": tool.InputSchema,
		}
		data, err := json.MarshalIndent(schema, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to marshal tool %s: %w", tool.Name, err)
		}
		targetFile := filepath.Join(outDir, tool.Name+".json")
		if err := os.WriteFile(targetFile, data, 0644); err != nil {
			return fmt.Errorf("failed to write schema file %s: %w", targetFile, err)
		}
	}
	return nil
}
