// feedback_waiter.go implements Channel A: the reactive long-poll that blocks an
// agent until a human submits feedback or the timeout elapses.
//
// Waiters are simple fan-out subscribers: each long-poll registers a buffered
// channel, a persisted session (via SaveFeedbackSession) calls
// CheckAndNotifyFeedbackWaiters to deliver to every waiter at once, and the
// registration is always removed on cancel/timeout so nothing leaks.
//
// The number of concurrent waiters is bounded by config.MaxFeedbackWaiters to keep the
// fan-out and goroutine count predictable.

package feedback

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/ducconit/agent-pilot-extension/cli/config"
)

type FeedbackWaiter struct {
	ID      string
	TabID   interface{}
	Channel chan map[string]interface{}
	Timer   *time.Timer
}

var (
	waitersLock    sync.Mutex
	pendingWaiters []*FeedbackWaiter
)

func WaitForFeedbackWithContext(ctx context.Context, timeoutSec int, tabID interface{}) map[string]interface{} {
	if timeoutSec <= 0 {
		timeoutSec = config.DefaultFeedbackTimeoutSec
	}
	waiterID := fmt.Sprintf("wait_%d", time.Now().UnixNano())
	ch := make(chan map[string]interface{}, 1)

	timer := time.NewTimer(time.Duration(timeoutSec) * time.Second)
	defer timer.Stop()

	waiter := &FeedbackWaiter{
		ID:      waiterID,
		TabID:   tabID,
		Channel: ch,
		Timer:   timer,
	}

	waitersLock.Lock()
	if len(pendingWaiters) >= config.MaxFeedbackWaiters {
		waitersLock.Unlock()
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Too many concurrent feedback waiters (max %d); try again later", config.MaxFeedbackWaiters),
		}
	}
	pendingWaiters = append(pendingWaiters, waiter)
	waitersLock.Unlock()

	removeWaiter := func() {
		waitersLock.Lock()
		var rem []*FeedbackWaiter
		for _, w := range pendingWaiters {
			if w.ID != waiterID {
				rem = append(rem, w)
			}
		}
		pendingWaiters = rem
		waitersLock.Unlock()
	}

	if ctx == nil {
		ctx = context.Background()
	}

	select {
	case res := <-ch:
		return res
	case <-ctx.Done():
		removeWaiter()
		return map[string]interface{}{
			"success": false,
			"error":   "Request canceled by client",
		}
	case <-timer.C:
		removeWaiter()
		// Drain a payload delivered at the same instant the timer fired so a
		// successful delivery is never reported as a timeout.
		select {
		case res := <-ch:
			return res
		default:
		}
		return map[string]interface{}{
			"success": false,
			"timeout": true,
			"message": fmt.Sprintf("Timed out waiting for feedback after %ds", timeoutSec),
		}
	}
}

func WaitForFeedback(timeoutSec int, tabID interface{}) map[string]interface{} {
	return WaitForFeedbackWithContext(context.Background(), timeoutSec, tabID)
}

// CheckAndNotifyFeedbackWaiters delivers a saved session to every waiting
// long-poll and clears the list. The buffered channels guarantee this never
// blocks even if a waiter is concurrently timing out.
func CheckAndNotifyFeedbackWaiters(data map[string]interface{}) {
	waitersLock.Lock()
	defer waitersLock.Unlock()

	for _, w := range pendingWaiters {
		w.Timer.Stop()
		payload := make(map[string]interface{}, len(data)+2)
		for k, v := range data {
			payload[k] = v
		}
		payload["success"] = true
		payload["delivered"] = true
		payload["channel"] = "reactive_channel_a"
		w.Channel <- payload
	}
	pendingWaiters = nil
}
