// config.go is the single source of truth for the Agent Pilot CLI's tunable
// values: server identity, HTTP/WebSocket timeouts, request body caps, command
// dispatch timing, timeout-derivation policy, feedback storage settings and the
// background-service identifiers.
//
// Keeping these literals in one commented block means behaviour can be reasoned
// about and adjusted here instead of hunting magic numbers spread across
// bridge_*, mcp*, main, client* and feedback*. Callers reference the named
// constants so the intent ("this is the read deadline", "this is the batch
// floor") stays visible at the use site.

package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	// --- Server identity & defaults -----------------------------------------
	// DefaultPort/DefaultHost are the built-in bridge listen address; the
	// environment variable AGENT_PILOT_PORT (see DefaultBridgePort) can override
	// the port. ServerVersion is reported by /health, the ping API and the MCP
	// initialize handshake.
	DefaultPort   = 58765
	DefaultHost   = "127.0.0.1"
	ServerVersion = "1.0.8-beta"

	// --- HTTP server timeouts (StartBridgeServer) ---------------------------
	httpReadHeaderTimeout = 5 * time.Second
	httpReadTimeout       = 15 * time.Second
	httpWriteTimeout      = 30 * time.Second
	httpIdleTimeout       = 60 * time.Second

	// --- WebSocket connection tuning (handleWebSocket) ----------------------
	// The read limit is deliberately generous: the extension pushes base64 PNG
	// screenshots and large DOM snapshots back over the socket.
	wsReadLimitBytes      = 50 * 1024 * 1024
	wsReadTimeout         = 90 * time.Second
	wsPingInterval        = 30 * time.Second
	wsWriteControlTimeout = 5 * time.Second

	// --- Request / response body caps ---------------------------------------
	maxAPIBodyBytes      = 5 * 1024 * 1024  // generic /api JSON-RPC payloads and small feedback control bodies
	maxFeedbackBodyBytes = 50 * 1024 * 1024 // feedback.save accepts inline base64 screenshots
	maxForwardBody       = 16 * 1024 * 1024 // response forwarded from a master bridge
	maxMCPLineBytes      = 8 * 1024 * 1024  // single stdio JSON-RPC message

	// --- Command dispatch timing --------------------------------------------
	// defaultCommandTimeoutMs applies when a command has no explicit timeout.
	// defaultWaitTimeoutMs is the default `agent-pilot wait` budget.
	defaultCommandTimeoutMs   = 15000
	defaultWaitTimeoutMs      = 10000
	configRPCCommandTimeoutMs = 2000  // config.get/setSecretFilter round trips
	forwardCommandTimeoutMs   = 30000 // default when forwarding to a master bridge
	// Master-probe and embedded-server readiness polling in DispatchCommand:
	// probe the port, then retry dialing until embeddedReadyBudget elapses.
	masterProbeDialTimeout     = 200 * time.Millisecond
	embeddedReadyDialTimeout   = 100 * time.Millisecond
	embeddedReadyRetryInterval = 50 * time.Millisecond
	embeddedReadyBudget        = time.Second

	// --- Timeout derivation policy (bridge_timeout.go) ----------------------
	// Batch commands never get less than a five-minute base budget; every action
	// contributes a rough estimate and the batch as a whole gains a fixed slack.
	batchBaseTimeoutMs         = 300000 // 5 minute floor for batch.run
	batchActionsOverheadMs     = 30000  // fixed slack added to a derived batch estimate
	batchWaitWithTargetMs      = 10000  // wait/sleep that also waits for a selector/text
	batchWaitDefaultMs         = 5000   // wait/sleep without a target
	batchWaitForDefaultMs      = 10000  // wait_for / waitfor
	batchWaitForSelDefaultMs   = 5000   // wait_for_selector
	batchNavigateLoadDefaultMs = 30000  // open/navigate default page-load budget
	batchDefaultActionMs       = 5000   // any other action type
	pageWaitDefaultMs          = 30000  // page.waitFor default wait budget
	pageWaitBufferMs           = 5000   // slack added on top of a page.waitFor timeout

	// --- Feedback subsystem -------------------------------------------------
	maxFeedbackWaiters        = 32  // concurrent /api/feedback/wait long-polls
	defaultFeedbackTimeoutSec = 120 // default long-poll timeout in seconds
	defaultFeedbackListLimit  = 10  // default sessions returned by list/pending
	feedbackDirPerm           = 0700
	feedbackFilePerm          = 0600
	feedbackHomeEnvVar        = "AGENT_PILOT_HOME"
	feedbackDefaultDirName    = ".agent-pilot"
	feedbackInboxDirName      = "inbox"
	feedbackDirName           = "feedback"
	feedbackArchiveDirName    = "feedback_archive"

	// --- Background service identifiers -------------------------------------
	// Referenced by service.go when generating systemd/launchd/Task Scheduler
	// definitions. serverSubcommand is the CLI subcommand the service re-runs.
	serverSubcommand = "server"
	serviceNameLinux = "agent-pilot.service"
	plistNameDarwin  = "com.agentpilot.bridge.plist"
	taskNameWindows  = "AgentPilotBridge"
)

// DefaultBridgePort resolves the bridge port, honoring the AGENT_PILOT_PORT
// environment variable and falling back to DefaultPort. A malformed, non-numeric
// or out-of-range override is ignored rather than fatal, so a bad env value
// degrades to the built-in default.
func DefaultBridgePort() int {
	if env := strings.TrimSpace(os.Getenv("AGENT_PILOT_PORT")); env != "" {
		if p, err := strconv.Atoi(env); err == nil && p > 0 && p < 65536 {
			return p
		}
	}
	return DefaultPort
}
