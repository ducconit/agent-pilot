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
		Description: "Simulate human-like virtual mouse click with visual neon cursor and ripple effects.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector": map[string]interface{}{"type": "string", "description": "CSS selector to click"},
				"x":        map[string]interface{}{"type": "number", "description": "X coordinate"},
				"y":        map[string]interface{}{"type": "number", "description": "Y coordinate"},
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
		Name:        "browser_get_element",
		Description: "Inspect a DOM element, retrieving bounding box, coordinates, XPath, selector, text content, and computed CSS.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"selector": map[string]interface{}{"type": "string", "description": "CSS selector"},
				"tabId":    map[string]interface{}{"type": "integer", "description": "Target tab ID"},
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
				"type":  map[string]interface{}{"type": "string", "description": "all, console, network, performance"},
				"tabId": map[string]interface{}{"type": "integer", "description": "Target tab ID"},
				"limit": map[string]interface{}{"type": "integer", "description": "Max entries to return"},
				"clear": map[string]interface{}{"type": "boolean", "description": "Clear buffer after reading"},
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
				"busy":   map[string]interface{}{"type": "boolean", "description": "Enable or disable lock shield"},
				"action": map[string]interface{}{"type": "string", "description": "Action name shown to user"},
				"tabId":  map[string]interface{}{"type": "integer", "description": "Target tab ID"},
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
