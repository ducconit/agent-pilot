package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type FeedbackItem struct {
	ID                 string                 `json:"id"`
	Mode               string                 `json:"mode"`
	Title              string                 `json:"title"`
	Comment            string                 `json:"comment"`
	DOM                map[string]interface{} `json:"dom,omitempty"`
	Component          map[string]interface{} `json:"component,omitempty"`
	Clip               map[string]interface{} `json:"clip,omitempty"`
	Annotations        []interface{}          `json:"annotations,omitempty"`
	ScreenshotDataURL  string                 `json:"screenshotDataUrl,omitempty"`
	ImageFile          string                 `json:"imageFile,omitempty"`
	ImagePath          string                 `json:"imagePath,omitempty"`
}

type FeedbackSession struct {
	SessionID string         `json:"sessionId"`
	SavedAt   string         `json:"savedAt"`
	URL       string         `json:"url"`
	Title     string         `json:"title"`
	Count     int            `json:"count"`
	Items     []FeedbackItem `json:"items"`
}

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

func GetFeedbackStorageDir() string {
	customHome := os.Getenv("AGENT_PILOT_HOME")
	if customHome != "" {
		return filepath.Join(customHome, "inbox", "feedback")
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		userHome = "."
	}
	return filepath.Join(userHome, ".agent-pilot", "inbox", "feedback")
}

func SaveFeedbackSession(payload map[string]interface{}) (map[string]interface{}, error) {
	ts := fmt.Sprintf("%d", time.Now().UnixMilli())
	if tVal, ok := payload["timestamp"]; ok && tVal != nil {
		switch v := tVal.(type) {
		case float64:
			ts = fmt.Sprintf("%.0f", v)
		case int64:
			ts = fmt.Sprintf("%d", v)
		case int:
			ts = fmt.Sprintf("%d", v)
		case string:
			ts = v
		default:
			ts = fmt.Sprintf("%v", tVal)
		}
	}

	// Security: Sanitize timestamp against path traversal attacks (e.g. "../../../evil")
	ts = filepath.Base(filepath.Clean(ts))
	if ts == "." || ts == "/" || ts == "\\" || ts == "" || strings.Contains(ts, "..") {
		ts = fmt.Sprintf("%d", time.Now().UnixMilli())
	}

	storageDir := GetFeedbackStorageDir()
	sessionDir := filepath.Join(storageDir, ts)
	rel, err := filepath.Rel(storageDir, sessionDir)
	if err != nil || strings.HasPrefix(rel, "..") || rel == "." {
		ts = fmt.Sprintf("%d", time.Now().UnixMilli())
		sessionDir = filepath.Join(storageDir, ts)
	}

	if err := os.MkdirAll(sessionDir, 0755); err != nil {
		return nil, err
	}

	var rawItems []interface{}
	if itVal, ok := payload["items"].([]interface{}); ok {
		rawItems = itVal
	}

	savedItems := make([]FeedbackItem, 0, len(rawItems))

	for i, raw := range rawItems {
		itemMap, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		itemNum := i + 1
		id, _ := itemMap["id"].(string)
		if id == "" {
			id = fmt.Sprintf("item_%d", itemNum)
		}
		mode, _ := itemMap["mode"].(string)
		title, _ := itemMap["title"].(string)
		comment, _ := itemMap["comment"].(string)

		var domMap map[string]interface{}
		if d, ok := itemMap["dom"].(map[string]interface{}); ok {
			domMap = d
		}
		var compMap map[string]interface{}
		if c, ok := itemMap["component"].(map[string]interface{}); ok {
			compMap = c
		}
		var clipMap map[string]interface{}
		if cl, ok := itemMap["clip"].(map[string]interface{}); ok {
			clipMap = cl
		}
		var annList []interface{}
		if a, ok := itemMap["annotations"].([]interface{}); ok {
			annList = a
		}

		imageFileName := ""
		imageAbsolutePath := ""

		if dataURL, ok := itemMap["screenshotDataUrl"].(string); ok && strings.HasPrefix(dataURL, "data:image/") {
			parts := strings.SplitN(dataURL, ",", 2)
			if len(parts) == 2 {
				ext := "png"
				if strings.Contains(parts[0], "jpeg") || strings.Contains(parts[0], "jpg") {
					ext = "jpg"
				}
				imageFileName = fmt.Sprintf("item_%d.%s", itemNum, ext)
				imageAbsolutePath = filepath.Join(sessionDir, imageFileName)
				if imgBytes, err := base64.StdEncoding.DecodeString(parts[1]); err == nil {
					_ = os.WriteFile(imageAbsolutePath, imgBytes, 0644)
				}
			}
		}

		savedItems = append(savedItems, FeedbackItem{
			ID:          id,
			Mode:        mode,
			Title:       title,
			Comment:     comment,
			DOM:         domMap,
			Component:   compMap,
			Clip:        clipMap,
			Annotations: annList,
			ImageFile:   imageFileName,
			ImagePath:   imageAbsolutePath,
		})
	}

	pageURL, _ := payload["url"].(string)
	pageTitle, _ := payload["title"].(string)

	meta := FeedbackSession{
		SessionID: ts,
		SavedAt:   time.Now().Format(time.RFC3339),
		URL:       pageURL,
		Title:     pageTitle,
		Count:     len(savedItems),
		Items:     savedItems,
	}

	metaBytes, _ := json.MarshalIndent(meta, "", "  ")
	_ = os.WriteFile(filepath.Join(sessionDir, "session.json"), metaBytes, 0644)

	// Format prompt.md
	promptMD, _ := payload["prompt"].(string)
	if promptMD == "" {
		var sb strings.Builder
		sb.WriteString("### 🎯 YÊU CẦU CHỈNH SỬA GIAO DIỆN (Agent Pilot Visual Feedback)\n\n")
		sb.WriteString(fmt.Sprintf("- **URL**: `%s`\n", pageURL))
		sb.WriteString(fmt.Sprintf("- **Tiêu đề trang**: \"%s\"\n", pageTitle))
		sb.WriteString(fmt.Sprintf("- **Thời gian ghi nhận**: %s\n", time.Now().Format("02/01/2006 15:04:05")))
		sb.WriteString(fmt.Sprintf("- **Tổng số mục phản hồi**: %d\n\n---\n\n", len(savedItems)))

		for idx, it := range savedItems {
			sb.WriteString(fmt.Sprintf("#### Mục %d: [%s] %s\n", idx+1, strings.ToUpper(it.Mode), it.Title))
			if it.Component != nil {
				fw, _ := it.Component["framework"].(string)
				cn, _ := it.Component["componentName"].(string)
				fn, _ := it.Component["fileName"].(string)
				ln := it.Component["lineNumber"]
				sb.WriteString(fmt.Sprintf("- **Component Framework**: `%s`\n", fw))
				sb.WriteString(fmt.Sprintf("- **Component Name**: `<%s />`\n", cn))
				if fn != "" {
					if ln != nil {
						sb.WriteString(fmt.Sprintf("- **Đường dẫn tệp nguồn (Source File)**: `%s:%v`\n", fn, ln))
					} else {
						sb.WriteString(fmt.Sprintf("- **Đường dẫn tệp nguồn (Source File)**: `%s`\n", fn))
					}
				}
			}
			if it.DOM != nil {
				sel, _ := it.DOM["selector"].(string)
				xp, _ := it.DOM["xpath"].(string)
				txt, _ := it.DOM["text"].(string)
				sb.WriteString(fmt.Sprintf("- **CSS Selector**: `%s`\n", sel))
				if xp != "" {
					sb.WriteString(fmt.Sprintf("- **XPath**: `%s`\n", xp))
				}
				if txt != "" {
					sb.WriteString(fmt.Sprintf("- **Nội dung text**: \"%s\"\n", strings.ReplaceAll(txt, "\n", " ")))
				}
			}
			if it.Clip != nil {
				w, _ := it.Clip["width"]
				h, _ := it.Clip["height"]
				x, _ := it.Clip["x"]
				y, _ := it.Clip["y"]
				sb.WriteString(fmt.Sprintf("- **Tọa độ / Kích thước**: %v×%vpx (x: %v, y: %v)\n", w, h, x, y))
			}
			cText := it.Comment
			if cText == "" {
				cText = "*(Không có ghi chú)*"
			}
			sb.WriteString(fmt.Sprintf("- **Yêu cầu chỉnh sửa (User Note)**:\n  > %s\n\n", strings.ReplaceAll(cText, "\n", "\n  > ")))
			if it.ImageFile != "" {
				sb.WriteString(fmt.Sprintf("- **Ảnh chụp thực tế**: \n  ![Mục %d](%s)\n\n", idx+1, it.ImageFile))
			}
			sb.WriteString("---\n\n")
		}
		promptMD = sb.String()
	}

	_ = os.WriteFile(filepath.Join(sessionDir, "prompt.md"), []byte(promptMD), 0644)

	res := map[string]interface{}{
		"sessionId":  ts,
		"sessionDir": sessionDir,
		"promptMd":   promptMD,
		"count":      len(savedItems),
	}

	CheckAndNotifyFeedbackWaiters(res)

	return res, nil
}

func GetPendingFeedback(limit int, sessionID string, clear bool) (map[string]interface{}, error) {
	storageDir := GetFeedbackStorageDir()
	entries, err := os.ReadDir(storageDir)
	if err != nil {
		return map[string]interface{}{
			"success":       true,
			"sessionsCount": 0,
			"sessions":      []interface{}{},
			"feedbackDir":   storageDir,
			"message":       "No pending feedback found",
		}, nil
	}

	var dirNames []string
	for _, e := range entries {
		if e.IsDir() {
			dirNames = append(dirNames, e.Name())
		}
	}

	sort.Slice(dirNames, func(i, j int) bool {
		numI, _ := strconv.ParseInt(dirNames[i], 10, 64)
		numJ, _ := strconv.ParseInt(dirNames[j], 10, 64)
		return numI > numJ
	})

	if limit <= 0 {
		limit = 10
	}

	var targetIDs []string
	for _, id := range dirNames {
		if sessionID != "" && id != sessionID {
			continue
		}
		targetIDs = append(targetIDs, id)
		if len(targetIDs) >= limit {
			break
		}
	}

	sessions := make([]map[string]interface{}, 0)
	archiveDir := filepath.Join(filepath.Dir(storageDir), "feedback_archive")

	for _, id := range targetIDs {
		sDir := filepath.Join(storageDir, id)
		metaBytes, _ := os.ReadFile(filepath.Join(sDir, "session.json"))
		promptBytes, _ := os.ReadFile(filepath.Join(sDir, "prompt.md"))

		var meta map[string]interface{}
		_ = json.Unmarshal(metaBytes, &meta)
		if meta == nil {
			meta = make(map[string]interface{})
		}

		meta["sessionId"] = id
		meta["sessionDir"] = sDir
		meta["prompt"] = string(promptBytes)

		sessions = append(sessions, meta)

		if clear {
			_ = os.MkdirAll(archiveDir, 0755)
			_ = os.Rename(sDir, filepath.Join(archiveDir, id))
		}
	}

	return map[string]interface{}{
		"success":       true,
		"sessionsCount": len(sessions),
		"sessions":      sessions,
		"feedbackDir":   storageDir,
	}, nil
}

func WaitForFeedbackWithContext(ctx context.Context, timeoutSec int, tabID interface{}) map[string]interface{} {
	if timeoutSec <= 0 {
		timeoutSec = 120
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
