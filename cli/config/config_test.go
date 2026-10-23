package config

import "testing"

func TestDefaultBridgePortEnvOverride(t *testing.T) {
	_ = SetBridgePortOverride(0)
	t.Cleanup(func() { _ = SetBridgePortOverride(0) })
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

func TestBridgePortOverrideTakesPrecedenceAndCanClear(t *testing.T) {
	t.Setenv("AGENT_PILOT_PORT", "60001")
	if err := SetBridgePortOverride(60002); err != nil {
		t.Fatalf("SetBridgePortOverride failed: %v", err)
	}
	if got := DefaultBridgePort(); got != 60002 {
		t.Fatalf("override = %d, want 60002", got)
	}
	if err := SetBridgePortOverride(0); err != nil {
		t.Fatalf("clearing override failed: %v", err)
	}
	if got := DefaultBridgePort(); got != 60001 {
		t.Fatalf("cleared override = %d, want environment port 60001", got)
	}
}

func TestBridgePortOverrideRejectsInvalidPort(t *testing.T) {
	for _, port := range []int{-1, 65536} {
		if err := SetBridgePortOverride(port); err == nil {
			t.Fatalf("expected port %d to be rejected", port)
		}
	}
}

func TestInstanceIDOverridePrecedenceAndClear(t *testing.T) {
	t.Setenv(InstanceIDEnvVar, "env-browser")
	SetInstanceIDOverride("")
	t.Cleanup(func() { SetInstanceIDOverride("") })

	if got := DefaultInstanceID(); got != "env-browser" {
		t.Fatalf("environment instance ID = %q, want env-browser", got)
	}
	SetInstanceIDOverride(" cli-browser ")
	if got := DefaultInstanceID(); got != "cli-browser" {
		t.Fatalf("override instance ID = %q, want cli-browser", got)
	}
	SetInstanceIDOverride("")
	if got := DefaultInstanceID(); got != "env-browser" {
		t.Fatalf("cleared instance ID = %q, want env-browser", got)
	}
}
