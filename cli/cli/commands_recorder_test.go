package cli

import (
	"io"
	"os"
	"strings"
	"testing"
)

func TestRecorderMeasureRejectsNonPositiveTabIDBeforeDispatch(t *testing.T) {
	cmd := newRecorderCommand()
	cmd.SetArgs([]string{"measure", "--tab", "-42"})
	err := cmd.Execute()
	if err == nil || !strings.Contains(err.Error(), "requires --tab") {
		t.Fatalf("expected negative context tab ID to be rejected, got %v", err)
	}
}

func TestRecorderCommandFailurePreservesJSONOutputAndReturnsError(t *testing.T) {
	previousStdout := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("create stdout pipe: %v", err)
	}
	os.Stdout = writer
	commandErr := printRecorderCommandResult("json", map[string]interface{}{
		"success":       false,
		"executedSteps": 0,
		"error":         "expression resolved false",
	})
	_ = writer.Close()
	os.Stdout = previousStdout
	output, readErr := io.ReadAll(reader)
	_ = reader.Close()
	if readErr != nil {
		t.Fatalf("read command output: %v", readErr)
	}
	if commandErr == nil || !strings.Contains(commandErr.Error(), "expression resolved false") {
		t.Fatalf("expected nonzero command result error, got %v", commandErr)
	}
	if !strings.Contains(string(output), `"success": false`) || !strings.Contains(string(output), `"executedSteps": 0`) {
		t.Fatalf("JSON failure payload was not preserved: %s", output)
	}
}
