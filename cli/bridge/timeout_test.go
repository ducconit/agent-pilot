package bridge

import (
	"testing"

	"github.com/ducconit/agent-pilot-extension/cli/config"
)

func TestDeriveBatchTimeout(t *testing.T) {
	tests := []struct {
		name           string
		params         map[string]interface{}
		defaultTimeout int
		want           int
	}{
		{
			name: "no params returns the five-minute floor",
			want: config.BatchBaseTimeoutMs,
		},
		{
			name:   "explicit timeoutMs above the floor gains overhead once",
			params: map[string]interface{}{"timeoutMs": float64(400000)},
			want:   400000 + config.BatchActionsOverheadMs,
		},
		{
			name:   "explicit timeoutMs below the floor is clamped up",
			params: map[string]interface{}{"timeoutMs": float64(60000)},
			want:   config.BatchBaseTimeoutMs,
		},
		{
			name: "small action list stays at the floor",
			params: map[string]interface{}{"actions": []interface{}{
				map[string]interface{}{"type": "click"},
			}},
			want: config.BatchBaseTimeoutMs,
		},
		{
			// Regression: the overhead used to be added twice (loop + return),
			// producing 360000ms instead of 330000ms.
			name: "action sum above the floor gains overhead exactly once",
			params: map[string]interface{}{"actions": []interface{}{
				map[string]interface{}{"type": "wait", "ms": float64(150000)},
				map[string]interface{}{"type": "wait", "ms": float64(150000)},
			}},
			want: 300000 + config.BatchActionsOverheadMs,
		},
		{
			name:           "larger caller default raises the floor",
			params:         map[string]interface{}{"actions": []interface{}{map[string]interface{}{"type": "click"}}},
			defaultTimeout: 500000,
			want:           500000,
		},
		{
			name: "wait_for_selector contributes its default estimate",
			params: map[string]interface{}{"actions": []interface{}{
				map[string]interface{}{"type": "wait_for_selector"},
			}},
			want: config.BatchBaseTimeoutMs,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := deriveBatchTimeout(tt.params, tt.defaultTimeout); got != tt.want {
				t.Fatalf("deriveBatchTimeout() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestDeriveCommandTimeout(t *testing.T) {
	// 1. Default timeout fallback
	to := DeriveCommandTimeout("page.click", nil, 0)
	if to != 15000 {
		t.Errorf("expected 15000, got %d", to)
	}

	// 2. Custom default timeout
	to = DeriveCommandTimeout("page.click", nil, 5000)
	if to != 5000 {
		t.Errorf("expected 5000, got %d", to)
	}

	// 3. batch.run base minimum 300,000ms (5 minutes)
	to = DeriveCommandTimeout("batch.run", nil, 10000)
	if to != 300000 {
		t.Errorf("expected 300000, got %d", to)
	}

	// 4. page.waitFor with explicit timeoutMs (int)
	to = DeriveCommandTimeout("page.waitFor", map[string]interface{}{"timeoutMs": 20000}, 0)
	if to != 25000 {
		t.Errorf("expected 25000, got %d", to)
	}

	// 5. page.waitFor with explicit timeoutMs (float64 from JSON)
	to = DeriveCommandTimeout("page.waitFor", map[string]interface{}{"timeoutMs": float64(12000)}, 15000)
	if to != 17000 {
		t.Errorf("expected 17000, got %d", to)
	}

	// 6. page.waitFor with timeout alias (int)
	to = DeriveCommandTimeout("page.waitFor", map[string]interface{}{"timeout": 60000}, 0)
	if to != 65000 {
		t.Errorf("expected 65000, got %d", to)
	}

	// 7. batch.run dynamically scaled based on actions
	longBatch := map[string]interface{}{
		"actions": []interface{}{
			map[string]interface{}{"type": "wait", "ms": 200000},
			map[string]interface{}{"type": "sleep", "duration": 200000},
		},
	}
	to = DeriveCommandTimeout("batch.run", longBatch, 0)
	if to != 430000 {
		t.Errorf("expected 430000, got %d", to)
	}

	// 8. batch.run with wait_for_selector timeout > 5m
	selectorWaitBatch := map[string]interface{}{
		"actions": []interface{}{
			map[string]interface{}{"type": "wait_for_selector", "selector": "#long-task", "timeout": 400000},
		},
	}
	to = DeriveCommandTimeout("batch.run", selectorWaitBatch, 0)
	if to != 430000 {
		t.Errorf("expected 430000, got %d", to)
	}

	// 9. batch.run with wait on selector timeout > 5m
	waitSelectorBatch := map[string]interface{}{
		"actions": []interface{}{
			map[string]interface{}{"type": "wait", "selector": ".ready", "timeoutMs": 350000},
		},
	}
	to = DeriveCommandTimeout("batch.run", waitSelectorBatch, 0)
	if to != 380000 {
		t.Errorf("expected 380000, got %d", to)
	}

	// 10. batch.run with navigation loadTimeout and aliases
	navBatch := map[string]interface{}{
		"actions": []interface{}{
			map[string]interface{}{"type": "tabs.update", "url": "https://example.com", "loadTimeout": 400000},
			map[string]interface{}{"type": "tabs.create", "url": "https://example.com/2", "loadTimeout": 200000},
		},
	}
	to = DeriveCommandTimeout("batch.run", navBatch, 0)
	if to != 630000 {
		t.Errorf("expected 630000, got %d", to)
	}
}
