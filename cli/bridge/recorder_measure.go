package bridge

import (
	"fmt"
	"math"
)

// RecorderMeasureDispatch is the command transport seam used by recorder
// measurement and its focused tests.
type RecorderMeasureDispatch func(method string, params map[string]interface{}, port int) (interface{}, error)

// ValidRecorderMeasureTabID accepts positive integral tab IDs. Isolated
// contexts use negative IDs, which recorder replay cannot preserve: its
// ensurePlayableTab path uses chrome.tabs.get and may replace an invalid tab
// with a regular Chrome tab.
func ValidRecorderMeasureTabID(value interface{}) bool {
	switch id := value.(type) {
	case int:
		return id > 0
	case int32:
		return id > 0
	case int64:
		return id > 0
	case float64:
		return id > 0 && !math.IsInf(id, 0) && !math.IsNaN(id) && math.Trunc(id) == id && id < float64(math.MaxInt64)
	default:
		return false
	}
}

// RecorderResultFailure reports an explicit unsuccessful recorder response.
// Responses that omit success retain their existing command semantics.
func RecorderResultFailure(value interface{}) error {
	result, ok := value.(map[string]interface{})
	if !ok {
		return nil
	}
	success, explicit := result["success"].(bool)
	if !explicit || success {
		return nil
	}
	if message, ok := result["error"].(string); ok && message != "" {
		return fmt.Errorf("%s", message)
	}
	if message, ok := result["message"].(string); ok && message != "" {
		return fmt.Errorf("%s", message)
	}
	return fmt.Errorf("recorder command returned success:false")
}

// RunRecorderMeasure starts a trace, replays a flow on that same tab, then
// stops the trace. It returns stage data even when a stage fails so callers can
// surface useful diagnostics. Trace event details are summarized by default
// and can be retained by setting includeEvents in replayParams.
func RunRecorderMeasure(tabID interface{}, replayParams map[string]interface{}, port int, dispatch RecorderMeasureDispatch) (map[string]interface{}, error) {
	result := map[string]interface{}{"success": false, "tabId": tabID}
	if dispatch == nil {
		result["failurePhase"] = "traceStart"
		result["error"] = "recorder measure has no command dispatcher"
		return result, fmt.Errorf("%s", result["error"])
	}

	traceStart, err := dispatch("performance.trace", map[string]interface{}{"tabId": tabID, "action": "start"}, port)
	result["traceStart"] = traceStart
	if err != nil {
		result["failurePhase"] = "traceStart"
		result["error"] = err.Error()
		return result, fmt.Errorf("trace start: %w", err)
	}
	if !recorderMeasurePhaseSucceeded(traceStart) {
		result["failurePhase"] = "traceStart"
		result["error"] = recorderMeasurePhaseError("trace start", traceStart)
		return result, fmt.Errorf("%s", result["error"])
	}

	replay := cloneRecorderMeasureParams(replayParams)
	replay["tabId"] = tabID
	replayResult, replayErr := dispatch("flow.replay", replay, port)
	result["replay"] = replayResult
	if replayErr != nil {
		result["failurePhase"] = "replay"
		result["error"] = replayErr.Error()
	} else if recorderMeasurePhaseSucceeded(replayResult) {
		actualTabID, hasTabID := recorderMeasureResultTabID(replayResult)
		result["actualTabId"] = actualTabID
		if !hasTabID {
			result["failurePhase"] = "replay"
			result["error"] = "replay succeeded without reporting the tabId used"
		} else if !sameRecorderMeasureTabID(tabID, actualTabID) {
			result["failurePhase"] = "replay"
			result["error"] = fmt.Sprintf("replay used tabId %v; requested tabId %v", actualTabID, tabID)
		}
	} else {
		result["failurePhase"] = "replay"
		result["error"] = recorderMeasurePhaseError("replay", replayResult)
	}

	traceStop, stopErr := dispatch("performance.trace", map[string]interface{}{"tabId": tabID, "action": "stop"}, port)
	if include, _ := replayParams["includeEvents"].(bool); !include {
		traceStop = compactRecorderMeasureTrace(traceStop)
	}
	result["trace"] = traceStop
	if stopErr != nil {
		if result["failurePhase"] == nil {
			result["failurePhase"] = "traceStop"
			result["error"] = stopErr.Error()
		} else {
			result["traceStopError"] = stopErr.Error()
		}
	} else if !recorderMeasurePhaseSucceeded(traceStop) {
		stopFailure := recorderMeasurePhaseError("trace stop", traceStop)
		if result["failurePhase"] == nil {
			result["failurePhase"] = "traceStop"
			result["error"] = stopFailure
		} else {
			result["traceStopError"] = stopFailure
		}
	}

	if result["failurePhase"] != nil {
		return result, fmt.Errorf("%v", result["error"])
	}
	result["success"] = true
	return result, nil
}

func recorderMeasurePhaseSucceeded(value interface{}) bool {
	phase, ok := value.(map[string]interface{})
	if !ok {
		return false
	}
	success, ok := phase["success"].(bool)
	return ok && success
}

func recorderMeasurePhaseError(phase string, value interface{}) string {
	if result, ok := value.(map[string]interface{}); ok {
		if message, ok := result["error"].(string); ok && message != "" {
			return phase + ": " + message
		}
		if message, ok := result["message"].(string); ok && message != "" {
			return phase + ": " + message
		}
	}
	return phase + " returned no explicit success:true"
}

func recorderMeasureResultTabID(value interface{}) (interface{}, bool) {
	result, ok := value.(map[string]interface{})
	if !ok {
		return nil, false
	}
	tabID, exists := result["tabId"]
	return tabID, exists
}

func sameRecorderMeasureTabID(expected, actual interface{}) bool {
	expectedID, expectedOK := recorderMeasureTabIDNumber(expected)
	actualID, actualOK := recorderMeasureTabIDNumber(actual)
	return expectedOK && actualOK && expectedID == actualID
}

func recorderMeasureTabIDNumber(value interface{}) (int64, bool) {
	switch id := value.(type) {
	case int:
		return int64(id), id > 0
	case int32:
		return int64(id), id > 0
	case int64:
		return id, id > 0
	case float64:
		if !ValidRecorderMeasureTabID(id) {
			return 0, false
		}
		return int64(id), true
	default:
		return 0, false
	}
}

func cloneRecorderMeasureParams(params map[string]interface{}) map[string]interface{} {
	cloned := make(map[string]interface{}, len(params)+1)
	for key, value := range params {
		cloned[key] = value
	}
	return cloned
}

func compactRecorderMeasureTrace(value interface{}) interface{} {
	trace, ok := value.(map[string]interface{})
	if !ok {
		return value
	}
	compact := cloneRecorderMeasureParams(trace)
	if events, ok := compact["eventsSummary"].([]interface{}); ok {
		compact["eventSummaryCount"] = len(events)
		delete(compact, "eventsSummary")
	}
	return compact
}
