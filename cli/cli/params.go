// params.go holds the shared parameter builders used by the interaction
// commands: the page.click and page.drag payloads and the input-backend
// normalizer they share. They were split out of the old client.go alongside
// DispatchCommand (which now lives in the bridge package).

package cli

import (
	"fmt"
	"strings"
)

// BuildClickParams builds the page.click payload. via: synthetic (default) | cdp | auto.
func BuildClickParams(selector string, x, y float64, via string) (map[string]interface{}, error) {
	params := map[string]interface{}{}
	if selector != "" {
		params["selector"] = selector
	}
	if x > 0 || y > 0 {
		params["x"] = x
		params["y"] = y
	}
	via = normalizeVia(via)
	if via != "synthetic" {
		params["via"] = via
	}
	if selector == "" && !(x > 0 || y > 0) {
		return nil, fmt.Errorf("click requires a selector or x/y coordinates")
	}
	return params, nil
}

func normalizeVia(via string) string {
	switch strings.ToLower(strings.TrimSpace(via)) {
	case "cdp", "auto":
		return strings.ToLower(strings.TrimSpace(via))
	default:
		return "synthetic"
	}
}

// BuildDragParams builds the page.drag payload from selectors and/or coordinates.
// Requires either both selectors or all four coordinates.
func BuildDragParams(fromSelector, toSelector string, fromX, fromY, toX, toY float64, steps, holdMs int, via string) (map[string]interface{}, error) {
	hasSelectors := fromSelector != "" && toSelector != ""
	hasFromCoords := fromX >= 0 && fromY >= 0
	hasToCoords := toX >= 0 && toY >= 0
	hasCoords := hasFromCoords && hasToCoords

	if !hasSelectors && !hasCoords {
		return nil, fmt.Errorf("drag requires both selectors or all four coordinates (--from-x --from-y --to-x --to-y)")
	}

	params := map[string]interface{}{}
	if hasSelectors {
		params["from"] = fromSelector
		params["to"] = toSelector
	}
	if hasFromCoords {
		params["fromX"] = fromX
		params["fromY"] = fromY
	}
	if hasToCoords {
		params["toX"] = toX
		params["toY"] = toY
	}
	if steps > 0 {
		params["steps"] = steps
	}
	if holdMs > 0 {
		params["holdMs"] = holdMs
	}
	via = normalizeVia(via)
	if via != "synthetic" {
		params["via"] = via
	}
	return params, nil
}
