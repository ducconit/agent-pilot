package bridge

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ducconit/agent-pilot/cli/internal/feedback"
	"github.com/gorilla/websocket"
)

func startTestBridgeWS(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/", handleWebSocket)
	srv := httptest.NewServer(mux)
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	t.Cleanup(func() {
		clientsLock.Lock()
		for id, c := range clients {
			_ = c.WS.Close()
			delete(clients, id)
		}
		activeClientID = ""
		clientsLock.Unlock()
		srv.Close()
	})
	return srv, wsURL
}

func waitForClientCount(t *testing.T, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		clientsLock.RLock()
		count := len(clients)
		clientsLock.RUnlock()
		if count >= want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d bridge clients", want)
}

func dialFakeExtension(t *testing.T, wsURL string, responder func(method string, id interface{}) (map[string]interface{}, bool)) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial bridge WS: %v", err)
	}
	_ = conn.WriteJSON(map[string]interface{}{
		"type": "HANDSHAKE",
		"details": map[string]interface{}{
			"browser": "Google Chrome",
			"os":      "darwin",
		},
	})
	go func() {
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var msg map[string]interface{}
			if json.Unmarshal(raw, &msg) != nil {
				continue
			}
			method, _ := msg["method"].(string)
			result, ok := responder(method, msg["id"])
			if !ok {
				continue
			}
			_ = conn.WriteJSON(map[string]interface{}{"id": msg["id"], "result": result})
		}
	}()
	return conn
}

func TestBridgeCommandRoundTripAndTimeout(t *testing.T) {
	_, wsURL := startTestBridgeWS(t)

	conn := dialFakeExtension(t, wsURL, func(method string, id interface{}) (map[string]interface{}, bool) {
		if method != "ping" {
			return nil, false
		}
		return map[string]interface{}{"pong": true}, true
	})
	defer conn.Close()
	waitForClientCount(t, 1)

	res, err := SendCommandToExtension("ping", map[string]interface{}{}, 2000)
	if err != nil {
		t.Fatalf("ping round trip failed: %v", err)
	}
	resMap, _ := res.(map[string]interface{})
	if resMap == nil || resMap["pong"] != true {
		t.Fatalf("unexpected ping result: %#v", res)
	}

	start := time.Now()
	_, err = SendCommandToExtension("missing.method", map[string]interface{}{}, 250)
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("expected timeout error, got: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("timeout path took too long: %v", elapsed)
	}
}

func TestBridgeConcurrentConnectDisconnectAndSelect(t *testing.T) {
	_, wsURL := startTestBridgeWS(t)

	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
			if err != nil {
				return
			}
			_ = conn.WriteJSON(map[string]interface{}{
				"type":    "HANDSHAKE",
				"details": map[string]interface{}{"browser": "Chromium", "os": "linux"},
			})
			time.Sleep(120 * time.Millisecond)
			_ = conn.Close()
		}()
	}
	waitForClientCount(t, 1)

	// Exercise instances.list / instances.select concurrently with connect/disconnect churn
	for i := 0; i < 12; i++ {
		listReq := httptest.NewRequest(http.MethodPost, "/api", strings.NewReader(`{"method":"instances.list","params":{}}`))
		listRec := httptest.NewRecorder()
		handleHTTPAPI(listRec, listReq)

		selectReq := httptest.NewRequest(http.MethodPost, "/api", strings.NewReader(`{"method":"instances.select","params":{"instanceId":"nope"}}`))
		selectRec := httptest.NewRecorder()
		handleHTTPAPI(selectRec, selectReq)
		time.Sleep(10 * time.Millisecond)
	}
	wg.Wait()
}

func TestInstancesListUsesHandshakeDetails(t *testing.T) {
	_, wsURL := startTestBridgeWS(t)
	conn := dialFakeExtension(t, wsURL, func(string, interface{}) (map[string]interface{}, bool) { return nil, false })
	defer conn.Close()
	waitForClientCount(t, 1)

	var first map[string]interface{}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		req := httptest.NewRequest(http.MethodPost, "/api", strings.NewReader(`{"method":"instances.list","params":{}}`))
		rec := httptest.NewRecorder()
		handleHTTPAPI(rec, req)

		var payload struct {
			Success bool                     `json:"success"`
			Result  []map[string]interface{} `json:"result"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("invalid instances.list response: %v", err)
		}
		if payload.Success && len(payload.Result) > 0 {
			first = payload.Result[0]
			// The HANDSHAKE message is processed asynchronously after connect
			if first["browser"] == "Google Chrome" && first["os"] == "darwin" {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
	}

	if first == nil {
		t.Fatalf("expected at least one instance in instances.list")
	}
	if first["browser"] != "Google Chrome" || first["os"] != "darwin" {
		t.Fatalf("expected handshake details to surface, got: %#v", first)
	}
}

func TestFeedbackPendingGetClearIsIgnored(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "ap_test_csrf_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)
	_ = os.Setenv("AGENT_PILOT_HOME", tempDir)
	defer os.Unsetenv("AGENT_PILOT_HOME")

	payload := map[string]interface{}{
		"timestamp": "1789234567891",
		"url":       "http://localhost/csrf",
		"title":     "CSRF",
		"items":     []interface{}{},
	}
	saveRes, err := feedback.SaveFeedbackSession(payload)
	if err != nil {
		t.Fatalf("feedback.SaveFeedbackSession failed: %v", err)
	}
	sessionID, _ := saveRes["sessionId"].(string)
	sessionDir := filepath.Join(feedback.GetFeedbackStorageDir(), sessionID)

	// GET with clear=true must NOT archive/remove the session
	getReq := httptest.NewRequest(http.MethodGet, "/api/feedback/pending?clear=true", nil)
	getRec := httptest.NewRecorder()
	handleFeedbackPendingEndpoint(getRec, getReq)
	if _, statErr := os.Stat(sessionDir); statErr != nil {
		t.Fatalf("GET clear=true must not remove the session dir, stat err: %v", statErr)
	}

	// POST with clear=true (explicit body) still archives it
	postReq := httptest.NewRequest(http.MethodPost, "/api/feedback/pending", strings.NewReader(`{"clear":true,"sessionId":"`+sessionID+`"}`))
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	handleFeedbackPendingEndpoint(postRec, postReq)
	if postRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from POST pending, got %d: %s", postRec.Code, postRec.Body.String())
	}
	if _, statErr := os.Stat(sessionDir); !os.IsNotExist(statErr) {
		t.Fatalf("POST clear=true should archive the session dir (stat err: %v)", statErr)
	}
}
