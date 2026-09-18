package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDefaultBridgePortEnvOverride(t *testing.T) {
	tests := []struct {
		name string
		env  string
		want int
	}{
		{"unset", "", DefaultPort},
		{"valid override", "60001", 60001},
		{"whitespace tolerated", "  60002  ", 60002},
		{"non-numeric ignored", "abc", DefaultPort},
		{"zero ignored", "0", DefaultPort},
		{"out of range ignored", "70000", DefaultPort},
		{"negative ignored", "-1", DefaultPort},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("AGENT_PILOT_PORT", tt.env)
			if got := DefaultBridgePort(); got != tt.want {
				t.Fatalf("DefaultBridgePort() with env %q = %d, want %d", tt.env, got, tt.want)
			}
		})
	}
}

func TestHealthReportsActiveBridgePort(t *testing.T) {
	original := activeBridgePort
	defer func() { activeBridgePort = original }()

	// /health must report the port the server actually bound, not a compiled-in guess
	activeBridgePort = 12345
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
