// upload.go provides file path validation, synthetic upload payload pre-loading,
// and batch screenshot persistence helpers shared by the CLI and MCP server.

package bridge

import (
	"encoding/base64"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// MaxSyntheticUploadBytes is the maximum file size (20 MiB) pre-loaded into
// memory for the MAIN-world DataTransfer synthetic upload fallback.
const MaxSyntheticUploadBytes = 20 * 1024 * 1024

var forbiddenUploadSubstrings = []string{
	"/.ssh/", "/.aws/", "/.gnupg/", "/.kube/", "/.config/gcloud/",
	"/etc/shadow", "/etc/passwd", "/etc/gshadow", "/proc/", "/sys/",
}

func containsForbiddenUploadSegment(slashPath string) bool {
	lower := strings.ToLower(slashPath)
	for _, sub := range forbiddenUploadSubstrings {
		if strings.Contains(lower, sub) {
			return true
		}
	}
	return false
}

// ValidateUploadFilePath blocks sensitive system or credential paths (including symlinks
// pointing to sensitive targets) from being uploaded, and returns the cleaned absolute path.
func ValidateUploadFilePath(p string) (string, error) {
	trimmed := strings.TrimSpace(p)
	if trimmed == "" {
		return "", fmt.Errorf("upload file path cannot be empty")
	}
	clean := filepath.Clean(trimmed)
	if abs, err := filepath.Abs(trimmed); err == nil {
		clean = abs
	}
	if containsForbiddenUploadSegment(filepath.ToSlash(clean)) {
		return "", fmt.Errorf("refusing to upload sensitive system/credential file %q", p)
	}
	if resolved, err := filepath.EvalSymlinks(clean); err == nil && resolved != "" {
		if containsForbiddenUploadSegment(filepath.ToSlash(resolved)) {
			return "", fmt.Errorf("refusing to upload sensitive system/credential file %q (symlink target %q)", p, resolved)
		}
	}
	return clean, nil
}

func extractFileList(args map[string]interface{}) []string {
	var rawFiles []string
	if filesSlice, ok := args["files"].([]string); ok {
		rawFiles = append(rawFiles, filesSlice...)
	} else if filesIface, ok := args["files"].([]interface{}); ok {
		for _, item := range filesIface {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				rawFiles = append(rawFiles, s)
			}
		}
	}
	if len(rawFiles) == 0 {
		for _, key := range []string{"filePath", "file", "path"} {
			if s, ok := args[key].(string); ok && strings.TrimSpace(s) != "" {
				rawFiles = append(rawFiles, s)
				break
			}
		}
	}
	return rawFiles
}

func detectFileMimeType(path string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != "" {
		if m := mime.TypeByExtension(ext); m != "" {
			if idx := strings.Index(m, ";"); idx != -1 {
				return strings.TrimSpace(m[:idx])
			}
			return m
		}
	}
	if len(data) > 0 {
		detected := http.DetectContentType(data)
		if idx := strings.Index(detected, ";"); idx != -1 {
			return strings.TrimSpace(detected[:idx])
		}
		return detected
	}
	return "application/octet-stream"
}

// EnrichUploadArgs validates upload file paths, normalizes existing files to absolute
// paths for CDP DOM.setFileInputFiles, and attaches pre-loaded filePayloads so the
// extension can fall back to synthetic DataTransfer upload when CDP cannot attach.
func EnrichUploadArgs(args map[string]interface{}) error {
	if args == nil {
		return nil
	}
	rawFiles := extractFileList(args)
	if len(rawFiles) == 0 {
		return nil
	}

	via, _ := args["via"].(string)
	via = strings.ToLower(strings.TrimSpace(via))

	resolvedFiles := make([]string, 0, len(rawFiles))
	payloads := make([]map[string]interface{}, 0, len(rawFiles))

	for _, f := range rawFiles {
		targetPath, err := ValidateUploadFilePath(f)
		if err != nil {
			return err
		}

		info, statErr := os.Stat(targetPath)
		if statErr != nil {
			if via == "synthetic" {
				return fmt.Errorf("failed to stat upload file %q: %w", f, statErr)
			}
			resolvedFiles = append(resolvedFiles, f)
			continue
		}
		if info.IsDir() {
			return fmt.Errorf("refusing to upload directory %q: expected a regular file", f)
		}

		resolvedFiles = append(resolvedFiles, targetPath)
		if info.Size() > MaxSyntheticUploadBytes {
			if via == "synthetic" {
				return fmt.Errorf("upload file %q (%d bytes) exceeds maximum synthetic upload size (%d bytes)", f, info.Size(), MaxSyntheticUploadBytes)
			}
			continue
		}

		data, readErr := os.ReadFile(targetPath)
		if readErr != nil {
			if via == "synthetic" {
				return fmt.Errorf("failed to read upload file %q: %w", f, readErr)
			}
			continue
		}

		payloads = append(payloads, map[string]interface{}{
			"name":     filepath.Base(targetPath),
			"path":     targetPath,
			"mimeType": detectFileMimeType(targetPath, data),
			"base64":   base64.StdEncoding.EncodeToString(data),
			"size":     len(data),
		})
	}

	args["files"] = resolvedFiles
	if len(payloads) > 0 {
		args["filePayloads"] = payloads
	}
	return nil
}

func isBatchUploadAction(stepMap map[string]interface{}) bool {
	actType, _ := stepMap["action"].(string)
	if actType == "" {
		actType, _ = stepMap["type"].(string)
	}
	switch strings.ToLower(strings.TrimSpace(actType)) {
	case "upload", "upload_file", "uploadfile", "page.uploadfile":
		return true
	default:
		return false
	}
}

// EnrichBatchUploadArgs walks batch actions and enriches any upload/upload_file step.
func EnrichBatchUploadArgs(args map[string]interface{}) error {
	if args == nil {
		return nil
	}
	if actionsIface, ok := args["actions"].([]interface{}); ok {
		for _, item := range actionsIface {
			stepMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			if isBatchUploadAction(stepMap) {
				if err := EnrichUploadArgs(stepMap); err != nil {
					return err
				}
			}
		}
	} else if actionsSlice, ok := args["actions"].([]map[string]interface{}); ok {
		for _, stepMap := range actionsSlice {
			if isBatchUploadAction(stepMap) {
				if err := EnrichUploadArgs(stepMap); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// ProcessBatchScreenshots inspects batch.run step results, saves any screenshot
// dataUrl to disk (using the step's requestedPath or an auto-generated file path),
// and strips the raw Base64 dataUrl unless includeBase64 was requested.
func ProcessBatchScreenshots(res interface{}) (interface{}, error) {
	resMap, ok := res.(map[string]interface{})
	if !ok {
		return res, nil
	}
	results, ok := resMap["results"].([]interface{})
	if !ok {
		return res, nil
	}

	for _, rawStep := range results {
		stepMap, ok := rawStep.(map[string]interface{})
		if !ok {
			continue
		}
		targetMap := stepMap
		dataURL, _ := targetMap["dataUrl"].(string)
		if dataURL == "" {
			if nested, ok := stepMap["result"].(map[string]interface{}); ok {
				if nestedURL, _ := nested["dataUrl"].(string); nestedURL != "" {
					targetMap = nested
					dataURL = nestedURL
				}
			}
		}
		if dataURL == "" {
			continue
		}

		requestedPath, _ := targetMap["requestedPath"].(string)
		if requestedPath == "" {
			requestedPath, _ = targetMap["path"].(string)
		}
		includeBase64, _ := targetMap["includeBase64"].(bool)

		delete(targetMap, "requestedPath")
		delete(targetMap, "includeBase64")

		if includeBase64 && requestedPath == "" {
			continue
		}

		savedPath, byteCount, err := SaveScreenshotDataURL(dataURL, requestedPath)
		if err != nil {
			return res, err
		}
		absPath, err := filepath.Abs(savedPath)
		if err != nil {
			absPath = savedPath
		}

		targetMap["path"] = absPath
		targetMap["bytes"] = byteCount
		if !includeBase64 {
			delete(targetMap, "dataUrl")
		}
	}

	return resMap, nil
}
