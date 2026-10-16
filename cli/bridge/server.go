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
	"strings"
	"sync/atomic"

	"github.com/ducconit/agent-pilot-extension/cli/config"
	"github.com/ducconit/agent-pilot-extension/cli/version"
)

func handleHealth(w http.ResponseWriter, r *http.Request) {
	clientList := listConnectedClients()
	extConnected := len(clientList) > 0

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
	addr := fmt.Sprintf("%s:%d", config.DefaultHost, port)

	// Test if port is already open (Dual Mode)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("port %d is already in use: %w", port, err)
	}
	// Remember the effective port once bound so /health and DispatchFeedbackWait
	// know this process owns the active listener.
	setActiveBridgePort(port)
	defer setActiveBridgePort(0)

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
// Stored atomically so concurrent /health requests and background server
// startup never race.
var activeBridgePort atomic.Int32

func setActiveBridgePort(port int) {
	activeBridgePort.Store(int32(port))
}

// ActiveBridgePort returns the effective port for in-process bridge operations.
func ActiveBridgePort() int {
	if p := int(activeBridgePort.Load()); p > 0 {
		return p
	}
	return config.DefaultBridgePort()
}
