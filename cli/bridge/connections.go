// bridge_client.go owns the extension-connection domain: per-socket
// ClientConnection state, the request/response correlation map used to route
// commands to the extension, the WebSocket upgrade handler, origin validation
// and the descriptor builder used when listing instances.

package bridge

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ducconit/agent-pilot-extension/cli/config"
	"github.com/ducconit/agent-pilot-extension/cli/feedback"
	"github.com/gorilla/websocket"
)

type ClientConnection struct {
	ID          string
	WS          *websocket.Conn
	RemoteAddr  string
	ConnectedAt time.Time
	LastActive  time.Time
	Details     map[string]interface{}
	WriteMu     sync.Mutex
}

type PendingRequest struct {
	ClientID string
	Resolve  chan map[string]interface{}
}

var (
	clientsLock    sync.RWMutex
	clients        = make(map[string]*ClientConnection)
	activeClientID string

	// Request/response correlation protocol
	// -------------------------------------
	// requestCounter hands out a unique id for every outbound command.
	// pendingRequests maps that id to a buffered (size 1) channel that the
	// WebSocket reader resolves when the extension replies with the same id.
	// The channel is buffered so the reader never blocks, and entries are
	// deleted from the map *before* the reply is pushed onto the channel
	// (delete-before-send): once a waiter has been handed the reply no other
	// reader can observe or double-deliver it, and a late reply that arrives
	// after the caller timed out simply finds no entry and is dropped.
	pendingReqLock  sync.Mutex
	pendingRequests = make(map[int64]*PendingRequest)
	requestCounter  int64

	clientCounter  int64
	secretFilterOn int32 = 1 // default true
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return IsOriginAllowed(origin)
	},
}

// IsOriginAllowed validates origin against extension and localhost
func IsOriginAllowed(origin string) bool {
	if origin == "" {
		return true
	}
	if strings.HasPrefix(origin, "chrome-extension://") {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	h := u.Hostname()
	return h == "127.0.0.1" || h == "localhost"
}

func getClientByID(instanceID string) *ClientConnection {
	clientsLock.RLock()
	defer clientsLock.RUnlock()

	if instanceID != "" {
		if c, ok := clients[instanceID]; ok {
			return c
		}
	}
	if activeClientID != "" {
		if c, ok := clients[activeClientID]; ok {
			return c
		}
	}
	for _, c := range clients {
		return c
	}
	return nil
}

// SendCommandToExtension dispatches a command to a connected extension and
// blocks until the matching reply arrives or the (derived) timeout elapses.
//
// Correlation: a fresh id is allocated, a buffered channel is registered under
// that id, then the message is written. The reader goroutine (handleWebSocket)
// matches the reply id back to this channel, so concurrent callers never see
// each other's responses.
func SendCommandToExtension(method string, params map[string]interface{}, timeoutMs int) (interface{}, error) {
	instanceID, _ := params["instanceId"].(string)
	client := getClientByID(instanceID)
	if client == nil {
		return nil, fmt.Errorf("no Chrome Extension connected to Agent Pilot bridge on port %d", ActiveBridgePort())
	}

	reqID := atomic.AddInt64(&requestCounter, 1)
	msg := map[string]interface{}{
		"id":     reqID,
		"method": method,
		"params": params,
	}

	resChan := make(chan map[string]interface{}, 1)
	pendingReqLock.Lock()
	pendingRequests[reqID] = &PendingRequest{
		ClientID: client.ID,
		Resolve:  resChan,
	}
	pendingReqLock.Unlock()

	client.WriteMu.Lock()
	err := client.WS.WriteJSON(msg)
	client.WriteMu.Unlock()
	if err != nil {
		pendingReqLock.Lock()
		delete(pendingRequests, reqID)
		pendingReqLock.Unlock()
		return nil, fmt.Errorf("failed to send command to extension: %w", err)
	}

	timeoutMs = DeriveCommandTimeout(method, params, timeoutMs)
	timer := time.NewTimer(time.Duration(timeoutMs) * time.Millisecond)
	defer timer.Stop()

	select {
	case res := <-resChan:
		filterEnabled := atomic.LoadInt32(&secretFilterOn) == 1
		if errMsg, ok := res["error"].(string); ok && errMsg != "" {
			if sanitizedErr, ok := SanitizeData(errMsg, filterEnabled).(string); ok && sanitizedErr != "" {
				errMsg = sanitizedErr
			}
			return nil, fmt.Errorf("%s", errMsg)
		}
		resultData := res["result"]
		if strings.HasPrefix(method, "devtools.protocol.") {
			return resultData, nil
		}
		sanitized := SanitizeData(resultData, filterEnabled)
		return sanitized, nil

	case <-timer.C:
		// Remove the pending entry so a very late reply cannot leak a channel.
		pendingReqLock.Lock()
		delete(pendingRequests, reqID)
		pendingReqLock.Unlock()
		return nil, fmt.Errorf("command '%s' timed out after %dms", method, timeoutMs)
	}
}

// failPendingRequestsForClient wakes and removes any in-flight requests bound to
// a disconnected extension socket so callers fail immediately instead of hanging.
func failPendingRequestsForClient(clientID string) {
	pendingReqLock.Lock()
	var orphaned []*PendingRequest
	for id, req := range pendingRequests {
		if req.ClientID == clientID {
			delete(pendingRequests, id)
			orphaned = append(orphaned, req)
		}
	}
	pendingReqLock.Unlock()

	for _, req := range orphaned {
		select {
		case req.Resolve <- map[string]interface{}{"error": fmt.Sprintf("extension connection [%s] closed while command was in flight", clientID)}:
		default:
		}
	}
}

// listConnectedClients returns all active extension connections sorted by ConnectedAt.
func listConnectedClients() []map[string]interface{} {
	clientsLock.RLock()
	defer clientsLock.RUnlock()

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
	return clientList
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[BridgeServer] Upgrade error: %v", err)
		return
	}
	conn.SetReadLimit(config.WSReadLimitBytes)
	_ = conn.SetReadDeadline(time.Now().Add(config.WSReadTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(config.WSReadTimeout))
	})

	// When API-key auth is enabled, the extension proves possession in its
	// first HANDSHAKE frame. The key never appears in the WebSocket URL.
	var firstRaw []byte
	if AuthEnabled() {
		_, firstRaw, err = conn.ReadMessage()
		if err != nil {
			_ = conn.Close()
			return
		}
		var handshake map[string]interface{}
		if json.Unmarshal(firstRaw, &handshake) != nil || handshake["type"] != "HANDSHAKE" || !AuthorizeWebSocketHandshake(handshake) {
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "invalid API key"), time.Now().Add(config.WSWriteControlTimeout))
			_ = conn.Close()
			return
		}
	}

	clientSeq := atomic.AddInt64(&clientCounter, 1)
	clientID := fmt.Sprintf("browser_%d_%d", time.Now().UnixNano(), clientSeq)
	client := &ClientConnection{
		ID:          clientID,
		WS:          conn,
		RemoteAddr:  r.RemoteAddr,
		ConnectedAt: time.Now(),
		LastActive:  time.Now(),
		Details: map[string]interface{}{
			"browser": "Chromium",
			"os":      runtime.GOOS,
		},
	}

	clientsLock.Lock()
	clients[clientID] = client
	if activeClientID == "" {
		activeClientID = clientID
	}
	activeCount := len(clients)
	clientsLock.Unlock()

	log.Printf("[BridgeServer] 🔌 Extension connected [%s] from %s. Active clients: %d", clientID, r.RemoteAddr, activeCount)

	// Keepalive pinger: a dedicated goroutine writes a ping every interval so a
	// half-open socket is detected and torn down by the read deadline.
	pingDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(config.WSPingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				client.WriteMu.Lock()
				err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(config.WSWriteControlTimeout))
				client.WriteMu.Unlock()
				if err != nil {
					return
				}
			case <-pingDone:
				return
			}
		}
	}()

	defer func() {
		close(pingDone)
		clientsLock.Lock()
		delete(clients, clientID)
		if activeClientID == clientID {
			activeClientID = ""
			for k := range clients {
				activeClientID = k
				break
			}
		}
		clientsLock.Unlock()
		failPendingRequestsForClient(clientID)
		_ = conn.Close()
		log.Printf("[BridgeServer] 🔌 Extension disconnected [%s]", clientID)
	}()

	for {
		var raw []byte
		if firstRaw != nil {
			raw, firstRaw = firstRaw, nil
		} else {
			_, raw, err = conn.ReadMessage()
			if err != nil {
				break
			}
		}
		_ = conn.SetReadDeadline(time.Now().Add(config.WSReadTimeout))

		var msg map[string]interface{}
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		clientsLock.Lock()
		client.LastActive = time.Now()
		clientsLock.Unlock()

		// Two kinds of inbound frames arrive here and are handled differently:
		//   1. A reply carrying an "id" we are waiting on -> resolve that one
		//      pending command (unicast to its buffered channel).
		//   2. An unsolicited "type" event (handshake, window focus, feedback
		//      push) -> update shared state and/or persist feedback.
		if idVal, ok := msg["id"]; ok {
			var id int64
			switch v := idVal.(type) {
			case float64:
				id = int64(v)
			case int64:
				id = v
			}
			if id > 0 {
				pendingReqLock.Lock()
				req, exists := pendingRequests[id]
				if exists {
					delete(pendingRequests, id)
				}
				pendingReqLock.Unlock()
				if exists {
					req.Resolve <- msg
				}
			}
		}

		// Handle extension events and feedback messages
		if t, ok := msg["type"].(string); ok {
			switch t {
			case "DEVTOOLS_PROTOCOL_EVENT", "DEVTOOLS_PROTOCOL_CLOSED":
				msg["instanceId"] = clientID
				devtoolsHost.Event(msg)
			case "HANDSHAKE":
				if details, ok := msg["details"].(map[string]interface{}); ok {
					clientsLock.Lock()
					client.Details = details
					clientsLock.Unlock()
				}
			case "WINDOW_FOCUS":
				clientsLock.Lock()
				activeClientID = clientID
				if tabTitle, ok := msg["activeTabTitle"].(string); ok {
					if client.Details == nil {
						client.Details = make(map[string]interface{})
					}
					client.Details["activeTabTitle"] = tabTitle
				}
				clientsLock.Unlock()
			case "FEEDBACK_PUSH_AGENT", "FEEDBACK_SUBMISSION", "FEEDBACK_SAVE":
				if payload, ok := msg["payload"].(map[string]interface{}); ok {
					saved, saveErr := feedback.SaveFeedbackSession(payload)
					if saveErr != nil {
						log.Printf("[BridgeServer] Failed to save feedback session: %v", saveErr)
					}
					if idVal, hasID := msg["id"]; hasID {
						result := map[string]interface{}{"success": true, "sessionId": saved["sessionId"]}
						if saveErr != nil {
							result = map[string]interface{}{"success": false, "error": saveErr.Error()}
						}
						client.WriteMu.Lock()
						if err := client.WS.WriteJSON(map[string]interface{}{
							"id":     idVal,
							"result": result,
						}); err != nil {
							log.Printf("[BridgeServer] Failed to write feedback response to client %s: %v", clientID, err)
						}
						client.WriteMu.Unlock()
					}
				}
			}
		}
	}
}

// describeClientConnection builds the public instance descriptor using handshake details.
// Callers must hold at least a read lock on clientsLock.
func describeClientConnection(c *ClientConnection, activeID string) map[string]interface{} {
	browserName := "Chromium"
	osName := runtime.GOOS
	tabTitle := ""
	if c.Details != nil {
		if v, ok := c.Details["browser"].(string); ok && v != "" {
			browserName = v
		}
		if v, ok := c.Details["os"].(string); ok && v != "" {
			osName = v
		}
		if v, ok := c.Details["activeTabTitle"].(string); ok {
			tabTitle = v
		}
	}
	entry := map[string]interface{}{
		"instanceId":  c.ID,
		"browser":     browserName,
		"os":          osName,
		"isActive":    c.ID == activeID,
		"connectedAt": c.ConnectedAt.UnixMilli(),
		"lastActive":  c.LastActive.UnixMilli(),
	}
	if tabTitle != "" {
		entry["activeTabTitle"] = tabTitle
	}
	for _, key := range []string{"extensionId", "extensionVersion", "bridgePort", "capabilities"} {
		if value, ok := c.Details[key]; ok && value != nil {
			entry[key] = value
		}
	}
	return entry
}
