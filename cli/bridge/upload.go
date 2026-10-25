// upload.go provides file path validation, synthetic upload payload pre-loading,
// and batch screenshot persistence helpers shared by the CLI and MCP server.

package bridge

import (
	"encoding/base64"
	"encoding/json"
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
	"/.ssh/", "/.aws/", "/.gnupg/", "/.kube/", "/.config/",
	"/.local/", "/.agk/", "/.git/", "/.docker/",
	"/etc/shadow", "/etc/passwd", "/etc/gshadow", "/proc/", "/sys/",
	".git-credentials", ".netrc", ".npmrc", ".pypirc",
	"_history", "id_rsa", "id_ed25519", "id_ecdsa", "authorized_keys",
}

var forbiddenEvalOutputExts = map[string]struct{}{
	".sh": {}, ".bash": {}, ".zsh": {}, ".exe": {}, ".bat": {},
	".cmd": {}, ".ps1": {}, ".service": {}, ".plist": {},
	".so": {}, ".dll": {}, ".dylib": {}, ".bin": {},
}

func containsForbiddenUploadSegment(slashPath string) bool {
	lower := strings.ToLower(slashPath)
	for _, sub := range forbiddenUploadSubstrings {
		if strings.Contains(lower, sub) {
			return true
		}
	}
	base := strings.ToLower(filepath.Base(slashPath))
	if base == ".env" || strings.HasPrefix(base, ".env.") {
		return true
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

func isBatchEvaluateAction(stepMap map[string]interface{}) bool {
	actType, _ := stepMap["action"].(string)
	if actType == "" {
		actType, _ = stepMap["type"].(string)
	}
	switch strings.ToLower(strings.TrimSpace(actType)) {
	case "evaluate", "eval", "page.evaluate":
		return true
	default:
		return false
	}
}

func isWithinAllowedEvalOutputRoot(targetAbs string) (bool, error) {
	var roots []string
	if cwd, err := os.Getwd(); err == nil && cwd != "" {
		roots = append(roots, filepath.Clean(cwd))
		if evalCwd, sErr := filepath.EvalSymlinks(cwd); sErr == nil && evalCwd != "" {
			roots = append(roots, filepath.Clean(evalCwd))
		}
	}
	for _, td := range []string{os.TempDir(), "/tmp", "/var/tmp", "/var/folders", "/private/tmp", "/private/var/folders"} {
		if td != "" {
			roots = append(roots, filepath.Clean(td))
			if evalTd, sErr := filepath.EvalSymlinks(td); sErr == nil && evalTd != "" {
				roots = append(roots, filepath.Clean(evalTd))
			}
		}
	}

	for _, root := range roots {
		rel, err := filepath.Rel(root, targetAbs)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || strings.HasPrefix(rel, "../") {
			continue
		}
		for _, seg := range strings.Split(filepath.ToSlash(rel), "/") {
			if strings.HasPrefix(seg, ".") && seg != "." {
				return false, fmt.Errorf("writing to hidden dotfile or dot-directory %q is not permitted", targetAbs)
			}
		}
		return true, nil
	}
	return false, nil
}

// ValidateEvalOutputPath validates a user/agent-supplied filePath for saving
// evaluation results against path traversal, executable files, and sensitive system/user files.
func ValidateEvalOutputPath(outputPath string) (string, error) {
	trimmed := strings.TrimSpace(outputPath)
	if trimmed == "" {
		return "", fmt.Errorf("evaluation output filePath cannot be empty")
	}
	cleanPath := filepath.Clean(trimmed)
	if cleanPath == ".." || strings.HasPrefix(cleanPath, ".."+string(filepath.Separator)) || strings.HasPrefix(cleanPath, "../") {
		return "", fmt.Errorf("path traversal outside working directory %q is not permitted", cleanPath)
	}
	if ext := strings.ToLower(filepath.Ext(cleanPath)); ext != "" {
		if _, forbiddenExt := forbiddenEvalOutputExts[ext]; forbiddenExt {
			return "", fmt.Errorf("writing executable or system file extension %q is not permitted", ext)
		}
	}

	checkTargets := []string{cleanPath}
	absPath, absErr := filepath.Abs(cleanPath)
	if absErr == nil {
		checkTargets = append(checkTargets, absPath)
	}
	if evalPath, err := filepath.EvalSymlinks(cleanPath); err == nil {
		checkTargets = append(checkTargets, evalPath)
	} else if evalParent, pErr := filepath.EvalSymlinks(filepath.Dir(cleanPath)); pErr == nil {
		checkTargets = append(checkTargets, filepath.Join(evalParent, filepath.Base(cleanPath)))
	}
	for _, target := range checkTargets {
		isTempPath := strings.HasPrefix(target, "/var/folders/") || strings.HasPrefix(target, "/var/tmp/")
		for _, forbidden := range forbiddenSystemPrefixes {
			if forbidden == "/var" && isTempPath {
				continue
			}
			if target == forbidden || strings.HasPrefix(target, forbidden+"/") {
				return "", fmt.Errorf("writing to sensitive system path %q is not permitted", cleanPath)
			}
		}
		if strings.Contains(target, ".ssh") || strings.Contains(target, "authorized_keys") ||
			strings.Contains(target, ".bashrc") || strings.Contains(target, ".zshrc") ||
			strings.Contains(target, ".profile") || containsForbiddenUploadSegment(filepath.ToSlash(target)) {
			return "", fmt.Errorf("writing to sensitive user configuration %q is not permitted", cleanPath)
		}
		if filepath.IsAbs(target) {
			allowed, dotErr := isWithinAllowedEvalOutputRoot(target)
			if dotErr != nil {
				return "", dotErr
			}
			if !allowed {
				return "", fmt.Errorf("writing outside working directory or temp directory %q is not permitted", cleanPath)
			}
		}
	}
	return cleanPath, nil
}

// EnrichEvaluateArgs validates optional sourcePath (or file alias, reading JS source
// from disk when expression/script/code is omitted) and validates optional filePath output path.
func EnrichEvaluateArgs(args map[string]interface{}) error {
	if args == nil {
		return nil
	}
	sourcePath, _ := args["sourcePath"].(string)
	if strings.TrimSpace(sourcePath) == "" {
		sourcePath, _ = args["file"].(string)
	}
	if strings.TrimSpace(sourcePath) != "" {
		cleanSource, err := ValidateUploadFilePath(sourcePath)
		if err != nil {
			return err
		}
		info, statErr := os.Stat(cleanSource)
		if statErr != nil {
			return fmt.Errorf("failed to stat evaluate sourcePath %q: %w", sourcePath, statErr)
		}
		if info.IsDir() {
			return fmt.Errorf("refusing to read directory %q as evaluate sourcePath: expected a regular file", sourcePath)
		}
		if info.Size() > MaxSyntheticUploadBytes {
			return fmt.Errorf("evaluate sourcePath %q (%d bytes) exceeds maximum script size (%d bytes)", sourcePath, info.Size(), MaxSyntheticUploadBytes)
		}
		data, readErr := os.ReadFile(cleanSource)
		if readErr != nil {
			return fmt.Errorf("failed to read evaluate sourcePath %q: %w", sourcePath, readErr)
		}
		expr, _ := args["expression"].(string)
		script, _ := args["script"].(string)
		code, _ := args["code"].(string)
		if strings.TrimSpace(expr) == "" && strings.TrimSpace(script) == "" && strings.TrimSpace(code) == "" {
			args["script"] = string(data)
			args["expression"] = string(data)
		}
		args["sourcePath"] = cleanSource
		delete(args, "file")
	}

	outPath, _ := args["filePath"].(string)
	if strings.TrimSpace(outPath) == "" {
		outPath, _ = args["savePath"].(string)
	}
	if strings.TrimSpace(outPath) != "" {
		cleanOut, err := ValidateEvalOutputPath(outPath)
		if err != nil {
			return err
		}
		args["filePath"] = cleanOut
	}
	return nil
}

// ProcessEvaluateResult writes the evaluation result to disk when args["filePath"]
// (or args["savePath"]) is non-empty, returning a compact metadata summary instead
// of flooding the caller context with large payloads.
func ProcessEvaluateResult(res interface{}, args map[string]interface{}) (interface{}, error) {
	if args == nil {
		return res, nil
	}
	outPath, _ := args["filePath"].(string)
	if strings.TrimSpace(outPath) == "" {
		outPath, _ = args["savePath"].(string)
	}
	if strings.TrimSpace(outPath) == "" {
		return res, nil
	}
	cleanOut, err := ValidateEvalOutputPath(outPath)
	if err != nil {
		return res, err
	}
	absOut, absErr := filepath.Abs(cleanOut)
	if absErr != nil {
		absOut = cleanOut
	}
	if dir := filepath.Dir(absOut); dir != "" && dir != "." {
		if mkErr := os.MkdirAll(dir, 0755); mkErr != nil {
			return res, fmt.Errorf("failed to create directory %s: %v", dir, mkErr)
		}
	}

	var payload []byte
	switch v := res.(type) {
	case string:
		payload = []byte(v)
	default:
		encoded, mErr := json.MarshalIndent(res, "", "  ")
		if mErr != nil {
			payload = []byte(fmt.Sprintf("%v", res))
		} else {
			payload = encoded
		}
	}

	if writeErr := os.WriteFile(absOut, payload, 0600); writeErr != nil {
		return res, fmt.Errorf("failed to write evaluation output to %s: %v", absOut, writeErr)
	}
	return map[string]interface{}{
		"saved":    true,
		"filePath": absOut,
		"bytes":    len(payload),
	}, nil
}

// EnrichBatchUploadArgs walks batch actions and enriches any upload/upload_file or evaluate/eval step.
func EnrichBatchUploadArgs(args map[string]interface{}) error {
	if args == nil {
		return nil
	}
	enrichStep := func(stepMap map[string]interface{}) error {
		if isBatchUploadAction(stepMap) {
			return EnrichUploadArgs(stepMap)
		}
		if isBatchEvaluateAction(stepMap) {
			return EnrichEvaluateArgs(stepMap)
		}
		return nil
	}
	if actionsIface, ok := args["actions"].([]interface{}); ok {
		for _, item := range actionsIface {
			stepMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			if err := enrichStep(stepMap); err != nil {
				return err
			}
		}
	} else if actionsSlice, ok := args["actions"].([]map[string]interface{}); ok {
		for _, stepMap := range actionsSlice {
			if err := enrichStep(stepMap); err != nil {
				return err
			}
		}
	}
	return nil
}

// ProcessBatchScreenshots inspects batch.run step results, saves any screenshot
// dataUrl to disk (using the step's requestedPath or an auto-generated file path),
// strips the raw Base64 dataUrl unless includeBase64 was requested, and persists
// any evaluate step result that requested a filePath.
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
		if evalOutPath, _ := stepMap["requestedEvalFilePath"].(string); strings.TrimSpace(evalOutPath) != "" {
			delete(stepMap, "requestedEvalFilePath")
			savedMeta, evalErr := ProcessEvaluateResult(stepMap["value"], map[string]interface{}{"filePath": evalOutPath})
			if evalErr != nil {
				return res, evalErr
			}
			if metaMap, ok := savedMeta.(map[string]interface{}); ok {
				stepMap["saved"] = metaMap["saved"]
				stepMap["filePath"] = metaMap["filePath"]
				stepMap["bytes"] = metaMap["bytes"]
				delete(stepMap, "value")
			}
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
