package feedback

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFeedbackStorageAndRetrieval(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "ap_test_feedback_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	_ = os.Setenv("AGENT_PILOT_HOME", tempDir)
	defer os.Unsetenv("AGENT_PILOT_HOME")

	storageDir := GetFeedbackStorageDir()
	if !strings.HasPrefix(storageDir, tempDir) {
		t.Fatalf("expected storageDir to start with tempDir, got: %s", storageDir)
	}

	testTimestamp := "1789234567890"
	samplePngBase64 := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

	payload := map[string]interface{}{
		"timestamp": testTimestamp,
		"url":       "http://localhost:3000/dashboard",
		"title":     "Analytics Dashboard",
		"items": []interface{}{
			map[string]interface{}{
				"id":      "item_1",
				"mode":    "element",
				"title":   "Revenue Card",
				"comment": "Fix background color",
				"dom": map[string]interface{}{
					"selector": "#revenue-card",
				},
				"component": map[string]interface{}{
					"framework":     "React",
					"componentName": "RevenueCard",
					"fileName":      "src/components/RevenueCard.tsx",
					"lineNumber":    42,
				},
				"screenshotDataUrl": samplePngBase64,
			},
		},
	}

	saveRes, err := SaveFeedbackSession(payload)
	if err != nil {
		t.Fatalf("SaveFeedbackSession failed: %v", err)
	}

	sessionID, ok := saveRes["sessionId"].(string)
	if !ok || sessionID != testTimestamp {
		t.Fatalf("expected sessionId %s, got: %v", testTimestamp, saveRes["sessionId"])
	}

	sessionDir := filepath.Join(storageDir, testTimestamp)
	if _, err := os.Stat(filepath.Join(sessionDir, "session.json")); err != nil {
		t.Fatalf("session.json does not exist: %v", err)
	}
	if _, err := os.Stat(filepath.Join(sessionDir, "prompt.md")); err != nil {
		t.Fatalf("prompt.md does not exist: %v", err)
	}
	if _, err := os.Stat(filepath.Join(sessionDir, "item_1.png")); err != nil {
		t.Fatalf("item_1.png does not exist: %v", err)
	}

	// Verify prompt.md contains clean paths and NO base64 bloat
	promptBytes, err := os.ReadFile(filepath.Join(sessionDir, "prompt.md"))
	if err != nil {
		t.Fatalf("failed to read prompt.md: %v", err)
	}
	promptStr := string(promptBytes)
	if strings.Contains(promptStr, "data:image/png;base64") {
		t.Fatalf("prompt.md contains raw base64 data bloat")
	}
	if !strings.Contains(promptStr, "RevenueCard.tsx:42") {
		t.Fatalf("prompt.md should contain component source path")
	}

	// Test GetPendingFeedback query
	resMap, err := GetPendingFeedback(10, "", false)
	if err != nil {
		t.Fatalf("GetPendingFeedback failed: %v", err)
	}
	sessions, ok := resMap["sessions"].([]map[string]interface{})
	if !ok || len(sessions) < 1 {
		t.Fatalf("expected at least 1 session in resMap, got: %v", resMap["sessions"])
	}
	found := false
	for _, s := range sessions {
		if s["sessionId"] == testTimestamp {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("test session not found in pending list")
	}

	// Test Clear / Archive
	clearedRes, err := GetPendingFeedback(10, testTimestamp, true)
	if err != nil {
		t.Fatalf("GetPendingFeedback with clear failed: %v", err)
	}
	clearedSessions := clearedRes["sessions"].([]map[string]interface{})
	if len(clearedSessions) == 0 {
		t.Fatalf("expected cleared session to be returned")
	}

	// Session directory should be moved to archive
	if _, err := os.Stat(sessionDir); !os.IsNotExist(err) {
		t.Fatalf("sessionDir should have been moved away from pending inbox")
	}
	archiveDir := filepath.Join(tempDir, "inbox", "feedback_archive", testTimestamp)
	if _, err := os.Stat(archiveDir); err != nil {
		t.Fatalf("expected session to exist in archive: %v", err)
	}
}

func TestWaitForFeedbackReactiveLongPoll(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "ap_test_feedback_wait_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	_ = os.Setenv("AGENT_PILOT_HOME", tempDir)
	defer os.Unsetenv("AGENT_PILOT_HOME")

	waitDone := make(chan map[string]interface{}, 1)
	go func() {
		res := WaitForFeedback(5, nil)
		waitDone <- res
	}()

	// Wait 50ms then submit feedback live
	time.Sleep(50 * time.Millisecond)
	liveTs := "1789239999999"
	_, err = SaveFeedbackSession(map[string]interface{}{
		"timestamp": liveTs,
		"url":       "http://localhost:3000/order",
		"items": []interface{}{
			map[string]interface{}{
				"id":    "item_live",
				"title": "Live Order Button",
			},
		},
	})
	if err != nil {
		t.Fatalf("SaveFeedbackSession failed: %v", err)
	}

	select {
	case res := <-waitDone:
		if success, ok := res["success"].(bool); !ok || !success {
			t.Fatalf("expected wait to succeed, got: %v", res)
		}
		if res["sessionId"] != liveTs {
			t.Fatalf("expected sessionId %s, got: %v", liveTs, res["sessionId"])
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("WaitForFeedback did not resolve reactively within timeout")
	}
}

func TestSaveFeedbackSessionPathTraversalDefense(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "ap_test_traversal_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	_ = os.Setenv("AGENT_PILOT_HOME", tempDir)
	defer os.Unsetenv("AGENT_PILOT_HOME")

	storageDir := GetFeedbackStorageDir()

	// Malicious payload attempting path traversal
	maliciousPayload := map[string]interface{}{
		"timestamp": "../../../Desktop/MaliciousDir",
		"url":       "http://localhost:3000/hack",
		"items": []interface{}{
			map[string]interface{}{
				"id":    "item_hacked",
				"title": "Exploit Test",
			},
		},
	}

	saveRes, err := SaveFeedbackSession(maliciousPayload)
	if err != nil {
		t.Fatalf("SaveFeedbackSession failed: %v", err)
	}

	savedDir, ok := saveRes["sessionDir"].(string)
	if !ok {
		t.Fatalf("expected sessionDir in response")
	}

	// Must be strictly contained within storageDir
	if !strings.HasPrefix(savedDir, storageDir) {
		t.Fatalf("path traversal exploit succeeded: savedDir %s is outside storageDir %s", savedDir, storageDir)
	}
	if strings.Contains(savedDir, "Desktop") {
		t.Fatalf("path traversal exploit escaped into Desktop path: %s", savedDir)
	}
}

func TestWaitForFeedbackContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	waitDone := make(chan map[string]interface{}, 1)
	go func() {
		res := WaitForFeedbackWithContext(ctx, 30, nil)
		waitDone <- res
	}()

	// Cancel context after 50ms
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case res := <-waitDone:
		if success, ok := res["success"].(bool); ok && success {
			t.Fatalf("expected canceled wait to report error, got success: %v", res)
		}
		if res["error"] != "Request canceled by client" {
			t.Fatalf("expected client cancellation error, got: %v", res)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("WaitForFeedbackWithContext did not abort on context cancellation")
	}
}

func TestSaveFeedbackSessionStripsInlineBase64AndSavesDiagnostics(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "ap_test_feedback_diag_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	_ = os.Setenv("AGENT_PILOT_HOME", tempDir)
	defer os.Unsetenv("AGENT_PILOT_HOME")

	samplePngBase64 := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
	payload := map[string]interface{}{
		"timestamp": "1789234569999",
		"url":       "http://localhost:3000/checkout",
		"title":     "Checkout Page",
		"prompt":    "### Bug Report\n![Mục 1](" + samplePngBase64 + ")\n",
		"diagnostics": map[string]interface{}{
			"environment": map[string]interface{}{"viewport": "1440x900"},
		},
		"items": []interface{}{
			map[string]interface{}{
				"id":                "item_1",
				"mode":              "element",
				"title":             "Pay Button",
				"screenshotDataUrl": samplePngBase64,
			},
		},
	}

	saveRes, err := SaveFeedbackSession(payload)
	if err != nil {
		t.Fatalf("SaveFeedbackSession failed: %v", err)
	}

	promptMD, _ := saveRes["promptMd"].(string)
	if strings.Contains(promptMD, "data:image/png;base64") {
		t.Fatalf("expected SaveFeedbackSession to strip raw base64 from promptMd, got: %s", promptMD)
	}
	if !strings.Contains(promptMD, "item_1.png") {
		t.Fatalf("expected promptMd to reference item_1.png, got: %s", promptMD)
	}
}
