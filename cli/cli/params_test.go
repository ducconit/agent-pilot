package cli

import "testing"

func TestBuildClickParams(t *testing.T) {
	// 1. selector only -> synthetic default (no via key)
	p, err := BuildClickParams("#btn", 0, 0, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p["selector"] != "#btn" {
		t.Errorf("expected selector, got %v", p)
	}
	if _, ok := p["via"]; ok {
		t.Errorf("synthetic default should not send via, got %v", p["via"])
	}

	// 2. coordinates + via cdp
	p, err = BuildClickParams("", 733, 668, "cdp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p["x"] != 733.0 || p["y"] != 668.0 {
		t.Errorf("expected coordinates, got %v", p)
	}
	if p["via"] != "cdp" {
		t.Errorf("expected via=cdp, got %v", p["via"])
	}

	// 3. unknown via falls back to synthetic (omitted)
	p, err = BuildClickParams("#btn", 0, 0, "banana")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := p["via"]; ok {
		t.Errorf("invalid via should normalize to synthetic, got %v", p["via"])
	}

	// 4. neither selector nor coords -> error
	if _, err = BuildClickParams("", 0, 0, "cdp"); err == nil {
		t.Error("expected error when no selector and no coordinates")
	}
}

func TestBuildDragParams(t *testing.T) {
	// 1. selector form keeps legacy payload
	p, err := BuildDragParams("#a", "#b", -1, -1, -1, -1, 8, 0, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p["from"] != "#a" || p["to"] != "#b" {
		t.Errorf("expected selectors, got %v", p)
	}
	if p["steps"] != 8 {
		t.Errorf("expected steps=8, got %v", p["steps"])
	}
	if _, ok := p["via"]; ok {
		t.Errorf("synthetic default should not send via")
	}

	// 2. coordinate form with via cdp + hold
	p, err = BuildDragParams("", "", 745, 490, 745, 832, 10, 800, "cdp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p["fromX"] != 745.0 || p["fromY"] != 490.0 || p["toX"] != 745.0 || p["toY"] != 832.0 {
		t.Errorf("expected coordinates, got %v", p)
	}
	if p["holdMs"] != 800 {
		t.Errorf("expected holdMs=800, got %v", p["holdMs"])
	}
	if p["via"] != "cdp" {
		t.Errorf("expected via=cdp, got %v", p["via"])
	}

	// 3. partial coordinates -> error
	if _, err = BuildDragParams("", "", 745, -1, 745, 832, 10, 0, "cdp"); err == nil {
		t.Error("expected error for partial coordinates")
	}

	// 4. no selectors and no coords -> error
	if _, err = BuildDragParams("", "", -1, -1, -1, -1, 8, 0, ""); err == nil {
		t.Error("expected error when nothing is provided")
	}

	// 5. via auto is preserved
	p, err = BuildDragParams("#a", "#b", -1, -1, -1, -1, 8, 0, "auto")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p["via"] != "auto" {
		t.Errorf("expected via=auto, got %v", p["via"])
	}
}
