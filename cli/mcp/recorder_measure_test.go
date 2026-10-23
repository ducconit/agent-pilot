package mcp

import (
	"strings"
	"testing"
)

func TestRecorderMeasureRequiresTabIDInSchemaAndValidation(t *testing.T) {
	tool := findTool("browser_recorder_measure")
	if tool == nil {
		t.Fatal("browser_recorder_measure tool missing")
	}
	required, ok := tool.InputSchema["required"].([]string)
	if !ok || len(required) != 1 || required[0] != "tabId" {
		t.Fatalf("required schema = %#v, want [tabId]", tool.InputSchema["required"])
	}
	if err := validateToolArguments("browser_recorder_measure", map[string]interface{}{}); err == nil {
		t.Fatal("missing tabId should fail schema validation")
	}
	message, isError := executeToolCall("browser_recorder_measure", map[string]interface{}{"tabId": float64(-42)})
	if !isError || !strings.Contains(message, "positive integer tabId") {
		t.Fatalf("negative isolated-context tabId should be rejected, message=%q isError=%v", message, isError)
	}
}

func TestFormatRecorderMeasureResultKeepsFailureMetadata(t *testing.T) {
	result := map[string]interface{}{
		"success":      false,
		"failurePhase": "replay",
		"error":        "replay: selector not found",
		"traceStop":    map[string]interface{}{"success": true},
	}
	encoded, isError := formatRecorderMeasureResult(result, nil)
	if !isError || !strings.Contains(encoded, `"failurePhase": "replay"`) || !strings.Contains(encoded, "selector not found") {
		t.Fatalf("MCP result must preserve failure metadata and set isError: isError=%v result=%s", isError, encoded)
	}
}

func TestFormatRecorderToolResultSetsErrorForExplicitFailureAndPreservesPayload(t *testing.T) {
	result := map[string]interface{}{
		"success":       false,
		"executedSteps": float64(0),
		"error":         "expression resolved false",
	}
	encoded, isError := formatRecorderToolResult(result, nil)
	if !isError || !strings.Contains(encoded, `"success": false`) || !strings.Contains(encoded, "expression resolved false") {
		t.Fatalf("direct Recorder tool must preserve failure data and set isError: isError=%v result=%s", isError, encoded)
	}

	encoded, isError = formatRecorderToolResult(map[string]interface{}{"success": true}, nil)
	if isError || !strings.Contains(encoded, `"success": true`) {
		t.Fatalf("successful Recorder tool should not set isError: isError=%v result=%s", isError, encoded)
	}
}
