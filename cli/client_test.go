package main

import (
	"testing"
)

func TestParseBusyArgs_Default(t *testing.T) {
	isBusy, action, tab, err := ParseBusyArgs([]string{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !isBusy {
		t.Errorf("expected isBusy=true by default, got false")
	}
	if action != "AI Agent đang thao tác..." {
		t.Errorf("expected default action description, got: %s", action)
	}
	if tab != nil {
		t.Errorf("expected tab=nil, got: %v", tab)
	}
}

func TestParseBusyArgs_PositionalFirst(t *testing.T) {
	// e.g. agent-pilot busy on --action "Loading page" --tab 42
	isBusy, action, tab, err := ParseBusyArgs([]string{"on", "--action", "Loading page", "--tab", "42"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !isBusy {
		t.Errorf("expected isBusy=true, got false")
	}
	if action != "Loading page" {
		t.Errorf("expected action 'Loading page', got: %s", action)
	}
	if tab != 42 {
		t.Errorf("expected tab=42, got: %v", tab)
	}
}

func TestParseBusyArgs_PositionalLast(t *testing.T) {
	// e.g. agent-pilot busy --tab 100 --action "Typing" off
	isBusy, action, tab, err := ParseBusyArgs([]string{"--tab", "100", "--action", "Typing", "off"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if isBusy {
		t.Errorf("expected isBusy=false, got true")
	}
	if action != "Typing" {
		t.Errorf("expected action 'Typing', got: %s", action)
	}
	if tab != 100 {
		t.Errorf("expected tab=100, got: %v", tab)
	}
}

func TestParseBusyArgs_Aliases(t *testing.T) {
	cases := []struct {
		val      string
		expected bool
	}{
		{"false", false},
		{"0", false},
		{"off", false},
		{"true", true},
		{"1", true},
		{"on", true},
	}

	for _, c := range cases {
		isBusy, _, _, err := ParseBusyArgs([]string{c.val})
		if err != nil {
			t.Fatalf("unexpected error for %s: %v", c.val, err)
		}
		if isBusy != c.expected {
			t.Errorf("for %s expected isBusy=%v, got %v", c.val, c.expected, isBusy)
		}
	}
}

func TestParseBusyArgs_ActionValueIsStateKeyword(t *testing.T) {
	// e.g. agent-pilot busy --action "on" off
	isBusy, action, tab, err := ParseBusyArgs([]string{"--action", "on", "off"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if isBusy {
		t.Errorf("expected isBusy=false, got true")
	}
	if action != "on" {
		t.Errorf("expected action 'on', got: %s", action)
	}
	if tab != nil {
		t.Errorf("expected tab=nil, got: %v", tab)
	}
}
