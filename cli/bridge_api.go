// bridge_api.go implements the HTTP-facing surface of the bridge: the generic
// JSON-RPC handler on /api, the feedback REST endpoints, a tolerant numeric
// coercion helper and the forwarder used to reach an already-running master
// bridge.

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

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

	body, err := io.ReadAll(io.LimitReader(r.Body, maxAPIBodyBytes))
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
		limit := defaultFeedbackListLimit
		if l, ok := params["limit"].(float64); ok {
			limit = int(l)
		}
		sid, _ := params["sessionId"].(string)
		clear, _ := params["clear"].(bool)
		res, _ := GetPendingFeedback(limit, sid, clear)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": res})
		return

	case "feedback.wait":
		timeout := defaultFeedbackTimeoutSec
		if t, ok := params["timeout"].(float64); ok {
			timeout = int(t)
		}
		res := WaitForFeedbackWithContext(r.Context(), timeout, params["tabId"])
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "result": res})
		return

	case "config.getSecretFilter":
		res, err := SendCommandToExtension("config.getSecretFilter", params, configRPCCommandTimeoutMs)
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   err.Error(),
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
		res, err := SendCommandToExtension("config.setSecretFilter", params, configRPCCommandTimeoutMs)
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   err.Error(),
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
			clientList = append(clientList, describeClientConnection(c, activeClientID))
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
		clientsLock.RLock()
		activeID := activeClientID
		clientsLock.RUnlock()
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "activeInstanceId": activeID})
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

	// Feedback saves may carry inline base64 screenshots, hence the larger cap.
	body, err := io.ReadAll(io.LimitReader(r.Body, maxFeedbackBodyBytes))
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
	limit := defaultFeedbackListLimit
	if lStr := q.Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
			limit = l
		}
	}
	// State-changing "clear" is only honored from a POST body to avoid
	// cross-origin GET requests (e.g. <img src>) wiping the feedback inbox.
	clear := false

	if r.Method == "POST" {
		body, err := io.ReadAll(io.LimitReader(r.Body, maxAPIBodyBytes))
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

	timeout := defaultFeedbackTimeoutSec
	var tabID interface{}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxAPIBodyBytes))
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

// getIntOrFloat reads a numeric value from a loosely-typed JSON map, accepting
// either a real number or a numeric string. It reports whether a value was found.
func getIntOrFloat(m map[string]interface{}, key string) (int, bool) {
	if m == nil {
		return 0, false
	}
	if v, ok := m[key]; ok && v != nil {
		switch n := v.(type) {
		case int:
			return n, true
		case int64:
			return int(n), true
		case float64:
			return int(n), true
		case float32:
			return int(n), true
		case string:
			if parsed, err := strconv.Atoi(strings.TrimSpace(n)); err == nil {
				return parsed, true
			}
		}
	}
	return 0, false
}

// ForwardCommandToActiveServer relays the command as HTTP POST /api to the
// already-running master bridge and unwraps its {success, result} envelope.
func ForwardCommandToActiveServer(method string, params map[string]interface{}, port int) (interface{}, error) {
	if port <= 0 {
		port = DefaultPort
	}
	url := fmt.Sprintf("http://%s:%d/api", DefaultHost, port)
	payload := map[string]interface{}{
		"method": method,
		"params": params,
	}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	timeoutDuration := time.Duration(DeriveCommandTimeout(method, params, forwardCommandTimeoutMs)) * time.Millisecond
	client := &http.Client{
		Timeout: timeoutDuration,
	}
	resp, err := client.Post(url, "application/json", bytes.NewReader(jsonBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to contact Agent Pilot Bridge at %s: %w", url, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxForwardBody))
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
