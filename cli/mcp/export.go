// export.go exposes the MCP tool registry to other packages (the CLI counts the
// tools for its export-mcp summary) and writes the JSON schemas to disk.

package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Tools returns the MCP tool registry advertised by the server.
func Tools() []ToolInfo {
	return mcpTools
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
