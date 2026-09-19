// bridge_timeout.go holds the timeout derivation policy for outgoing commands.
//
// Policy summary
// --------------
//   - batch.run: never shorter than a five-minute floor; every action adds a
//     rough per-action estimate (wait/sleep honour explicit ms/duration values,
//     navigation honours loadTimeout, everything else falls back to a small
//     constant) and the whole batch gains a fixed overhead so slow pages fit.
//   - page.waitFor/page.wait: the requested wait plus a small buffer, but never
//     less than an explicitly supplied default.
//   - everything else: the caller's default, or config.DefaultCommandTimeoutMs when
//     the caller passes 0 (meaning "no preference").

package bridge

import (
	"fmt"
	"strings"

	"github.com/ducconit/agent-pilot/cli/internal/config"
)

func deriveBatchTimeout(params map[string]interface{}, defaultTimeoutMs int) int {
	minBatch := config.BatchBaseTimeoutMs // 5 minutes base timeout for batches
	if defaultTimeoutMs > minBatch {
		minBatch = defaultTimeoutMs
	}

	estDuration := 0
	if params != nil {
		if t, ok := getIntOrFloat(params, "timeoutMs"); ok && t > 0 {
			estDuration = t
		} else if t, ok := getIntOrFloat(params, "timeout"); ok && t > 0 {
			estDuration = t
		}

		if acts, ok := params["actions"].([]interface{}); ok && len(acts) > 0 {
			actsSum := 0
			for _, item := range acts {
				act, ok := item.(map[string]interface{})
				if !ok {
					actsSum += config.BatchDefaultActionMs
					continue
				}
				actType := strings.ToLower(fmt.Sprintf("%v", act["type"]))
				if actType == "" || actType == "<nil>" {
					actType = strings.ToLower(fmt.Sprintf("%v", act["action"]))
				}
				switch actType {
				case "wait", "sleep":
					hasTarget := false
					if sel, ok := act["selector"].(string); ok && sel != "" {
						hasTarget = true
					}
					if txt, ok := act["text"].(string); ok && txt != "" {
						hasTarget = true
					}
					if hasTarget {
						if ms, ok := getIntOrFloat(act, "timeoutMs"); ok && ms > 0 {
							actsSum += ms
						} else if ms, ok := getIntOrFloat(act, "timeout"); ok && ms > 0 {
							actsSum += ms
						} else {
							actsSum += config.BatchWaitWithTargetMs
						}
					} else {
						if ms, ok := getIntOrFloat(act, "ms"); ok && ms > 0 {
							actsSum += ms
						} else if ms, ok := getIntOrFloat(act, "duration"); ok && ms > 0 {
							actsSum += ms
						} else if ms, ok := getIntOrFloat(act, "timeoutMs"); ok && ms > 0 {
							actsSum += ms
						} else if ms, ok := getIntOrFloat(act, "timeout"); ok && ms > 0 {
							actsSum += ms
						} else {
							actsSum += config.BatchWaitDefaultMs
						}
					}

				case "wait_for", "waitfor":
					if ms, ok := getIntOrFloat(act, "timeoutMs"); ok && ms > 0 {
						actsSum += ms
					} else if ms, ok := getIntOrFloat(act, "timeout"); ok && ms > 0 {
						actsSum += ms
					} else {
						actsSum += config.BatchWaitForDefaultMs
					}

				case "wait_for_selector":
					if ms, ok := getIntOrFloat(act, "timeoutMs"); ok && ms > 0 {
						actsSum += ms
					} else if ms, ok := getIntOrFloat(act, "timeout"); ok && ms > 0 {
						actsSum += ms
					} else {
						actsSum += config.BatchWaitForSelDefaultMs
					}

				case "open", "open_tab", "tabs.create", "navigate", "tabs.update", "load":
					loadTo := config.BatchNavigateLoadDefaultMs
					if lt, ok := getIntOrFloat(act, "loadTimeout"); ok && lt > 0 {
						loadTo = lt
					} else if lt, ok := getIntOrFloat(act, "timeoutMs"); ok && lt > 0 {
						loadTo = lt
					} else if lt, ok := getIntOrFloat(act, "timeout"); ok && lt > 0 {
						loadTo = lt
					}
					actsSum += loadTo

				default:
					actsSum += config.BatchDefaultActionMs
				}
			}
			if actsSum > estDuration {
				estDuration = actsSum
			}
		}
	}

	// Apply the fixed overhead exactly once (the previous implementation added it
	// both here and inside the actions loop, inflating every batch timeout).
	if total := estDuration + config.BatchActionsOverheadMs; total > minBatch {
		return total
	}
	return minBatch
}

// DeriveCommandTimeout derives the appropriate RPC/HTTP timeout in ms based on command type and params
func DeriveCommandTimeout(method string, params map[string]interface{}, defaultTimeoutMs int) int {
	if method == "batch.run" {
		return deriveBatchTimeout(params, defaultTimeoutMs)
	}
	if method == "page.waitFor" || method == "page.wait" {
		waitMs := config.PageWaitDefaultMs
		if params != nil {
			if t, ok := getIntOrFloat(params, "timeoutMs"); ok && t > 0 {
				waitMs = t
			} else if t, ok := getIntOrFloat(params, "timeout"); ok && t > 0 {
				waitMs = t
			}
		}
		effective := waitMs + config.PageWaitBufferMs
		if defaultTimeoutMs > effective {
			return defaultTimeoutMs
		}
		return effective
	}
	if defaultTimeoutMs <= 0 {
		return config.DefaultCommandTimeoutMs
	}
	return defaultTimeoutMs
}
