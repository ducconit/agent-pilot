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

	"github.com/ducconit/agent-pilot-extension/cli/feedback"
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

func TestBridgeExplicitUnknownInstanceFailsClosed(t *testing.T) {
	_, wsURL := startTestBridgeWS(t)
	called := make(chan struct{}, 1)
	conn := dialFakeExtension(t, wsURL, func(method string, id interface{}) (map[string]interface{}, bool) {
		called <- struct{}{}
		return map[string]interface{}{"unexpected": true}, true
	})
	defer conn.Close()
	waitForClientCount(t, 1)

	_, err := SendCommandToExtension("should.not.route", map[string]interface{}{
		"instanceId": "browser-does-not-exist",
	}, 250)
	if err == nil || !strings.Contains(err.Error(), "no Chrome Extension connected") {
		t.Fatalf("expected explicit unknown instance to fail closed, got: %v", err)
	}
	select {
	case <-called:
		t.Fatal("command was routed to the active client after an explicit instance miss")
	default:
	}
}

func TestBridgeCommandFailsFastOnClientDisconnect(t *testing.T) {
	_, wsURL := startTestBridgeWS(t)

	var conn *websocket.Conn
	conn = dialFakeExtension(t, wsURL, func(method string, id interface{}) (map[string]interface{}, bool) {
		if method == "disconnect.now" {
			go func() {
				time.Sleep(30 * time.Millisecond)
				_ = conn.Close()
			}()
		}
		return nil, false
	})
	defer conn.Close()
	waitForClientCount(t, 1)

	start := time.Now()
	_, err := SendCommandToExtension("disconnect.now", map[string]interface{}{}, 10000)
	elapsed := time.Since(start)
	if err == nil || !strings.Contains(err.Error(), "closed while command was in flight") {
		t.Fatalf("expected fail-fast disconnect error, got: %v", err)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("expected immediate fail-fast (<2s) on disconnect, took %v", elapsed)
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

func TestHTTPAPIRejectsEmptyMethodAndMalformedFeedbackJSON(t *testing.T) {
	emptyMethodReq := httptest.NewRequest(http.MethodPost, "/api", strings.NewReader(`{"method":"  ","params":{}}`))
	emptyMethodRec := httptest.NewRecorder()
	handleHTTPAPI(emptyMethodRec, emptyMethodReq)
	if emptyMethodRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for empty method, got %d: %s", emptyMethodRec.Code, emptyMethodRec.Body.String())
	}

	badPendingReq := httptest.NewRequest(http.MethodPost, "/api/feedback/pending", strings.NewReader(`{"clear":true`))
	badPendingRec := httptest.NewRecorder()
	handleFeedbackPendingEndpoint(badPendingRec, badPendingReq)
	if badPendingRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for malformed JSON in /api/feedback/pending, got %d", badPendingRec.Code)
	}

	badWaitReq := httptest.NewRequest(http.MethodPost, "/api/feedback/wait", strings.NewReader(`{"timeout":10`))
	badWaitRec := httptest.NewRecorder()
	handleFeedbackWaitEndpoint(badWaitRec, badWaitReq)
	if badWaitRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for malformed JSON in /api/feedback/wait, got %d", badWaitRec.Code)
	}
}

func TestDeriveCommandTimeout_PerformanceAndExplicitTimeoutMs(t *testing.T) {
	for _, method := range []string{"performance.metrics", "memory.heapSnapshot", "page.screenshot"} {
		if got := DeriveCommandTimeout(method, nil, 15000); got != 30000 {
			t.Fatalf("DeriveCommandTimeout(%q, nil, 15000) = %d, want 30000", method, got)
		}
	}

	if got := DeriveCommandTimeout("performance.metrics", map[string]interface{}{"timeoutMs": 45000}, 15000); got != 50000 {
		t.Fatalf("DeriveCommandTimeout(performance.metrics, timeoutMs=45000) = %d, want 50000", got)
	}

	if got := DeriveCommandTimeout("page.evaluate", map[string]interface{}{"timeoutMs": 40000}, 15000); got != 45000 {
		t.Fatalf("DeriveCommandTimeout(page.evaluate, timeoutMs=40000) = %d, want 45000", got)
	}
}
