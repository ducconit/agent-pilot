package main

import "testing"

func TestDeriveBatchTimeout(t *testing.T) {
	tests := []struct {
		name           string
		params         map[string]interface{}
		defaultTimeout int
		want           int
	}{
		{
			name: "no params returns the five-minute floor",
			want: batchBaseTimeoutMs,
		},
		{
			name:   "explicit timeoutMs above the floor gains overhead once",
			params: map[string]interface{}{"timeoutMs": float64(400000)},
			want:   400000 + batchActionsOverheadMs,
		},
		{
			name:   "explicit timeoutMs below the floor is clamped up",
			params: map[string]interface{}{"timeoutMs": float64(60000)},
			want:   batchBaseTimeoutMs,
		},
		{
			name: "small action list stays at the floor",
			params: map[string]interface{}{"actions": []interface{}{
				map[string]interface{}{"type": "click"},
			}},
			want: batchBaseTimeoutMs,
		},
		{
			// Regression: the overhead used to be added twice (loop + return),
			// producing 360000ms instead of 330000ms.
			name: "action sum above the floor gains overhead exactly once",
			params: map[string]interface{}{"actions": []interface{}{
				map[string]interface{}{"type": "wait", "ms": float64(150000)},
				map[string]interface{}{"type": "wait", "ms": float64(150000)},
			}},
			want: 300000 + batchActionsOverheadMs,
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
			want: batchBaseTimeoutMs,
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
