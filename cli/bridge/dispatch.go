// dispatch.go decides where a command goes: if a master bridge is already
// listening on the target port it forwards over HTTP, otherwise it starts an
// embedded bridge and waits for it to become ready before sending the command
// directly over the in-process WebSocket connection.

package bridge

import (
	"log"
	"net"
	"strconv"
	"time"

	"github.com/ducconit/agent-pilot-extension/cli/config"
	"github.com/ducconit/agent-pilot-extension/cli/feedback"
)

func ensureEmbeddedBridgeRunning(port int, addr string) {
	go func() {
		if err := StartBridgeServer(port); err != nil {
			log.Printf("[AgentPilot Go] Embedded bridge server error: %v", err)
		}
	}()

	// Poll until the embedded server is accepting connections (up to ~1s). The
	// listener is created asynchronously, so a short retry loop avoids racing
	// the first command against server start-up.
	deadline := time.Now().Add(config.EmbeddedReadyBudget)
	for time.Now().Before(deadline) {
		probe, dialErr := net.DialTimeout("tcp", addr, config.EmbeddedReadyDialTimeout)
		if dialErr == nil {
			_ = probe.Close()
			break
		}
		time.Sleep(config.EmbeddedReadyRetryInterval)
	}
}

// BridgeReachable reports whether a bridge is already listening on the target
// port. Keeping the probe in one place prevents MCP startup and command
// dispatch from each implementing slightly different EADDRINUSE handling.
func BridgeReachable(port int) bool {
	if port <= 0 {
		port = config.DefaultBridgePort()
	}
	addr := net.JoinHostPort(config.DefaultHost, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, config.MasterProbeDialTimeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// DispatchCommand routes the command either via local in-memory bridge or forwarder HTTP
func DispatchCommand(method string, params map[string]interface{}, port int) (interface{}, error) {
	if params == nil {
		params = make(map[string]interface{})
	}
	if _, explicitlySelected := params["instanceId"]; !explicitlySelected {
		if instanceID := config.DefaultInstanceID(); instanceID != "" {
			// Do not mutate the caller's map: MCP may reuse its argument object
			// across concurrent requests, and CLI helpers may log it after dispatch.
			cloned := make(map[string]interface{}, len(params)+1)
			for key, value := range params {
				cloned[key] = value
			}
			cloned["instanceId"] = instanceID
			params = cloned
		}
	}
	if port <= 0 {
		port = config.DefaultBridgePort()
	}

	addr := net.JoinHostPort(config.DefaultHost, strconv.Itoa(port))
	if BridgeReachable(port) {
		// Master bridge is running on port -> forward via HTTP
		return ForwardCommandToActiveServer(method, params, port)
	}

	// Master bridge is NOT running -> start embedded bridge in background
	ensureEmbeddedBridgeRunning(port, addr)
	if useDevtoolsHost(method, params) {
		return dispatchLocalCommand(method, params)
	}

	// Give the Chrome Extension a brief window to connect to the newly started
	// embedded server before failing with "no Chrome Extension connected".
	instanceID, _ := params["instanceId"].(string)
	clientDeadline := time.Now().Add(config.EmbeddedClientWaitBudget)
	for time.Now().Before(clientDeadline) {
		if getClientByID(instanceID) != nil {
			break
		}
		time.Sleep(config.EmbeddedReadyRetryInterval)
	}

	// Now try dispatching
	return dispatchLocalCommand(method, params)
}

// DispatchFeedbackWait routes a feedback long-poll either to an external master
// bridge server (propagating any auth/HTTP error directly instead of swallowing
// it) or to the in-process feedback waiter after ensuring the embedded bridge
// server is listening.
func DispatchFeedbackWait(timeout int, tabID interface{}, port int) (interface{}, error) {
	if port <= 0 {
		port = config.DefaultBridgePort()
	}

	// If this process is already running the bridge on port, wait directly in-process.
	if int(activeBridgePort.Load()) == port {
		return feedback.WaitForFeedback(timeout, tabID), nil
	}

	if BridgeReachable(port) {
		return ForwardCommandToActiveServer("feedback.wait", map[string]interface{}{
			"timeout": timeout,
			"tabId":   tabID,
		}, port)
	}

	addr := net.JoinHostPort(config.DefaultHost, strconv.Itoa(port))
	ensureEmbeddedBridgeRunning(port, addr)
	return feedback.WaitForFeedback(timeout, tabID), nil
}
