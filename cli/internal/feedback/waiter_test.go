package feedback

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ducconit/agent-pilot/cli/internal/config"
)

func TestFeedbackWaiterCap(t *testing.T) {
	waitersLock.Lock()
	saved := pendingWaiters
	dummies := make([]*FeedbackWaiter, config.MaxFeedbackWaiters)
	for i := range dummies {
		dummies[i] = &FeedbackWaiter{
			ID:      fmt.Sprintf("dummy_%d", i),
			Channel: make(chan map[string]interface{}, 1),
			Timer:   time.NewTimer(time.Minute),
		}
	}
	pendingWaiters = dummies
	waitersLock.Unlock()
	defer func() {
		waitersLock.Lock()
		pendingWaiters = saved
		waitersLock.Unlock()
		for _, d := range dummies {
			d.Timer.Stop()
		}
	}()

	res := WaitForFeedbackWithContext(context.Background(), 1, nil)
	if success, _ := res["success"].(bool); success {
		t.Fatalf("expected waiter cap rejection, got: %#v", res)
	}
	if msg, _ := res["error"].(string); !strings.Contains(msg, "Too many concurrent feedback waiters") {
		t.Fatalf("expected waiter cap error message, got: %#v", res)
	}
}

func TestFeedbackWaiterDelivery(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "ap_test_wait_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)
	_ = os.Setenv(config.FeedbackHomeEnvVar, tempDir)
	defer os.Unsetenv(config.FeedbackHomeEnvVar)

	type waiterResult struct {
		res     map[string]interface{}
		elapsed time.Duration
	}
	done := make(chan waiterResult, 1)
	go func() {
		start := time.Now()
		res := WaitForFeedbackWithContext(context.Background(), 5, nil)
		done <- waiterResult{res: res, elapsed: time.Since(start)}
	}()

	time.Sleep(100 * time.Millisecond)

	saveRes, err := SaveFeedbackSession(map[string]interface{}{
		"timestamp": "1789234567999",
		"items":     []interface{}{},
	})
	if err != nil {
		t.Fatalf("SaveFeedbackSession failed: %v", err)
	}

	select {
	case wr := <-done:
		if wr.res["timeout"] == true {
			t.Fatalf("waiter reported timeout despite delivery: %#v", wr.res)
		}
		if wr.res["sessionId"] != saveRes["sessionId"] {
			t.Fatalf("waiter received wrong payload: %#v", wr.res)
		}
		if wr.elapsed > 3*time.Second {
			t.Fatalf("waiter delivery was too slow: %v", wr.elapsed)
		}
	case <-time.After(6 * time.Second):
		t.Fatalf("waiter did not resolve")
	}
}
