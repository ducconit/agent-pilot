package bridge

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducconit/agent-pilot-extension/cli/config"
	"github.com/gorilla/websocket"
)

func TestOptionalAuthDisabledByDefault(t *testing.T) {
	t.Setenv(config.APIKeyEnvVar, "")

	if AuthEnabled() {
		t.Fatal("empty API key must keep auth disabled")
	}
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	if !AuthorizeHTTP(request) {
		t.Fatal("HTTP request should pass when auth is disabled")
	}
	if !AuthorizeWebSocketHandshake(map[string]interface{}{"type": "HANDSHAKE"}) {
		t.Fatal("WebSocket handshake should pass when auth is disabled")
	}
}

func TestHTTPAuthAcceptsConfiguredKeyAndBearer(t *testing.T) {
	t.Setenv(config.APIKeyEnvVar, "test-secret-key")

	tests := []struct {
		name   string
		header string
		value  string
		want   bool
	}{
		{name: "missing", want: false},
		{name: "wrong header", header: config.APIKeyHeader, value: "wrong", want: false},
		{name: "custom header", header: config.APIKeyHeader, value: "test-secret-key", want: true},
		{name: "bearer header", header: "Authorization", value: "Bearer test-secret-key", want: true},
		{name: "wrong bearer", header: "Authorization", value: "Bearer wrong", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/api", nil)
			if tt.header != "" {
				r.Header.Set(tt.header, tt.value)
			}
			if got := AuthorizeHTTP(r); got != tt.want {
				t.Fatalf("AuthorizeHTTP() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestWebSocketAuthHandshake(t *testing.T) {
	t.Setenv(config.APIKeyEnvVar, "test-secret-key")

	if AuthorizeWebSocketHandshake(map[string]interface{}{"type": "HANDSHAKE"}) {
		t.Fatal("missing handshake key must be rejected")
	}
	if AuthorizeWebSocketHandshake(map[string]interface{}{"type": "HANDSHAKE", "apiKey": "wrong"}) {
		t.Fatal("wrong handshake key must be rejected")
	}
	if !AuthorizeWebSocketHandshake(map[string]interface{}{"type": "HANDSHAKE", "apiKey": "test-secret-key"}) {
		t.Fatal("correct handshake key must be accepted")
	}
	if !AuthorizeWebSocketHandshake(map[string]interface{}{
		"type": "HANDSHAKE",
		"auth": map[string]interface{}{"apiKey": "test-secret-key"},
	}) {
		t.Fatal("nested handshake key must be accepted")
	}
}

func TestWebSocketAuthGate(t *testing.T) {
	t.Setenv(config.APIKeyEnvVar, "test-secret-key")
	_, wsURL := startTestBridgeWS(t)

	wrong, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("wrong-key socket upgrade failed unexpectedly: %v", err)
	}
	_ = wrong.WriteJSON(map[string]interface{}{"type": "HANDSHAKE", "apiKey": "wrong"})
	if _, _, readErr := wrong.ReadMessage(); readErr == nil {
		t.Fatal("wrong-key WebSocket should be closed by the bridge")
	}
	_ = wrong.Close()

	correct, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("correct-key socket upgrade failed: %v", err)
	}
	defer correct.Close()
	if err := correct.WriteJSON(map[string]interface{}{
		"type":    "HANDSHAKE",
		"apiKey":  "test-secret-key",
		"details": map[string]interface{}{"browser": "Chrome", "os": "linux"},
	}); err != nil {
		t.Fatalf("correct-key handshake write failed: %v", err)
	}
	waitForClientCount(t, 1)
}

func TestAuthErrorDoesNotEchoSecret(t *testing.T) {
	t.Setenv(config.APIKeyEnvVar, "super-secret-value")
	r := httptest.NewRequest(http.MethodGet, "/health", nil)
	r.Header.Set(config.APIKeyHeader, "wrong")
	rec := httptest.NewRecorder()
	writeAuthError(rec)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("writeAuthError status = %d, want 401", rec.Code)
	}
	if contains := rec.Body.String(); contains == "super-secret-value" || contains == "wrong" {
		t.Fatalf("auth response leaked a key: %s", contains)
	}
}
