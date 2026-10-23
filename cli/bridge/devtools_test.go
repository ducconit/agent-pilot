package bridge

import "testing"

func TestDevtoolsRouting(t *testing.T) {
	cases := []struct {
		method string
		params map[string]interface{}
		host   bool
	}{
		{"lighthouse.audit", nil, true}, {"lighthouse.analyze", nil, true},
		{"performance.trace", nil, true}, {"performance.analyzeInsight", nil, true},
		{"screencast.record", nil, true}, {"contexts.create", nil, true},
		{"css.getStyles", map[string]interface{}{"tabId": 42}, false},
		{"css.getStyles", map[string]interface{}{"tabId": -42}, true},
		{"page.evaluate", map[string]interface{}{"agentLastTabId": -42}, true},
		{"page.evaluate", map[string]interface{}{"tabId": 42, "agentLastTabId": -42}, false},
		{"tabs.create", map[string]interface{}{"agentLastTabId": -42}, false},
		{"tabs.create", map[string]interface{}{"isolatedContext": "account-a"}, true},
		{"tabs.create", map[string]interface{}{"contextId": "abc"}, true},
		{"workers.debug", nil, false}, {"workers.debug", map[string]interface{}{"contextId": "abc"}, true},
		{"extensions.manage", map[string]interface{}{"agentLastTabId": -42}, false},
	}
	for _, test := range cases {
		if got := useDevtoolsHost(test.method, test.params); got != test.host {
			t.Errorf("route %s %+v: host=%v, want %v", test.method, test.params, got, test.host)
		}
	}
}

func TestAdvancedCommandTimeouts(t *testing.T) {
	for _, method := range []string{"contexts.create", "screencast.record", "performance.trace", "performance.analyzeInsight", "accessibility.snapshot", "devtools.runtime"} {
		if got := DeriveCommandTimeout(method, nil, 30000); got < 180000 {
			t.Errorf("%s budget=%d, expected at least 180s", method, got)
		}
		if got := DeriveCommandTimeout(method, map[string]interface{}{"timeoutMs": 240000}, 30000); got != 240000 {
			t.Errorf("%s explicit budget=%d, expected 240000", method, got)
		}
	}
	for _, method := range []string{"lighthouse.audit", "lighthouse.analyze"} {
		if got := DeriveCommandTimeout(method, nil, 30000); got != 60000 {
			t.Errorf("%s budget=%d, expected 60s default", method, got)
		}
		if got := DeriveCommandTimeout(method, map[string]interface{}{"timeoutMs": 15000}, 0); got != 15000 {
			t.Errorf("%s short explicit budget=%d, expected 15000", method, got)
		}
		if got := DeriveCommandTimeout(method, map[string]interface{}{"timeoutMs": 5000}, 30000); got != 5000 {
			t.Errorf("%s forwarded short budget=%d, expected 5000", method, got)
		}
		if got := DeriveCommandTimeout(method, map[string]interface{}{"timeoutMs": 240000}, 30000); got != 240000 {
			t.Errorf("%s explicit budget=%d, expected 240000", method, got)
		}
	}
}
