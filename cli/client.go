// client.go owns command dispatch and the shared parameter builders.
//
// DispatchCommand decides whether a master bridge is already listening: if so it
// forwards over HTTP, otherwise it starts an embedded bridge and waits for it to
// become ready. The concrete Exec* commands live in client_commands.go
// (interaction) and client_cdp_commands.go (CDP-backed).

package main

import (
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"time"
)

// DispatchCommand routes the command either via local in-memory bridge or forwarder HTTP
func DispatchCommand(method string, params map[string]interface{}, port int) (interface{}, error) {
	if port <= 0 {
		port = DefaultPort
	}

	addr := net.JoinHostPort(DefaultHost, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, masterProbeDialTimeout)
	if err == nil {
		_ = conn.Close()
		// Master bridge is running on port -> forward via HTTP
		return ForwardCommandToActiveServer(method, params, port)
	}

	// Master bridge is NOT running -> start embedded bridge in background
	go func() {
		if err := StartBridgeServer(port); err != nil {
			log.Printf("[AgentPilot Go] Embedded bridge server error: %v", err)
		}
	}()

	// Poll until the embedded server is accepting connections (up to ~1s). The
	// listener is created asynchronously, so a short retry loop avoids racing
	// the first command against server start-up.
	deadline := time.Now().Add(embeddedReadyBudget)
	for time.Now().Before(deadline) {
		probe, dialErr := net.DialTimeout("tcp", addr, embeddedReadyDialTimeout)
		if dialErr == nil {
			_ = probe.Close()
			break
		}
		time.Sleep(embeddedReadyRetryInterval)
	}

	// Now try dispatching
	return SendCommandToExtension(method, params, DeriveCommandTimeout(method, params, defaultCommandTimeoutMs))
}

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
