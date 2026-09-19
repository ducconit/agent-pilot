// mcp.go implements the Model Context Protocol stdio server: the JSON-RPC
// request/response types, the read loop, request dispatch, response writing and
// schema export.
//
// The tool registry lives in mcp_tools.go (pure data) and the per-tool bridge
// translation in mcp_dispatch.go.
//
// Concurrency: the request loop reads one line at a time but hands each request
// to its own goroutine (see RunMCPServer), so handlers run concurrently and
// responses may be written out of order. That is valid JSON-RPC: clients
// correlate replies by the id echoed back on every response, not by ordering.
// sendMCPResponse serialises writes with mcpWriteMu so interleaved responses
// never corrupt a line.

package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"sync"

	"github.com/ducconit/agent-pilot-extension/cli/bridge"
	"github.com/ducconit/agent-pilot-extension/cli/config"
	"github.com/ducconit/agent-pilot-extension/cli/version"
)

// mcpWriteMu serialises stdout writes so concurrent handlers do not interleave
// partial JSON-RPC lines.
var mcpWriteMu sync.Mutex

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

func RunMCPServer() {
	// Automatically ensure bridge server is listening on port 58765 in background
	go func() {
		if err := bridge.StartBridgeServer(config.DefaultBridgePort()); err != nil {
			log.Printf("[MCP] Embedded bridge server error: %v", err)
		}
	}()

	reader := bufio.NewReaderSize(os.Stdin, 64*1024)

	for {
		line, dropped, err := readMCPLine(reader)
		if err != nil {
			if err == io.EOF {
				break
			}
			log.Printf("[MCP] Read error: %v", err)
			break
		}
		if dropped {
			log.Printf("[MCP] Dropped oversized JSON-RPC message (max %d bytes)", config.MaxMCPLineBytes)
			continue
		}

		trimmed := bytes.TrimSpace(line)
		if len(trimmed) == 0 {
			continue
		}

		var req JSONRPCRequest
		if err := json.Unmarshal(trimmed, &req); err != nil {
			var idHolder struct {
				ID interface{} `json:"id"`
			}
			_ = json.Unmarshal(trimmed, &idHolder)
			sendMCPResponse(idHolder.ID, nil, map[string]interface{}{
				"code":    -32700,
				"message": "Parse error: invalid JSON",
			})
			continue
		}

		if req.JSONRPC != "" && req.JSONRPC != "2.0" {
			if req.ID != nil {
				sendMCPResponse(req.ID, nil, map[string]interface{}{
					"code":    -32600,
					"message": `Invalid Request: jsonrpc must be "2.0"`,
				})
			}
			continue
		}

		// Dispatch each request on its own goroutine so a slow tool call (e.g. a
		// long batch) never blocks subsequent requests. Because handlers run
		// concurrently, responses may be emitted out of order; JSON-RPC clients
		// match them by id. req is copied so the loop can reuse its stack slot.
		reqCopy := req
		go handleMCPRequest(&reqCopy)
	}
}

// readMCPLine reads one newline-delimited JSON-RPC message, capping the size.
// Returns (line, dropped, err); dropped is true when the message exceeded config.MaxMCPLineBytes.
func readMCPLine(reader *bufio.Reader) ([]byte, bool, error) {
	var buf []byte
	overlong := false
	for {
		chunk, err := reader.ReadSlice('\n')
		if !overlong {
			buf = append(buf, chunk...)
			if len(buf) > config.MaxMCPLineBytes {
				overlong = true
				buf = nil
			}
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		if err != nil {
			if len(buf) > 0 && !overlong {
				return buf, false, nil
			}
			return nil, overlong, err
		}
		if overlong {
			return nil, true, nil
		}
		return buf, false, nil
	}
}

func findTool(name string) *ToolInfo {
	for i := range mcpTools {
		if mcpTools[i].Name == name {
			return &mcpTools[i]
		}
	}
	return nil
}

func validateToolArguments(name string, args map[string]interface{}) error {
	tool := findTool(name)
	if tool == nil {
		return fmt.Errorf("unknown tool: %s", name)
	}
	var required []string
	switch r := tool.InputSchema["required"].(type) {
	case []string:
		required = r
	case []interface{}:
		for _, item := range r {
			if s, ok := item.(string); ok {
				required = append(required, s)
			}
		}
	}
	for _, key := range required {
		if _, present := args[key]; !present {
			return fmt.Errorf("missing required parameter %q for tool %q", key, name)
		}
	}
	return nil
}

func handleMCPRequest(req *JSONRPCRequest) {
	// Notifications must never receive a response
	if req.ID == nil && strings.HasPrefix(req.Method, "notifications/") {
		return
	}

	switch req.Method {
	case "initialize":
		sendMCPResponse(req.ID, map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"serverInfo": map[string]interface{}{
				"name":    "agent-pilot",
				"version": version.Raw(),
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

		if err := validateToolArguments(toolName, args); err != nil {
			sendMCPResponse(req.ID, map[string]interface{}{
				"content": []map[string]interface{}{
					{
						"type": "text",
						"text": fmt.Sprintf("Error: %v", err),
					},
				},
				"isError": true,
			}, nil)
			return
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
		if req.ID == nil {
			// Unknown notification: ignore silently
			return
		}
		sendMCPResponse(req.ID, nil, map[string]interface{}{
			"code":    -32601,
			"message": fmt.Sprintf("Method not found: %s", req.Method),
		})
	}
}

func sendMCPResponse(id interface{}, result interface{}, rpcErr interface{}) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
		Error:   rpcErr,
	}
	data, err := json.Marshal(resp)
	if err != nil {
		log.Printf("[MCP] Failed to marshal JSON-RPC response: %v", err)
		return
	}
	mcpWriteMu.Lock()
	defer mcpWriteMu.Unlock()
	if _, err := os.Stdout.Write(data); err != nil {
		log.Printf("[MCP] Failed to write JSON-RPC response: %v", err)
		return
	}
	if _, err := os.Stdout.Write([]byte("\n")); err != nil {
		log.Printf("[MCP] Failed to write JSON-RPC terminator: %v", err)
	}
}
