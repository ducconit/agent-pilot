package mcp

func recorderFlowSchema() map[string]interface{} {
	return map[string]interface{}{
		"type":                 "object",
		"description":          "Chrome DevTools Recorder-compatible flow object with title and steps",
		"additionalProperties": true,
		"properties": map[string]interface{}{
			"title": map[string]interface{}{"type": "string"},
			"steps": map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "object", "additionalProperties": true}},
		},
	}
}

func init() {
	mcpTools = append(mcpTools,
		devtoolsTool("browser_recorder_start", "Start recording a Chrome DevTools Recorder-compatible user flow on a tab. Captures navigation, clicks, input changes and Enter key actions with selectors; recording state survives page navigations.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID; a usable Agent Pilot tab is created when omitted or unavailable"),
			"title": field("string", "Recording title"),
			"url":   field("string", "Initial URL when a new tab must be created"),
		}),
		devtoolsTool("browser_recorder_stop", "Stop the active flow recording and return its current steps.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"),
		}),
		devtoolsTool("browser_recorder_state", "Read the current Recorder state and compact step list for a tab.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"),
		}),
		devtoolsTool("browser_recorder_replay", "Replay a recorded flow with the Agent Pilot virtual cursor. Pass steps to replay an imported flow without storing it first.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"),
			"steps": map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "object", "additionalProperties": true}, "description": "Optional Recorder-compatible steps"},
		}),
		devtoolsTool("browser_recorder_measure", "Measure a recorded flow by starting a complete Chrome trace, replaying the flow, and stopping the trace. Returns replay results and compact trace insights; set includeEvents to include the larger raw event summary.", map[string]interface{}{
			"tabId":         field("integer", "Positive Chrome tab ID; required so trace and replay stay on the same tab. Negative isolated-context IDs are unsupported because replay may replace tabs that Chrome tabs.get cannot resolve."),
			"steps":         map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "object", "additionalProperties": true}, "description": "Optional Recorder-compatible steps"},
			"includeEvents": field("boolean", "Include raw trace event summaries in the response; default false"),
		}, "tabId"),
		devtoolsTool("browser_recorder_export", "Export the current flow as Chrome Recorder JSON plus Agent Pilot batch and Playwright formats.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"),
		}),
		devtoolsTool("browser_recorder_import", "Import a Chrome DevTools Recorder JSON object or steps array into the extension flow state.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"),
			"flow":  recorderFlowSchema(),
			"steps": map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "object", "additionalProperties": true}, "description": "Alternative to flow: Recorder-compatible steps"},
			"title": field("string", "Override the imported title"),
		}),
		devtoolsTool("browser_recorder_edit", "Edit a stored flow step without opening DevTools. Supports replace/update, insert, delete and set operations.", map[string]interface{}{
			"tabId":     field("integer", "Target tab ID"),
			"operation": choices("Edit operation", "replace", "update", "insert", "delete", "set"),
			"stepId":    field("string", "Existing step ID for replace/update/delete/insert"),
			"index":     field("integer", "Insertion index for insert"),
			"step":      map[string]interface{}{"type": []string{"object", "array"}, "additionalProperties": true, "description": "Recorder step for replace/update/insert, or steps array for set"},
		}),
		devtoolsTool("browser_recorder_clear", "Clear the stored flow steps for a tab.", map[string]interface{}{
			"tabId": field("integer", "Target tab ID"),
		}),
	)
}
