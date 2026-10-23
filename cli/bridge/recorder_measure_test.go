package bridge

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestValidRecorderMeasureTabID(t *testing.T) {
	for _, value := range []interface{}{1, int32(2), int64(3), float64(4)} {
		if !ValidRecorderMeasureTabID(value) {
			t.Errorf("positive integer tab ID %v (%T) rejected", value, value)
		}
	}
	for _, value := range []interface{}{0, -1, int64(-2), float64(0), float64(-3), float64(1.5), "42", nil} {
		if ValidRecorderMeasureTabID(value) {
			t.Errorf("invalid tab ID %v (%T) accepted", value, value)
		}
	}
}

func TestRunRecorderMeasureStopsTraceAfterReplayPayloadFailure(t *testing.T) {
	tabID := 42
	var methods []string
	var traceTabs []interface{}
	dispatch := func(method string, params map[string]interface{}, port int) (interface{}, error) {
		methods = append(methods, method)
		if port != 58766 {
			t.Fatalf("dispatch port = %d, want 58766", port)
		}
		traceTabs = append(traceTabs, params["tabId"])
		switch method {
		case "performance.trace":
			if params["action"] == "start" {
				return map[string]interface{}{"success": true}, nil
			}
			return map[string]interface{}{"success": true, "eventsSummary": []interface{}{"event"}}, nil
		case "flow.replay":
			return map[string]interface{}{"success": false, "error": "selector not found"}, nil
		default:
			t.Fatalf("unexpected method %q", method)
			return nil, nil
		}
	}

	result, err := RunRecorderMeasure(tabID, map[string]interface{}{"tabId": 999}, 58766, dispatch)
	if err == nil || result["success"] != false || result["failurePhase"] != "replay" {
		t.Fatalf("expected replay failure metadata, result=%v err=%v", result, err)
	}
	if result["error"] != "replay: selector not found" {
		t.Fatalf("failure error = %v", result["error"])
	}
	if got, want := methods, []string{"performance.trace", "flow.replay", "performance.trace"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("dispatch sequence = %v, want %v", got, want)
	}
	if len(traceTabs) != 3 || traceTabs[0] != tabID || traceTabs[1] != tabID || traceTabs[2] != tabID {
		t.Fatalf("trace/replay tab IDs differ: %v", traceTabs)
	}
	trace := result["trace"].(map[string]interface{})
	if trace["eventSummaryCount"] != 1 || trace["eventsSummary"] != nil {
		t.Fatalf("trace was not compacted: %v", trace)
	}
}

func TestRunRecorderMeasureDoesNotReplayAfterTraceStartFailure(t *testing.T) {
	calls := 0
	dispatch := func(method string, params map[string]interface{}, port int) (interface{}, error) {
		calls++
		return map[string]interface{}{"success": false, "error": "debugger unavailable"}, nil
	}
	result, err := RunRecorderMeasure(42, nil, 58765, dispatch)
	if err == nil || calls != 1 || result["failurePhase"] != "traceStart" || result["success"] != false {
		t.Fatalf("expected trace start failure without replay, calls=%d result=%v err=%v", calls, result, err)
	}
}

func TestRunRecorderMeasureReportsTraceStopFailure(t *testing.T) {
	dispatch := func(method string, params map[string]interface{}, port int) (interface{}, error) {
		if method == "flow.replay" {
			return map[string]interface{}{"success": true, "tabId": 42}, nil
		}
		if params["action"] == "start" {
			return map[string]interface{}{"success": true}, nil
		}
		return map[string]interface{}{"success": false, "error": "Tracing.end rejected"}, nil
	}
	result, err := RunRecorderMeasure(42, nil, 58765, dispatch)
	if err == nil || result["success"] != false || result["failurePhase"] != "traceStop" {
		t.Fatalf("expected trace stop failure, result=%v err=%v", result, err)
	}
	if !strings.Contains(err.Error(), "Tracing.end rejected") {
		t.Fatalf("trace stop diagnostic missing from error: %v", err)
	}
}

func TestRunRecorderMeasurePreservesEventsWhenRequestedAndRecordsTransportFailures(t *testing.T) {
	dispatch := func(method string, params map[string]interface{}, port int) (interface{}, error) {
		if method == "flow.replay" {
			return map[string]interface{}{"success": true, "tabId": 42}, nil
		}
		if params["action"] == "start" {
			return map[string]interface{}{"success": true}, nil
		}
		return map[string]interface{}{"success": true, "eventsSummary": []interface{}{"event"}}, nil
	}
	result, err := RunRecorderMeasure(42, map[string]interface{}{"includeEvents": true}, 58765, dispatch)
	if err != nil || result["success"] != true {
		t.Fatalf("expected successful measurement, result=%v err=%v", result, err)
	}
	trace := result["trace"].(map[string]interface{})
	if trace["eventsSummary"] == nil || trace["eventSummaryCount"] != nil {
		t.Fatalf("includeEvents should preserve event details: %v", trace)
	}

	transportErr := errors.New("bridge disconnected")
	result, err = RunRecorderMeasure(42, nil, 58765, func(method string, params map[string]interface{}, port int) (interface{}, error) {
		if method == "flow.replay" {
			return nil, transportErr
		}
		return map[string]interface{}{"success": true}, nil
	})
	if err == nil || result["failurePhase"] != "replay" || result["trace"] == nil {
		t.Fatalf("replay transport failure should still stop trace and retain metadata: result=%v err=%v", result, err)
	}
}

func TestRunRecorderMeasureFailsWhenReplayChangesOrOmitsTabID(t *testing.T) {
	for _, test := range []struct {
		name          string
		replayResult  map[string]interface{}
		wantActualTab interface{}
		wantErrorPart string
	}{
		{name: "replacement tab", replayResult: map[string]interface{}{"success": true, "tabId": float64(99)}, wantActualTab: float64(99), wantErrorPart: "used tabId 99"},
		{name: "missing tab", replayResult: map[string]interface{}{"success": true}, wantActualTab: nil, wantErrorPart: "without reporting the tabId"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var methods []string
			result, err := RunRecorderMeasure(42, nil, 58765, func(method string, params map[string]interface{}, port int) (interface{}, error) {
				methods = append(methods, method)
				switch method {
				case "performance.trace":
					return map[string]interface{}{"success": true}, nil
				case "flow.replay":
					return test.replayResult, nil
				default:
					t.Fatalf("unexpected method %q", method)
					return nil, nil
				}
			})
			if err == nil || result["success"] != false || result["failurePhase"] != "replay" {
				t.Fatalf("expected replay provenance failure, result=%v err=%v", result, err)
			}
			if result["actualTabId"] != test.wantActualTab || !strings.Contains(err.Error(), test.wantErrorPart) {
				t.Fatalf("actual tab/error metadata mismatch: actualTabId=%v err=%v", result["actualTabId"], err)
			}
			if got, want := methods, []string{"performance.trace", "flow.replay", "performance.trace"}; !reflect.DeepEqual(got, want) {
				t.Fatalf("dispatch sequence = %v, want trace stop after replay: %v", got, want)
			}
		})
	}
}
