// config.go is the single source of truth for the Agent Pilot CLI's tunable
// values: server identity, HTTP/WebSocket timeouts, request body caps, command
// dispatch timing, timeout-derivation policy, feedback storage settings and the
// background-service identifiers.
//
// Keeping these literals in one commented block means behaviour can be reasoned
// about and adjusted here instead of hunting magic numbers spread across the
// bridge, mcp, client and feedback packages. Callers reference the named
// constants so the intent ("this is the read deadline", "this is the batch
// floor") stays visible at the use site.

package config

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
	HTTPReadHeaderTimeout = 5 * time.Second
	HTTPReadTimeout       = 15 * time.Second
	HTTPWriteTimeout      = 30 * time.Second
	HTTPIdleTimeout       = 60 * time.Second

	// --- WebSocket connection tuning (handleWebSocket) ----------------------
	// The read limit is deliberately generous: the extension pushes base64 PNG
	// screenshots and large DOM snapshots back over the socket.
	WSReadLimitBytes      = 50 * 1024 * 1024
	WSReadTimeout         = 90 * time.Second
	WSPingInterval        = 30 * time.Second
	WSWriteControlTimeout = 5 * time.Second

	// --- Request / response body caps ---------------------------------------
	MaxAPIBodyBytes      = 5 * 1024 * 1024  // generic /api JSON-RPC payloads and small feedback control bodies
	MaxFeedbackBodyBytes = 50 * 1024 * 1024 // feedback.save accepts inline base64 screenshots
	MaxForwardBody       = 16 * 1024 * 1024 // response forwarded from a master bridge
	MaxMCPLineBytes      = 8 * 1024 * 1024  // single stdio JSON-RPC message

	// --- Command dispatch timing --------------------------------------------
	// DefaultCommandTimeoutMs applies when a command has no explicit timeout.
	// DefaultWaitTimeoutMs is the default `agent-pilot wait` budget.
	DefaultCommandTimeoutMs   = 15000
	DefaultWaitTimeoutMs      = 10000
	ConfigRPCCommandTimeoutMs = 2000  // config.get/setSecretFilter round trips
	ForwardCommandTimeoutMs   = 30000 // default when forwarding to a master bridge
	// Master-probe and embedded-server readiness polling in DispatchCommand:
	// probe the port, then retry dialing until EmbeddedReadyBudget elapses.
	MasterProbeDialTimeout     = 200 * time.Millisecond
	EmbeddedReadyDialTimeout   = 100 * time.Millisecond
	EmbeddedReadyRetryInterval = 50 * time.Millisecond
	EmbeddedReadyBudget        = time.Second

	// --- Timeout derivation policy (bridge/timeout.go) ----------------------
	// Batch commands never get less than a five-minute base budget; every action
	// contributes a rough estimate and the batch as a whole gains a fixed slack.
	BatchBaseTimeoutMs         = 300000 // 5 minute floor for batch.run
	BatchActionsOverheadMs     = 30000  // fixed slack added to a derived batch estimate
	BatchWaitWithTargetMs      = 10000  // wait/sleep that also waits for a selector/text
	BatchWaitDefaultMs         = 5000   // wait/sleep without a target
	BatchWaitForDefaultMs      = 10000  // wait_for / waitfor
	BatchWaitForSelDefaultMs   = 5000   // wait_for_selector
	BatchNavigateLoadDefaultMs = 30000  // open/navigate default page-load budget
	BatchDefaultActionMs       = 5000   // any other action type
	PageWaitDefaultMs          = 30000  // page.waitFor default wait budget
	PageWaitBufferMs           = 5000   // slack added on top of a page.waitFor timeout

	// --- Feedback subsystem -------------------------------------------------
	MaxFeedbackWaiters        = 32  // concurrent /api/feedback/wait long-polls
	DefaultFeedbackTimeoutSec = 120 // default long-poll timeout in seconds
	DefaultFeedbackListLimit  = 10  // default sessions returned by list/pending
	FeedbackDirPerm           = 0700
	FeedbackFilePerm          = 0600
	FeedbackHomeEnvVar        = "AGENT_PILOT_HOME"
	FeedbackDefaultDirName    = ".agent-pilot"
	FeedbackInboxDirName      = "inbox"
	FeedbackDirName           = "feedback"
	FeedbackArchiveDirName    = "feedback_archive"

	// --- Background service identifiers -------------------------------------
	// Referenced by the service package when generating systemd/launchd/Task
	// Scheduler definitions. ServerSubcommand is the CLI subcommand the service
	// re-runs.
	ServerSubcommand = "server"
	ServiceNameLinux = "agent-pilot.service"
	PlistNameDarwin  = "com.agentpilot.bridge.plist"
	TaskNameWindows  = "AgentPilotBridge"
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
