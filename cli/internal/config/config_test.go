package config

import "testing"

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
