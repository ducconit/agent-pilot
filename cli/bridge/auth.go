package bridge

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ducconit/agent-pilot-extension/cli/config"
)

// AuthEnabled is intentionally false by default. Setting AGENT_PILOT_API_KEY
// enables the same key for HTTP clients, CLI forwarding and extension handshakes.
func AuthEnabled() bool {
	return config.BridgeAPIKey() != ""
}

func keysEqual(candidate, expected string) bool {
	if candidate == "" || expected == "" {
		return false
	}
	candHash := sha256.Sum256([]byte(candidate))
	expHash := sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(candHash[:], expHash[:]) == 1
}

func apiKeyFromRequest(r *http.Request) string {
	if key := strings.TrimSpace(r.Header.Get(config.APIKeyHeader)); key != "" {
		return key
	}
	const prefix = config.APITokenScheme + " "
	if value := strings.TrimSpace(r.Header.Get("Authorization")); strings.HasPrefix(value, prefix) {
		return strings.TrimSpace(strings.TrimPrefix(value, prefix))
	}
	return ""
}

// AuthorizeHTTP applies auth only when the operator configured a key. This
// preserves the original no-auth local bridge behavior by default.
func AuthorizeHTTP(r *http.Request) bool {
	expected := config.BridgeAPIKey()
	return expected == "" || keysEqual(apiKeyFromRequest(r), expected)
}

func writeAuthError(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "Authentication required"})
}

func requireHTTPAuth(w http.ResponseWriter, r *http.Request) bool {
	if AuthorizeHTTP(r) {
		return true
	}
	writeAuthError(w)
	return false
}

// WithHTTPAuth protects an HTTP handler only when AGENT_PILOT_API_KEY is set.
func WithHTTPAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// CORS preflight carries no custom auth header by design; it only asks
		// whether the actual request is permitted. The actual request remains gated.
		if r.Method == http.MethodOptions || requireHTTPAuth(w, r) {
			next(w, r)
		}
	}
}

// AuthorizeWebSocketHandshake validates the first extension HANDSHAKE frame.
// The key is never put in the URL, avoiding browser history and proxy logs.
func AuthorizeWebSocketHandshake(message map[string]interface{}) bool {
	expected := config.BridgeAPIKey()
	if expected == "" {
		return true
	}

	candidate, _ := message["apiKey"].(string)
	if candidate == "" {
		if auth, ok := message["auth"].(map[string]interface{}); ok {
			candidate, _ = auth["apiKey"].(string)
		}
	}
	return keysEqual(strings.TrimSpace(candidate), expected)
}
