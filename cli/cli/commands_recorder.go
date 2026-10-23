package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ducconit/agent-pilot-extension/cli/bridge"
	"github.com/ducconit/agent-pilot-extension/cli/config"
)

// newRecorderCommand exposes the Chrome DevTools Recorder-style flow lifecycle
// without requiring an agent to open DevTools. The extension owns recording and
// replay; the CLI only transports JSON and keeps file import/export local.
func newRecorderCommand() *cobra.Command {
	cmd := newLeafCommand("recorder", []string{"flow"}, func(args []string) error {
		parsed, err := parseCmdArgs(args, []FlagDef{
			{Name: "tab", Aliases: []string{"t"}}, {Name: "file"}, {Name: "steps"},
			{Name: "step"}, {Name: "step-id"}, {Name: "operation"}, {Name: "index"},
			{Name: "title"}, {Name: "url"}, {Name: "format"}, {Name: "include-events", IsBool: true},
		})
		if err != nil {
			return fmt.Errorf("invalid recorder arguments: %w", err)
		}
		if len(parsed.Positional) == 0 {
			return fmt.Errorf("usage: agent-pilot recorder <start|stop|state|replay|export|import|edit|clear> [--tab ID] [--format json]")
		}
		tabID, err := parsed.TabID()
		if err != nil {
			return err
		}
		operation := strings.ToLower(parsed.Positional[0])
		params := map[string]interface{}{}
		if tabID != nil {
			params["tabId"] = tabID
		}

		switch operation {
		case "start", "record":
			params["enabled"] = true
			if title := parsed.String("title", ""); title != "" {
				params["title"] = title
			}
			if url := parsed.String("url", ""); url != "" {
				params["url"] = url
			}
			operation = "flow.record"
		case "stop", "pause":
			params["enabled"] = false
			operation = "flow.record"
		case "state", "status":
			operation = "flow.state"
		case "export":
			operation = "flow.export"
		case "clear":
			operation = "flow.clear"
		case "replay", "run":
			if err := addRecorderSteps(params, parsed.String("steps", ""), parsed.String("file", "")); err != nil {
				return err
			}
			operation = "flow.replay"
		case "measure":
			// Replay may replace an unusable tab, so a measure needs a positive
			// Chrome tab ID that trace and replay can both target.
			if tabID == nil || !bridge.ValidRecorderMeasureTabID(tabID) {
				return fmt.Errorf("recorder measure requires --tab so trace and replay target the same tab")
			}
			if err := addRecorderSteps(params, parsed.String("steps", ""), parsed.String("file", "")); err != nil {
				return err
			}
			params["includeEvents"] = parsed.Bool("include-events")
			operation = "recorder.measure"
		case "import":
			flow, err := readRecorderFlow(parsed.String("file", ""), parsed.String("steps", ""))
			if err != nil {
				return err
			}
			params["flow"] = flow
			if title := parsed.String("title", ""); title != "" {
				params["title"] = title
			}
			operation = "flow.import"
		case "edit":
			editOperation := parsed.String("operation", "replace")
			params["operation"] = editOperation
			if stepID := parsed.String("step-id", ""); stepID != "" {
				params["stepId"] = stepID
			}
			if index := parsed.String("index", ""); index != "" {
				params["index"] = index
			}
			if rawStep := parsed.String("step", ""); rawStep != "" {
				var step interface{}
				if err := json.Unmarshal([]byte(rawStep), &step); err != nil {
					return fmt.Errorf("--step must be valid JSON: %w", err)
				}
				params["step"] = step
			}
			operation = "flow.edit"
		default:
			return fmt.Errorf("unknown recorder operation: %s", operation)
		}

		var result interface{}
		if operation == "recorder.measure" {
			measureResult, measureErr := bridge.RunRecorderMeasure(tabID, params, config.DefaultBridgePort(), bridge.DispatchCommand)
			result = measureResult
			format := parsed.String("format", "json")
			if err := printCommandResult(format, "✅ Recorder measure: %v\n", result); err != nil {
				return err
			}
			if measureErr != nil {
				return fmt.Errorf("recorder measure failed: %w", measureErr)
			}
			return nil
		} else {
			var dispatchErr error
			result, dispatchErr = bridge.DispatchCommand(operation, params, config.DefaultBridgePort())
			if dispatchErr != nil {
				return dispatchErr
			}
		}
		format := parsed.String("format", "json")
		if operation == "flow.export" && bridge.RecorderResultFailure(result) == nil {
			// The CLI export is intentionally a directly importable Chrome
			// Recorder JSON document. MCP keeps the richer envelope containing
			// Recorder, Batch and Playwright formats together.
			if envelope, ok := result.(map[string]interface{}); ok {
				if recorder, exists := envelope["recorder"]; exists {
					result = recorder
				}
			}
		}
		return printRecorderCommandResult(format, result)
	})
	cmd.Short = "Record, replay, edit, import and export Chrome Recorder flows"
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID")
	cmd.Flags().String("file", "", "Chrome Recorder JSON file to import or replay")
	cmd.Flags().String("steps", "", "Inline JSON flow steps or flow object")
	cmd.Flags().String("step", "", "Inline JSON step for recorder edit")
	cmd.Flags().String("step-id", "", "Step ID for recorder edit")
	cmd.Flags().String("operation", "replace", "Edit operation: replace, update, insert, delete or set")
	cmd.Flags().String("index", "", "Zero-based insertion index")
	cmd.Flags().String("title", "", "Recording title")
	cmd.Flags().String("url", "", "Initial URL when starting without a usable tab")
	cmd.Flags().String("format", "json", "Output format: json or text")
	cmd.Flags().Bool("include-events", false, "Include raw trace event summaries in measure output (large)")
	return cmd
}

func printRecorderCommandResult(format string, result interface{}) error {
	failure := bridge.RecorderResultFailure(result)
	text := "✅ Recorder result: %v\n"
	if failure != nil {
		text = "❌ Recorder result: %v\n"
	}
	if err := printCommandResult(format, text, result); err != nil {
		return err
	}
	if failure != nil {
		return fmt.Errorf("recorder command failed: %w", failure)
	}
	return nil
}

func addRecorderSteps(params map[string]interface{}, raw, filePath string) error {
	if filePath != "" {
		flow, err := readRecorderFlow(filePath, "")
		if err != nil {
			return err
		}
		params["steps"] = flow.(map[string]interface{})["steps"]
		return nil
	}
	if raw == "" {
		return nil
	}
	var value interface{}
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return fmt.Errorf("--steps must be valid JSON: %w", err)
	}
	if flow, ok := value.(map[string]interface{}); ok {
		if steps, exists := flow["steps"]; exists {
			params["steps"] = steps
			return nil
		}
	}
	params["steps"] = value
	return nil
}

func readRecorderFlow(filePath, raw string) (interface{}, error) {
	if filePath == "" && raw == "" {
		return nil, fmt.Errorf("recorder import requires --file or --steps")
	}
	data := []byte(raw)
	if filePath != "" {
		var err error
		data, err = os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("cannot read Recorder file %s: %w", filePath, err)
		}
	}
	var flow interface{}
	if err := json.Unmarshal(data, &flow); err != nil {
		return nil, fmt.Errorf("Recorder JSON is invalid: %w", err)
	}
	if steps, ok := flow.([]interface{}); ok {
		return map[string]interface{}{"steps": steps}, nil
	}
	if object, ok := flow.(map[string]interface{}); ok {
		return object, nil
	}
	return nil, fmt.Errorf("Recorder JSON must be an object or steps array")
}
