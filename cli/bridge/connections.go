// bridge_client.go owns the extension-connection domain: per-socket
// ClientConnection state, the request/response correlation map used to route
// commands to the extension, the WebSocket upgrade handler, origin validation
// and the descriptor builder used when listing instances.

package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ducconit/agent-pilot/cli/config"
	"github.com/ducconit/agent-pilot/cli/feedback"
	"github.com/ducconit/agent-pilot/cli/version"
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

var provenanceKeys = [...]string{"extensionId", "extensionVersion", "extensionBuildId", "capabilities"}

const remoteMetadataCacheTTL = 500 * time.Millisecond

var remoteMetadataCache = struct {
	sync.Mutex
	entries map[string]metadataCacheEntry
}{entries: make(map[string]metadataCacheEntry)}

type metadataCacheEntry struct {
	fetchedAt time.Time
	metadata  map[string]interface{}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return IsWebSocketOriginAllowed(origin)
	},
}

func isValidExtensionOrigin(origin string) bool {
	if !strings.HasPrefix(origin, "chrome-extension://") {
		return false
	}
	rest := strings.TrimPrefix(origin, "chrome-extension://")
	extID := strings.TrimSuffix(rest, "/")
	if len(extID) < 8 || len(extID) > 64 {
		return false
	}
	for _, ch := range extID {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-') {
			return false
		}
	}
	if pinned := strings.TrimSpace(os.Getenv("AGENT_PILOT_EXTENSION_ID")); pinned != "" {
		return extID == pinned
	}
	return true
}

// IsWebSocketOriginAllowed restricts control WebSocket upgrades strictly to
// non-browser loopback dialers (empty Origin) or Chrome Extension origins,
// blocking Cross-Site WebSocket Hijacking (CSWSH) from web pages on localhost.
func IsWebSocketOriginAllowed(origin string) bool {
	if origin == "" {
		return true
	}
	return isValidExtensionOrigin(origin)
}

// IsOriginAllowed validates origin against extension and localhost
func IsOriginAllowed(origin string) bool {
	if origin == "" {
		return true
	}
	if strings.HasPrefix(origin, "chrome-extension://") {
		return isValidExtensionOrigin(origin)
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
	return selectClientLocked(instanceID)
}

func parseExtensionReply(method string, res map[string]interface{}) (interface{}, error) {
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
}

// SendCommandToExtension dispatches a command to a connected extension using context.Background().
func SendCommandToExtension(method string, params map[string]interface{}, timeoutMs int) (interface{}, error) {
	return SendCommandToExtensionWithContext(context.Background(), method, params, timeoutMs)
}

// SendCommandToExtensionWithContext dispatches a command to a connected extension and
// blocks until the matching reply arrives, ctx is canceled, or the (derived) timeout elapses.
//
// Correlation: a fresh id is allocated, a buffered channel is registered under
// that id, then the message is written. The reader goroutine (handleWebSocket)
// matches the reply id back to this channel, so concurrent callers never see
// each other's responses.
func SendCommandToExtensionWithContext(ctx context.Context, method string, params map[string]interface{}, timeoutMs int) (interface{}, error) {
	if ctx == nil {
		ctx = context.Background()
	}
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
	_ = client.WS.SetWriteDeadline(time.Now().Add(config.WSWriteControlTimeout))
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
		return parseExtensionReply(method, res)

	case <-ctx.Done():
		pendingReqLock.Lock()
		delete(pendingRequests, reqID)
		pendingReqLock.Unlock()
		return nil, fmt.Errorf("command '%s' canceled: %w", method, ctx.Err())

	case <-timer.C:
		// Remove the pending entry so a very late reply cannot leak a channel.
		pendingReqLock.Lock()
		delete(pendingRequests, reqID)
		pendingReqLock.Unlock()
		// Drain a reply delivered at the exact millisecond the timer fired.
		select {
		case res := <-resChan:
			return parseExtensionReply(method, res)
		default:
			return nil, fmt.Errorf("command '%s' timed out after %dms", method, timeoutMs)
		}
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
						_ = client.WS.SetWriteDeadline(time.Now().Add(config.WSWriteControlTimeout))
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
	for _, key := range []string{"extensionId", "extensionVersion", "extensionBuildId", "bridgePort", "capabilities"} {
		if value, ok := c.Details[key]; ok && value != nil {
			entry[key] = value
		}
	}
	return entry
}

// BridgeMetadata returns the compact provenance block attached to MCP tool
// responses. The build ID is intentionally separate from the version because
// unpacked extension reloads often keep the same manifest version.
func BridgeMetadata(instanceID string, requestedPort int) map[string]interface{} {
	if requestedPort <= 0 {
		requestedPort = ActiveBridgePort()
	}
	metadata := map[string]interface{}{
		"bridgePort":    requestedPort,
		"bridgeVersion": version.Raw(),
		"instanceId":    instanceID,
	}
	clientsLock.RLock()
	client := selectClientLocked(instanceID)
	if client != nil {
		metadata["instanceId"] = client.ID
		mergeProvenance(metadata, client.Details)
	}
	clientsLock.RUnlock()

	// MCP commonly runs as a separate process from the long-lived bridge. In
	// that forwarder arrangement this process has no local WebSocket client to
	// inspect, so use the selected bridge's health endpoint for provenance.
	if _, hasExtensionVersion := metadata["extensionVersion"]; !hasExtensionVersion {
		if healthMetadata := cachedRemoteBridgeMetadata(requestedPort, instanceID); healthMetadata != nil {
			for key, value := range healthMetadata {
				if _, exists := metadata[key]; !exists || metadata[key] == "" {
					metadata[key] = value
				}
			}
		}
	}
	return metadata
}

func selectClientLocked(instanceID string) *ClientConnection {
	if instanceID != "" {
		// An explicit instance selector is an affinity contract. Never fall
		// back to the active browser when it is stale or mistyped.
		return clients[instanceID]
	}
	if activeClientID != "" {
		if client := clients[activeClientID]; client != nil {
			return client
		}
	}
	for _, client := range clients {
		return client
	}
	return nil
}

func mergeProvenance(metadata map[string]interface{}, details map[string]interface{}) {
	for _, key := range provenanceKeys {
		if value, ok := details[key]; ok && value != nil {
			metadata[key] = value
		}
	}
	if extensionPort, ok := details["bridgePort"]; ok && extensionPort != nil {
		metadata["extensionBridgePort"] = extensionPort
	}
}

func cachedRemoteBridgeMetadata(port int, instanceID string) map[string]interface{} {
	cacheKey := fmt.Sprintf("%d:%s", port, instanceID)
	now := time.Now()
	remoteMetadataCache.Lock()
	if entry, ok := remoteMetadataCache.entries[cacheKey]; ok && now.Sub(entry.fetchedAt) < remoteMetadataCacheTTL {
		metadata := cloneMetadata(entry.metadata)
		remoteMetadataCache.Unlock()
		return metadata
	}
	remoteMetadataCache.Unlock()

	metadata := remoteBridgeMetadata(port, instanceID)
	if metadata == nil {
		return nil
	}
	remoteMetadataCache.Lock()
	remoteMetadataCache.entries[cacheKey] = metadataCacheEntry{
		fetchedAt: time.Now(),
		metadata:  cloneMetadata(metadata),
	}
	remoteMetadataCache.Unlock()
	return metadata
}

func cloneMetadata(metadata map[string]interface{}) map[string]interface{} {
	if metadata == nil {
		return nil
	}
	cloned := make(map[string]interface{}, len(metadata))
	for key, value := range metadata {
		cloned[key] = value
	}
	return cloned
}

var healthProbeHTTPClient = &http.Client{
	Timeout:   500 * time.Millisecond,
	Transport: defaultHTTPTransport,
}

func remoteBridgeMetadata(port int, instanceID string) map[string]interface{} {
	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/health", port), nil)
	if err != nil {
		return nil
	}
	if key := config.BridgeAPIKey(); key != "" {
		req.Header.Set(config.APIKeyHeader, key)
	}
	response, err := healthProbeHTTPClient.Do(req)
	if err != nil {
		return nil
	}
	defer func() {
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
	}()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil
	}

	var health struct {
		Version string                   `json:"version"`
		Port    int                      `json:"port"`
		Clients []map[string]interface{} `json:"clients"`
	}
	if err := json.NewDecoder(response.Body).Decode(&health); err != nil {
		return nil
	}
	metadata := map[string]interface{}{}
	if health.Port > 0 {
		metadata["bridgePort"] = health.Port
	}
	if health.Version != "" {
		metadata["bridgeVersion"] = health.Version
	}
	var selected map[string]interface{}
	for _, candidate := range health.Clients {
		if instanceID != "" {
			candidateID, _ := candidate["instanceId"].(string)
			if candidateID != instanceID {
				continue
			}
			selected = candidate
			break
		}
		if active, _ := candidate["isActive"].(bool); active {
			selected = candidate
			break
		}
		if selected == nil {
			selected = candidate
		}
	}
	if selected == nil {
		return metadata
	}
	if instance, ok := selected["instanceId"]; ok {
		metadata["instanceId"] = instance
	}
	mergeProvenance(metadata, selected)
	return metadata
}
