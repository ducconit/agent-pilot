package bridge

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthReportsActiveBridgePort(t *testing.T) {
	original := ActiveBridgePort()
	defer setActiveBridgePort(original)

	// /health must report the port the server actually bound, not a compiled-in guess
	setActiveBridgePort(12345)
	rec := httptest.NewRecorder()
	handleHealth(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid /health response: %v", err)
	}
	if got, ok := payload["port"].(float64); !ok || int(got) != 12345 {
		t.Fatalf("expected /health to report the bound port 12345, got %#v", payload["port"])
	}
}

func TestHandleHTTPAPIAcceptsActionAndPayloadAliases(t *testing.T) {
	body := bytes.NewBufferString(`{"action":"ping","payload":{}}`)
	req := httptest.NewRequest(http.MethodPost, "/api", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleHTTPAPI(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 for action alias, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON response: %v", err)
	}
	if ok, _ := resp["success"].(bool); !ok {
		t.Fatalf("expected success=true, got %#v", resp)
	}
}
