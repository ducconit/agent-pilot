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
)

// DispatchCommand routes the command either via local in-memory bridge or forwarder HTTP
func DispatchCommand(method string, params map[string]interface{}, port int) (interface{}, error) {
	if port <= 0 {
		port = config.DefaultBridgePort()
	}

	addr := net.JoinHostPort(config.DefaultHost, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, config.MasterProbeDialTimeout)
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
	deadline := time.Now().Add(config.EmbeddedReadyBudget)
	for time.Now().Before(deadline) {
		probe, dialErr := net.DialTimeout("tcp", addr, config.EmbeddedReadyDialTimeout)
		if dialErr == nil {
			_ = probe.Close()
			break
		}
		time.Sleep(config.EmbeddedReadyRetryInterval)
	}

	// Now try dispatching
	return SendCommandToExtension(method, params, DeriveCommandTimeout(method, params, config.DefaultCommandTimeoutMs))
}
