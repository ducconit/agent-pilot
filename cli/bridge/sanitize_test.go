package bridge

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMaskStringSecrets(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "OpenAI Key",
			input:    "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz",
			expected: "sk-proj******************** [MASKED_SECRET: OpenAI API Key]",
		},
		{
			name:     "Anthropic Key",
			input:    "sk-ant-1234567890abcdefghijklmnopqrstuvwxyz",
			expected: "sk-ant-******************** [MASKED_SECRET: Anthropic API Key]",
		},
		{
			name:     "Google Key",
			input:    "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456",
			expected: "AIzaSy******************** [MASKED_SECRET: Google API Key]",
		},
		{
			name:     "GitHub Token",
			input:    "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
			expected: "ghp_******************** [MASKED_SECRET: GitHub Token]",
		},
		{
			name:     "AWS Access Key",
			input:    "AKIAIOSFODNN7EXAMPLE",
			expected: "AKIA******************** [MASKED_SECRET: AWS Access Key]",
		},
		{
			name:     "Stripe Key",
			input:    "sk_live_1234567890abcdefghijklmnopqrstuvwxyz",
			expected: "sk_live_******************** [MASKED_SECRET: Stripe Key]",
		},
		{
			name:     "Slack Token",
			input:    "xoxb-1234567890-abcdefghijklmnop",
			expected: "xoxb-******************** [MASKED_SECRET: Slack Token]",
		},
		{
			name:     "JWT Token",
			input:    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
			expected: "eyJ******************** [MASKED_SECRET: JWT Token]",
		},
		{
			name:     "Bearer Token",
			input:    "Bearer secret_bearer_token_1234567890_abcdef",
			expected: "Bearer secr******************** [MASKED_SECRET: Bearer Token]",
		},
		{
			name:     "URL Param",
			input:    "https://example.com/api?api_key=my_secret_key_123456&user=alice",
			expected: "https://example.com/api?api_key=******************** [MASKED_SECRET: URL Parameter]&user=alice",
		},
		{
			name:     "Sensitive Key-Value in Raw JSON String",
			input:    `{"password": "super_secret_password_123"}`,
			expected: `{"password": "su******************** [MASKED_SECRET: Sensitive Field]"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, masked, _ := MaskString(tt.input)
			if !masked {
				t.Fatalf("expected string to be masked, got masked=false")
			}
			if res != tt.expected {
				t.Fatalf("expected:\n%s\ngot:\n%s", tt.expected, res)
			}
		})
	}
}

func TestSanitizeDataMap(t *testing.T) {
	data := map[string]interface{}{
		"normal":   "Hello world",
		"password": "super_secret_password_123",
		"nested": map[string]interface{}{
			"apiKey": "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456",
		},
	}

	sanitized := SanitizeData(data, true).(map[string]interface{})
	if sanitized["_securityNotice"] != AgentSecurityNotice {
		t.Fatalf("expected _securityNotice to be set")
	}
	if !strings.Contains(sanitized["password"].(string), "[MASKED_SECRET: password]") {
		t.Fatalf("expected password to be masked")
	}
	nested := sanitized["nested"].(map[string]interface{})
	if !strings.Contains(nested["apiKey"].(string), "[MASKED_SECRET") {
		t.Fatalf("expected nested apiKey to be masked")
	}
}

func TestSanitizeDataDisabled(t *testing.T) {
	data := map[string]interface{}{
		"password": "plain_password_123",
	}
	bypassed := SanitizeData(data, false).(map[string]interface{})
	if bypassed["password"] != "plain_password_123" {
		t.Fatalf("expected password to not be masked when disabled")
	}
}

func TestOriginValidation(t *testing.T) {
	if !IsOriginAllowed("") {
		t.Fatalf("empty origin should be allowed")
	}
	if !IsOriginAllowed("chrome-extension://abcdefghijklm") {
		t.Fatalf("chrome-extension should be allowed")
	}
	if !IsOriginAllowed("http://localhost:3000") {
		t.Fatalf("http://localhost:3000 should be allowed")
	}
	if !IsOriginAllowed("https://localhost:8443") {
		t.Fatalf("https://localhost:8443 should be allowed")
	}
	if !IsOriginAllowed("http://127.0.0.1:8080") {
		t.Fatalf("http://127.0.0.1:8080 should be allowed")
	}
	if IsOriginAllowed("http://evil.com") {
		t.Fatalf("evil.com should be rejected")
	}
	if IsOriginAllowed("https://malicious.localhost.com") {
		t.Fatalf("subdomain of localhost on external web should be rejected")
	}
}

func TestMaskStringPreservesValidJSON(t *testing.T) {
	rawJSON := `{"username": "admin", "password": "super_secret_password_123", "active": true}`
	masked, changed, _ := MaskString(rawJSON)
	if !changed {
		t.Fatalf("expected rawJSON to be masked")
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(masked), &parsed); err != nil {
		t.Fatalf("masked JSON string is malformed: %v\nOutput was: %s", err, masked)
	}
	if !strings.Contains(parsed["password"].(string), "[MASKED_SECRET: Sensitive Field]") {
		t.Fatalf("expected password to contain masked secret notice")
	}
	if parsed["username"] != "admin" {
		t.Fatalf("expected username to remain intact")
	}
}

func TestSanitizeDataHeaderKeysAndShortValues(t *testing.T) {
	data := map[string]interface{}{
		"headers": map[string]interface{}{
			"Authorization": "Basic dXNlcjpwYXNzd29yZA==",
			"Cookie":        "session=abc",
			"x-api-key":     "zz",
			"set-cookie":    "token=xyz",
		},
		"password": "abc",
	}

	res, ok := SanitizeData(data, true).(map[string]interface{})
	if !ok {
		t.Fatalf("expected sanitized map result")
	}
	headers, _ := res["headers"].(map[string]interface{})
	for _, key := range []string{"Authorization", "Cookie", "x-api-key", "set-cookie"} {
		value, _ := headers[key].(string)
		if !strings.Contains(value, "[MASKED_SECRET") {
			t.Fatalf("expected header %q to be masked, got %q", key, value)
		}
	}
	password, _ := res["password"].(string)
	if !strings.Contains(password, "[MASKED_SECRET") {
		t.Fatalf("expected short password value to be masked, got %q", password)
	}
}

func TestMaskStringQuotedValueWithSpaces(t *testing.T) {
	input := `const payload = { "password": "my secret pw" };`
	masked, changed, _ := MaskString(input)
	if !changed {
		t.Fatalf("expected quoted secret with spaces to be masked")
	}
	if strings.Contains(masked, "my secret pw") {
		t.Fatalf("secret value leaked: %s", masked)
	}
	if !strings.Contains(masked, "[MASKED_SECRET: Sensitive Field]") {
		t.Fatalf("expected masked marker in output: %s", masked)
	}
}

func TestSanitizeDataErrorStrings(t *testing.T) {
	masked, ok := SanitizeData("authorization failed with sk-proj-1234567890abcdefghijklmnop", true).(string)
	if !ok {
		t.Fatalf("expected string result")
	}
	if strings.Contains(masked, "sk-proj-1234567890abcdefghijklmnop") {
		t.Fatalf("error string leaked the secret: %s", masked)
	}
}

func TestSanitizeDataDepthCap(t *testing.T) {
	// Build a payload deeper than maxSanitizeDepth; the walker must stop instead
	// of recursing without bound on attacker-shaped data.
	deep := map[string]interface{}{"password": "top-secret-value"}
	for i := 0; i < maxSanitizeDepth+10; i++ {
		deep = map[string]interface{}{"nested": deep}
	}

	result, ok := SanitizeData(deep, true).(map[string]interface{})
	if !ok {
		t.Fatalf("expected a map result, got %T", SanitizeData(deep, true))
	}

	// Walk down until the cap marker appears; it must exist before we reach the leaf.
	foundMarker := false
	current := result
	for i := 0; i < maxSanitizeDepth+10; i++ {
		next, ok := current["nested"]
		if !ok {
			break
		}
		if marker, isString := next.(string); isString && strings.Contains(marker, "SANITIZE_MAX_DEPTH_EXCEEDED") {
			foundMarker = true
			break
		}
		current, ok = next.(map[string]interface{})
		if !ok {
			break
		}
	}
	if !foundMarker {
		t.Fatalf("expected depth-cap marker at depth > %d", maxSanitizeDepth)
	}
}

func TestSanitizeDataBypassPrevention(t *testing.T) {
	// A string containing "[MASKED_SECRET" decoy text alongside a real secret must still mask the real secret.
	decoyPlusSecret := "Decoy [MASKED_SECRET: fake] and real key sk-proj-1234567890abcdefghijklmnopqrstuvwxyz"
	maskedStr, changed, _ := MaskString(decoyPlusSecret)
	if !changed {
		t.Fatalf("expected real secret alongside decoy marker to be masked")
	}
	if strings.Contains(maskedStr, "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz") {
		t.Fatalf("real OpenAI key leaked when decoy marker was present: %s", maskedStr)
	}
	if !strings.Contains(maskedStr, "[MASKED_SECRET: OpenAI API Key]") {
		t.Fatalf("expected OpenAI API Key mask marker, got: %s", maskedStr)
	}

	// Sensitive keyContext with decoy marker or numeric PIN must be masked.
	payload := map[string]interface{}{
		"password": "my_real_password [MASKED_SECRET",
		"pin":      948321,
	}
	sanitized := SanitizeData(payload, true).(map[string]interface{})
	if strings.Contains(sanitized["password"].(string), "my_real_password") {
		t.Fatalf("password with decoy substring leaked: %v", sanitized["password"])
	}
	if !strings.Contains(sanitized["pin"].(string), "[MASKED_SECRET: pin]") {
		t.Fatalf("numeric pin was not masked: %v", sanitized["pin"])
	}
}
