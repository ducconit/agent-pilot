package bridge

import (
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
