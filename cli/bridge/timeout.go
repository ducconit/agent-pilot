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

	"github.com/ducconit/agent-pilot-extension/cli/config"
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
					actsSum += loadTo + deriveInlineWaitBudgetMs(act)

				default:
					actsSum += config.BatchDefaultActionMs + deriveInlineWaitBudgetMs(act)
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

func deriveInlineSleepMs(params map[string]interface{}) int {
	if params == nil {
		return 0
	}
	for _, key := range []string{"waitMs", "sleepMs", "sleep", "wait", "ms", "duration"} {
		if v, ok := getIntOrFloat(params, key); ok && v > 0 {
			return v
		}
	}
	return 0
}

func deriveInlineWaitBudgetMs(params map[string]interface{}) int {
	if params == nil {
		return 0
	}
	sleepMs := deriveInlineSleepMs(params)
	hasCondition := false
	if sel, ok := params["waitForSelector"].(string); ok && strings.TrimSpace(sel) != "" {
		hasCondition = true
	}
	if txt, ok := params["waitForText"].(string); ok && strings.TrimSpace(txt) != "" {
		hasCondition = true
	}
	if !hasCondition {
		return sleepMs
	}
	condTimeout := config.BatchWaitForDefaultMs
	if t, ok := getIntOrFloat(params, "timeoutMs"); ok && t > 0 {
		condTimeout = t
	} else if t, ok := getIntOrFloat(params, "timeout"); ok && t > 0 {
		condTimeout = t
	}
	return condTimeout + sleepMs
}

// DeriveCommandTimeout derives the appropriate RPC/HTTP timeout in ms based on command type and params
func DeriveCommandTimeout(method string, params map[string]interface{}, defaultTimeoutMs int) int {
	if strings.HasPrefix(method, "lighthouse.") {
		// Lighthouse can wedge while waiting for lifecycle/runtime events over
		// the extension transport. Keep the default bounded and honor a caller's
		// shorter timeout so a failed audit cannot monopolize the runtime queue.
		if requested, ok := getIntOrFloat(params, "timeoutMs"); ok && requested > 0 {
			return requested
		}
		budget := 60000
		if defaultTimeoutMs > budget {
			budget = defaultTimeoutMs
		}
		return budget
	}
	if strings.HasPrefix(method, "contexts.") || strings.HasPrefix(method, "screencast.") || method == "performance.trace" || method == "performance.analyzeInsight" || method == "accessibility.snapshot" || method == "devtools.runtime" {
		budget := 180000
		if requested, ok := getIntOrFloat(params, "timeoutMs"); ok && requested > budget {
			budget = requested
		}
		if defaultTimeoutMs > budget {
			budget = defaultTimeoutMs
		}
		return budget
	}
	if method == "batch.run" {
		return deriveBatchTimeout(params, defaultTimeoutMs)
	}
	if method == "feedback.wait" {
		timeoutSec := config.DefaultFeedbackTimeoutSec
		if params != nil {
			if t, ok := getIntOrFloat(params, "timeout"); ok && t > 0 {
				timeoutSec = t
			}
		}
		effective := (timeoutSec * 1000) + config.PageWaitBufferMs
		if defaultTimeoutMs > effective {
			return defaultTimeoutMs
		}
		return effective
	}
	if method == "page.waitFor" || method == "page.wait" {
		waitMs := config.PageWaitDefaultMs
		explicitTimeout := false
		if params != nil {
			if t, ok := getIntOrFloat(params, "timeoutMs"); ok && t > 0 {
				waitMs = t
				explicitTimeout = true
			} else if t, ok := getIntOrFloat(params, "timeout"); ok && t > 0 {
				waitMs = t
				explicitTimeout = true
			}
		}
		if sleepExtra := deriveInlineSleepMs(params); sleepExtra > 0 {
			hasCondition := false
			for _, key := range []string{"selector", "text", "waitForSelector", "waitForText"} {
				if s, ok := params[key].(string); ok && strings.TrimSpace(s) != "" {
					hasCondition = true
					break
				}
			}
			if hasCondition {
				waitMs += sleepExtra
			} else if !explicitTimeout || sleepExtra > waitMs {
				waitMs = sleepExtra
			}
		}
		effective := waitMs + config.PageWaitBufferMs
		if defaultTimeoutMs > effective {
			return defaultTimeoutMs
		}
		return effective
	}

	baseTimeout := defaultTimeoutMs
	if baseTimeout <= 0 {
		baseTimeout = config.DefaultCommandTimeoutMs
	}

	if method == "tabs.create" || method == "tabs.update" {
		waitUntil := true
		if params != nil {
			if wu, ok := params["waitUntil"].(bool); ok {
				waitUntil = wu
			}
		}
		hasNav := method == "tabs.create"
		if method == "tabs.update" && params != nil {
			if u, ok := params["url"].(string); ok && strings.TrimSpace(u) != "" {
				hasNav = true
			}
		}
		if waitUntil && hasNav {
			loadTo := config.BatchNavigateLoadDefaultMs
			if params != nil {
				if lt, ok := getIntOrFloat(params, "loadTimeout"); ok && lt > 0 {
					loadTo = lt
				} else if lt, ok := getIntOrFloat(params, "timeoutMs"); ok && lt > 0 {
					loadTo = lt
				} else if lt, ok := getIntOrFloat(params, "timeout"); ok && lt > 0 {
					loadTo = lt
				}
			}
			navEffective := loadTo + config.PageWaitBufferMs
			if navEffective > baseTimeout {
				baseTimeout = navEffective
			}
		}
	}

	if method == "page.type" || method == "page.typeText" {
		if params != nil {
			if textStr, ok := params["text"].(string); ok && len(textStr) > 0 {
				delayMs := 40
				if d, ok := getIntOrFloat(params, "delay"); ok && d > 0 {
					delayMs = d
				}
				// Estimate typing duration: length * delay + 2500ms mouse move / focus buffer
				estimated := (len(textStr) * delayMs) + 2500
				effective := estimated + config.PageWaitBufferMs
				if effective > baseTimeout {
					baseTimeout = effective
				}
			}
		}
	}

	if inlineExtra := deriveInlineWaitBudgetMs(params); inlineExtra > 0 {
		baseTimeout += inlineExtra
	}

	return baseTimeout
}
