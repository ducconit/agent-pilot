// bridge.go owns the bridge server lifecycle and HTTP routing: it starts the
// dual-mode (WebSocket + HTTP) listener, wires the request mux, and serves the
// health endpoint.
//
// The remaining bridge concerns live in dedicated files:
//   - bridge_client.go  → extension connections & request/response correlation
//   - bridge_api.go     → HTTP JSON-RPC surface & feedback endpoints
//   - bridge_timeout.go → command timeout derivation policy

package bridge

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync/atomic"

	"github.com/ducconit/agent-pilot-extension/cli/config"
	"github.com/ducconit/agent-pilot-extension/cli/version"
)

func handleHealth(w http.ResponseWriter, r *http.Request) {
	clientsLock.RLock()
	conns := make([]*ClientConnection, 0, len(clients))
	for _, c := range clients {
		conns = append(conns, c)
	}
	sort.Slice(conns, func(i, j int) bool {
		return conns[i].ConnectedAt.Before(conns[j].ConnectedAt)
	})
	clientList := make([]map[string]interface{}, 0, len(conns))
	for _, c := range conns {
		clientList = append(clientList, describeClientConnection(c, activeClientID))
	}
	extConnected := len(clientList) > 0
	clientsLock.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":             "ok",
		"name":               "Agent Pilot Go Bridge Server",
		"port":               ActiveBridgePort(),
		"extensionConnected": extConnected,
		"clientCount":        len(clientList),
		"version":            version.Raw(),
		"clients":            clientList,
	})
}

// StartBridgeServer runs the dual-mode WebSocket/HTTP server
func StartBridgeServer(port int) error {
	if port <= 0 {
		port = config.DefaultBridgePort()
	}
	// Remember the effective port so /health reports what is actually bound
	// (the server may be started with --port or AGENT_PILOT_PORT).
	activeBridgePort.Store(int32(port))
	addr := fmt.Sprintf("%s:%d", config.DefaultHost, port)

	// Test if port is already open (Dual Mode)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("port %d is already in use: %w", port, err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			handleWebSocket(w, r)
			return
		}
		if r.URL.Path == "/" || r.URL.Path == "/health" {
			if requireHTTPAuth(w, r) {
				handleHealth(w, r)
			}
			return
		}
		http.NotFound(w, r)
	})

	mux.HandleFunc("/api", WithHTTPAuth(handleHTTPAPI))
	mux.HandleFunc("/api/feedback/save", WithHTTPAuth(handleFeedbackSaveEndpoint))
	mux.HandleFunc("/api/feedback/push", WithHTTPAuth(handleFeedbackSaveEndpoint))
	mux.HandleFunc("/api/feedback/pending", WithHTTPAuth(handleFeedbackPendingEndpoint))
	mux.HandleFunc("/api/feedback/wait", WithHTTPAuth(handleFeedbackWaitEndpoint))

	log.Printf("[AgentPilot Go] 🚀 Bridge Server listening on http://%s (WebSocket: ws://%s)", addr, addr)
	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: config.HTTPReadHeaderTimeout,
		ReadTimeout:       config.HTTPReadTimeout,
		WriteTimeout:      config.HTTPWriteTimeout,
		IdleTimeout:       config.HTTPIdleTimeout,
	}
	return server.Serve(listener)
}

// activeBridgePort is the port the in-process bridge actually bound to.
// It starts at the configured default and is updated by StartBridgeServer so
// /health and error messages report the real listener, not a guess.
var activeBridgePort atomic.Int32

func init() {
	activeBridgePort.Store(int32(config.DefaultBridgePort()))
}

// ActiveBridgePort returns the effective port for in-process bridge operations.
func ActiveBridgePort() int {
	p := int(activeBridgePort.Load())
	if p <= 0 {
		return config.DefaultBridgePort()
	}
	return p
}
