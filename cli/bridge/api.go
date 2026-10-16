// bridge_api.go implements the HTTP-facing surface of the bridge: the generic
// JSON-RPC handler on /api, the feedback REST endpoints, a tolerant numeric
// coercion helper and the forwarder used to reach an already-running master
// bridge.

package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ducconit/agent-pilot-extension/cli/config"
	"github.com/ducconit/agent-pilot-extension/cli/feedback"
	"github.com/ducconit/agent-pilot-extension/cli/version"
)

var forwardHTTPClient = &http.Client{}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if status != http.StatusOK {
		w.WriteHeader(status)
	}
	_ = json.NewEncoder(w).Encode(payload)
}

// prepareEndpoint validates Origin, applies optional CORS headers, and handles
// preflight OPTIONS requests. Returns false when the caller should return early.
func prepareEndpoint(w http.ResponseWriter, r *http.Request, allowMethods string, setCORS bool, forbiddenMsg string) bool {
	origin := r.Header.Get("Origin")
	if !IsOriginAllowed(origin) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": forbiddenMsg})
		return false
	}

	if setCORS {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", allowMethods)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Agent-Pilot-Key")
	}
	w.Header().Set("Content-Type", "application/json")

	if setCORS && r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return false
	}
	return true
}

func requirePostMethod(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST method required"})
		return false
	}
	return true
}

func decodeJSONRequest(w http.ResponseWriter, r *http.Request, maxBytes int64) (map[string]interface{}, bool) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBytes))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Failed to read request body"})
		return nil, false
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return nil, false
	}
	return payload, true
}

// decodeOptionalJSONBody parses a JSON object when the request body is non-empty,
// returning (nil, true) on an empty body and writing HTTP 400 on read/parse errors.
func decodeOptionalJSONBody(w http.ResponseWriter, r *http.Request, maxBytes int64) (map[string]interface{}, bool) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBytes))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Failed to read request body"})
		return nil, false
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return nil, true
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return nil, false
	}
	return payload, true
}

// extendWriteDeadline lifts the server's 30s WriteTimeout when a command or
// long-poll legitimately needs longer (e.g. batch.run or feedback.wait).
func extendWriteDeadline(w http.ResponseWriter, duration time.Duration) {
	if duration+5*time.Second > config.HTTPWriteTimeout {
		rc := http.NewResponseController(w)
		_ = rc.SetWriteDeadline(time.Now().Add(duration + 5*time.Second))
	}
}

func handleHTTPAPI(w http.ResponseWriter, r *http.Request) {
	if !prepareEndpoint(w, r, "POST", false, "Forbidden: Cross-origin request rejected") {
		return
	}
	if !requirePostMethod(w, r) {
		return
	}

	req, ok := decodeJSONRequest(w, r, config.MaxAPIBodyBytes)
	if !ok {
		return
	}

	method, _ := req["method"].(string)
	method = strings.TrimSpace(method)
	if method == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"error":   "Missing or empty 'method' field in request payload",
		})
		return
	}

	params, _ := req["params"].(map[string]interface{})
	if params == nil {
		params = make(map[string]interface{})
	}

	timeoutMs := DeriveCommandTimeout(method, params, config.DefaultCommandTimeoutMs)
	extendWriteDeadline(w, time.Duration(timeoutMs)*time.Millisecond)

	// Feedback & local bridge methods
	switch method {
	case "feedback.save", "feedback.push":
		res, err := feedback.SaveFeedbackSession(params)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "result": res})
		return

	case "feedback.pending":
		limit := config.DefaultFeedbackListLimit
		if l, ok := getIntOrFloat(params, "limit"); ok && l > 0 {
			limit = l
		}
		sid, _ := params["sessionId"].(string)
		clear, _ := params["clear"].(bool)
		res, _ := feedback.GetPendingFeedback(limit, sid, clear)
		writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "result": res})
		return

	case "feedback.wait":
		timeout := config.DefaultFeedbackTimeoutSec
		if t, ok := getIntOrFloat(params, "timeout"); ok && t > 0 {
			timeout = t
		}
		res := feedback.WaitForFeedbackWithContext(r.Context(), timeout, params["tabId"])
		writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "result": res})
		return

	case "config.getSecretFilter":
		res, err := SendCommandToExtension("config.getSecretFilter", params, config.ConfigRPCCommandTimeoutMs)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
				"success": false,
				"error":   err.Error(),
				"result":  map[string]interface{}{"enabled": atomic.LoadInt32(&secretFilterOn) == 1},
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "result": res})
		return

	case "config.setSecretFilter":
		if enabled, ok := params["enabled"].(bool); ok {
			if enabled {
				atomic.StoreInt32(&secretFilterOn, 1)
			} else {
				atomic.StoreInt32(&secretFilterOn, 0)
			}
		}
		res, err := SendCommandToExtension("config.setSecretFilter", params, config.ConfigRPCCommandTimeoutMs)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
				"success": false,
				"error":   err.Error(),
				"result":  map[string]interface{}{"enabled": atomic.LoadInt32(&secretFilterOn) == 1},
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "result": res})
		return

	case "ping":
		writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "result": map[string]interface{}{"pong": true, "version": version.Raw()}})
		return

	case "instances.list":
		writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "result": listConnectedClients()})
		return

	case "instances.select":
		targetID, _ := params["instanceId"].(string)
		clientsLock.Lock()
		_, found := clients[targetID]
		if found {
			activeClientID = targetID
		}
		activeID := activeClientID
		clientsLock.Unlock()
		if !found && targetID != "" {
			writeJSON(w, http.StatusOK, map[string]interface{}{"success": false, "error": "Instance not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "activeInstanceId": activeID})
		return
	}

	// Dispatch to extension
	res, err := SendCommandToExtension(method, params, 0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "result": res})
}

func handleFeedbackSaveEndpoint(w http.ResponseWriter, r *http.Request) {
	if !prepareEndpoint(w, r, "POST, OPTIONS", true, "Forbidden origin") {
		return
	}
	if !requirePostMethod(w, r) {
		return
	}

	// Feedback saves may carry inline base64 screenshots, hence the larger cap.
	p, ok := decodeJSONRequest(w, r, config.MaxFeedbackBodyBytes)
	if !ok {
		return
	}

	res, err := feedback.SaveFeedbackSession(p)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "result": res})
}

func handleFeedbackPendingEndpoint(w http.ResponseWriter, r *http.Request) {
	if !prepareEndpoint(w, r, "GET, POST, OPTIONS", true, "Forbidden origin") {
		return
	}

	q := r.URL.Query()
	sessionId := q.Get("sessionId")
	limit := config.DefaultFeedbackListLimit
	if lStr := q.Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
			limit = l
		}
	}
	// State-changing "clear" is only honored from a POST body to avoid
	// cross-origin GET requests (e.g. <img src>) wiping the feedback inbox.
	clear := false

	if r.Method == http.MethodPost {
		p, ok := decodeOptionalJSONBody(w, r, config.MaxAPIBodyBytes)
		if !ok {
			return
		}
		if p != nil {
			if sid, ok := p["sessionId"].(string); ok && sid != "" {
				sessionId = sid
			}
			if l, ok := getIntOrFloat(p, "limit"); ok && l > 0 {
				limit = l
			}
			if c, ok := p["clear"].(bool); ok {
				clear = c
			}
		}
	}

	res, err := feedback.GetPendingFeedback(limit, sessionId, clear)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func handleFeedbackWaitEndpoint(w http.ResponseWriter, r *http.Request) {
	if !prepareEndpoint(w, r, "POST, OPTIONS", true, "Forbidden origin") {
		return
	}
	if !requirePostMethod(w, r) {
		return
	}

	timeout := config.DefaultFeedbackTimeoutSec
	var tabID interface{}

	p, ok := decodeOptionalJSONBody(w, r, config.MaxAPIBodyBytes)
	if !ok {
		return
	}
	if p != nil {
		if t, ok := getIntOrFloat(p, "timeout"); ok && t > 0 {
			timeout = t
		}
		tabID = p["tabId"]
	}

	extendWriteDeadline(w, time.Duration(timeout)*time.Second)
	res := feedback.WaitForFeedbackWithContext(r.Context(), timeout, tabID)
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "result": res})
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
		port = config.DefaultBridgePort()
	}
	url := fmt.Sprintf("http://%s:%d/api", config.DefaultHost, port)
	payload := map[string]interface{}{
		"method": method,
		"params": params,
	}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	timeoutDuration := time.Duration(DeriveCommandTimeout(method, params, config.ForwardCommandTimeoutMs)) * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), timeoutDuration)
	defer cancel()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(jsonBytes))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	if key := config.BridgeAPIKey(); key != "" {
		request.Header.Set(config.APIKeyHeader, key)
	}
	resp, err := forwardHTTPClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("failed to contact Agent Pilot Bridge at %s: %w", url, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, config.MaxForwardBody))
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
