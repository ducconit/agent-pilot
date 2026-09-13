package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

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
	Resolve chan map[string]interface{}
}

var (
	DefaultPort     = 58765
	DefaultHost     = "127.0.0.1"
	ServerVersion   = "1.0.3-beta"
	clientsLock     sync.RWMutex
	clients         = make(map[string]*ClientConnection)
	activeClientID  string
	pendingReqLock  sync.Mutex
	pendingRequests = make(map[int64]*PendingRequest)
	requestCounter  int64
	secretFilterOn  int32 = 1 // default true
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

func SendCommandToExtension(method string, params map[string]interface{}, timeoutMs int) (interface{}, error) {
	instanceID, _ := params["instanceId"].(string)
	client := getClientByID(instanceID)
	if client == nil {
		return nil, fmt.Errorf("no Chrome Extension connected to Agent Pilot bridge on port %d", DefaultPort)
	}

	reqID := atomic.AddInt64(&requestCounter, 1)
	msg := map[string]interface{}{
		"id":     reqID,
		"method": method,
		"params": params,
	}

	resChan := make(chan map[string]interface{}, 1)
	pendingReqLock.Lock()
	pendingRequests[reqID] = &PendingRequest{Resolve: resChan}
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

	if timeoutMs <= 0 {
		timeoutMs = 15000
		if method == "batch.run" {
			timeoutMs = 45000
		}
	}

	select {
	case res := <-resChan:
		filterEnabled := atomic.LoadInt32(&secretFilterOn) == 1
		if errMsg, ok := res["error"].(string); ok && errMsg != "" {
			return nil, fmt.Errorf("%s", errMsg)
		}
		resultData := res["result"]
		sanitized := SanitizeData(resultData, filterEnabled)
		return sanitized, nil

	case <-time.After(time.Duration(timeoutMs) * time.Millisecond):
		pendingReqLock.Lock()
		delete(pendingRequests, reqID)
		pendingReqLock.Unlock()
		return nil, fmt.Errorf("command '%s' timed out after %dms", method, timeoutMs)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[BridgeServer] Upgrade error: %v", err)
		return
	}
	conn.SetReadLimit(50 * 1024 * 1024)

	clientID := fmt.Sprintf("browser_%d", time.Now().UnixNano()%1000000)
	client := &ClientConnection{
		ID:          clientID,
		WS:          conn,
		RemoteAddr:  r.RemoteAddr,
		ConnectedAt: time.Now(),
		LastActive:  time.Now(),
		Details: map[string]interface{}{
			"browser": "Chromium",
			"os":      "linux",
		},
	}

	clientsLock.Lock()
	clients[clientID] = client
	if activeClientID == "" {
		activeClientID = clientID
	}
	clientsLock.Unlock()

	log.Printf("[BridgeServer] 🔌 Extension connected [%s] from %s. Active clients: %d", clientID, r.RemoteAddr, len(clients))

	defer func() {
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
		_ = conn.Close()
		log.Printf("[BridgeServer] 🔌 Extension disconnected [%s]", clientID)
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg map[string]interface{}
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		client.LastActive = time.Now()

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
			case "HANDSHAKE":
				if details, ok := msg["details"].(map[string]interface{}); ok {
					client.Details = details
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
					saved, _ := SaveFeedbackSession(payload)
					if idVal, hasID := msg["id"]; hasID {
						client.WriteMu.Lock()
						_ = client.WS.WriteJSON(map[string]interface{}{
							"id": idVal,
							"result": map[string]interface{}{
								"success":   true,
								"sessionId": saved["sessionId"],
							},
						})
						client.WriteMu.Unlock()
					}
				}
			}
		}
	}
}

func handleHTTPAPI(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if !IsOriginAllowed(origin) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Forbidden: Cross-origin request rejected"})
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "POST method required"})
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 50*1024*1024))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read request body"})
		return
	}

	var req map[string]interface{}
	if err := json.Unmarshal(body, &req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Invalid JSON"})
		return
	}

	method, _ := req["method"].(string)
	params, _ := req["params"].(map[string]interface{})
	if params == nil {
		params = make(map[string]interface{})
	}

	// Feedback methods
	switch method {
	case "feedback.save", "feedback.push":
		res, err := SaveFeedbackSession(params)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": res})
		return

	case "feedback.pending":
		limit := 10
		if l, ok := params["limit"].(float64); ok {
			limit = int(l)
		}
		sid, _ := params["sessionId"].(string)
		clear, _ := params["clear"].(bool)
		res, _ := GetPendingFeedback(limit, sid, clear)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": res})
		return

	case "feedback.wait":
		timeout := 120
		if t, ok := params["timeout"].(float64); ok {
			timeout = int(t)
		}
		res := WaitForFeedbackWithContext(r.Context(), timeout, params["tabId"])
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": res})
		return

	case "config.getSecretFilter":
		res, err := SendCommandToExtension("config.getSecretFilter", params, 2000)
		if err != nil {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"success": true,
				"result":  map[string]interface{}{"enabled": atomic.LoadInt32(&secretFilterOn) == 1},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": res})
		return

	case "config.setSecretFilter":
		if enabled, ok := params["enabled"].(bool); ok {
			if enabled {
				atomic.StoreInt32(&secretFilterOn, 1)
			} else {
				atomic.StoreInt32(&secretFilterOn, 0)
			}
		}
		res, err := SendCommandToExtension("config.setSecretFilter", params, 2000)
		if err != nil {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"success": true,
				"result":  map[string]interface{}{"enabled": atomic.LoadInt32(&secretFilterOn) == 1},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": res})
		return

	case "ping":
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": map[string]interface{}{"pong": true, "version": ServerVersion}})
		return

	case "instances.list":
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
			clientList = append(clientList, map[string]interface{}{
				"instanceId":  c.ID,
				"browser":     "Chromium",
				"os":          "linux",
				"isActive":    c.ID == activeClientID,
				"connectedAt": c.ConnectedAt.UnixMilli(),
			})
		}
		clientsLock.RUnlock()
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": clientList})
		return

	case "instances.select":
		targetID, _ := params["instanceId"].(string)
		clientsLock.Lock()
		found := false
		for _, c := range clients {
			if c.ID == targetID {
				activeClientID = targetID
				found = true
				break
			}
		}
		clientsLock.Unlock()
		if !found && targetID != "" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Instance not found"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "activeInstanceId": activeClientID})
		return
	}

	// Dispatch to extension
	res, err := SendCommandToExtension(method, params, 0)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": res})
}

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
		clientList = append(clientList, map[string]interface{}{
			"instanceId":  c.ID,
			"browser":     "Chromium",
			"os":          "linux",
			"isActive":    c.ID == activeClientID,
			"connectedAt": c.ConnectedAt.UnixMilli(),
		})
	}
	extConnected := len(clientList) > 0
	clientsLock.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":             "ok",
		"name":               "Agent Pilot Go Bridge Server",
		"port":               DefaultPort,
		"extensionConnected": extConnected,
		"clientCount":        len(clientList),
		"version":            ServerVersion,
		"clients":            clientList,
	})
}

// StartBridgeServer runs the dual-mode WebSocket/HTTP server
func StartBridgeServer(port int) error {
	addr := fmt.Sprintf("%s:%d", DefaultHost, port)

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
			handleHealth(w, r)
			return
		}
		http.NotFound(w, r)
	})

	mux.HandleFunc("/api", handleHTTPAPI)
	mux.HandleFunc("/api/feedback/save", handleFeedbackSaveEndpoint)
	mux.HandleFunc("/api/feedback/push", handleFeedbackSaveEndpoint)
	mux.HandleFunc("/api/feedback/pending", handleFeedbackPendingEndpoint)
	mux.HandleFunc("/api/feedback/wait", handleFeedbackWaitEndpoint)

	log.Printf("[AgentPilot Go] 🚀 Bridge Server listening on http://%s (WebSocket: ws://%s)", addr, addr)
	return http.Serve(listener, mux)
}

func handleFeedbackSaveEndpoint(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if !IsOriginAllowed(origin) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Forbidden origin"})
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "POST method required"})
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 50*1024*1024))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Failed to read request body"})
		return
	}

	var p map[string]interface{}
	if err := json.Unmarshal(body, &p); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Invalid JSON"})
		return
	}

	res, err := SaveFeedbackSession(p)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": res})
}

func handleFeedbackPendingEndpoint(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if !IsOriginAllowed(origin) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Forbidden origin"})
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	q := r.URL.Query()
	sessionId := q.Get("sessionId")
	limit := 10
	if lStr := q.Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
			limit = l
		}
	}
	clear := q.Get("clear") == "true"

	if r.Method == "POST" {
		body, err := io.ReadAll(io.LimitReader(r.Body, 5*1024*1024))
		if err == nil && len(body) > 0 {
			var p map[string]interface{}
			if err := json.Unmarshal(body, &p); err == nil {
				if sid, ok := p["sessionId"].(string); ok && sid != "" {
					sessionId = sid
				}
				if l, ok := p["limit"].(float64); ok && l > 0 {
					limit = int(l)
				}
				if c, ok := p["clear"].(bool); ok {
					clear = c
				}
			}
		}
	}

	res, err := GetPendingFeedback(limit, sessionId, clear)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(res)
}

func handleFeedbackWaitEndpoint(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if !IsOriginAllowed(origin) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Forbidden origin"})
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "POST method required"})
		return
	}

	timeout := 120
	var tabID interface{}

	body, err := io.ReadAll(io.LimitReader(r.Body, 5*1024*1024))
	if err == nil && len(body) > 0 {
		var p map[string]interface{}
		if err := json.Unmarshal(body, &p); err == nil {
			if t, ok := p["timeout"].(float64); ok && t > 0 {
				timeout = int(t)
			}
			tabID = p["tabId"]
		}
	}

	res := WaitForFeedbackWithContext(r.Context(), timeout, tabID)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": res})
}

// ForwardCommandToActiveServer sends HTTP POST /api to the running master bridge
func ForwardCommandToActiveServer(method string, params map[string]interface{}, port int) (interface{}, error) {
	if port <= 0 {
		port = DefaultPort
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/api", port)
	payload := map[string]interface{}{
		"method": method,
		"params": params,
	}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	resp, err := http.Post(url, "application/json", bytes.NewReader(jsonBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to contact Agent Pilot Bridge at %s: %w", url, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var res map[string]interface{}
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("invalid response from bridge: %s", string(body))
	}

	if success, _ := res["success"].(bool); !success {
		errMsg, _ := res["error"].(string)
		if errMsg == "" {
			errMsg = "Bridge request failed"
		}
		return nil, fmt.Errorf("%s", errMsg)
	}

	return res["result"], nil
}
