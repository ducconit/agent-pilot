// screenshot.go provides shared base64 dataURL decoding, output-path security
// validation, and disk persistence used by the MCP server, CLI commands, and
// feedback session storage.

package bridge

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

var screenshotSeq int64

var forbiddenSystemPrefixes = []string{
	"/etc", "/proc", "/sys", "/dev", "/boot", "/root",
	"/bin", "/sbin", "/usr", "/lib", "/var",
}

func hasValidImageMagicBytes(b []byte) bool {
	if len(b) < 4 {
		return false
	}
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")) {
		return true
	}
	// JPEG: FF D8 FF
	if bytes.HasPrefix(b, []byte("\xff\xd8\xff")) {
		return true
	}
	// WebP: RIFF....WEBP
	if len(b) >= 12 && bytes.HasPrefix(b[0:4], []byte("RIFF")) && bytes.HasPrefix(b[8:12], []byte("WEBP")) {
		return true
	}
	// GIF: GIF87a / GIF89a
	if bytes.HasPrefix(b, []byte("GIF87a")) || bytes.HasPrefix(b, []byte("GIF89a")) {
		return true
	}
	return false
}

// DecodeImageDataURL splits a "data:image/<ext>;base64,<payload>" string,
// validates its MIME header and image magic bytes, and returns the decoded
// image bytes and detected extension.
func DecodeImageDataURL(dataURL string) ([]byte, string, error) {
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return nil, "", fmt.Errorf("invalid screenshot dataUrl format")
	}

	header := strings.ToLower(strings.TrimSpace(parts[0]))
	if !strings.HasPrefix(header, "data:image/") {
		return nil, "", fmt.Errorf("invalid screenshot dataUrl format: expected data:image/ prefix")
	}

	ext := "png"
	if strings.Contains(header, "jpeg") || strings.Contains(header, "jpg") {
		ext = "jpg"
	} else if strings.Contains(header, "webp") {
		ext = "webp"
	}

	imgBytes, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, "", fmt.Errorf("failed to decode base64 screenshot: %w", err)
	}
	if !hasValidImageMagicBytes(imgBytes) {
		return nil, "", fmt.Errorf("decoded screenshot payload does not contain valid image magic bytes")
	}
	return imgBytes, ext, nil
}

// ValidateScreenshotOutputPath cleans and validates a user/agent-supplied
// screenshot path against extension whitelist and sensitive system/user files.
func ValidateScreenshotOutputPath(outputPath string) (string, error) {
	cleanPath := filepath.Clean(outputPath)
	if cleanPath == ".." || strings.HasPrefix(cleanPath, ".."+string(filepath.Separator)) || strings.HasPrefix(cleanPath, "../") {
		return "", fmt.Errorf("path traversal outside working directory %q is not permitted", cleanPath)
	}
	ext := strings.ToLower(filepath.Ext(cleanPath))
	if ext != ".png" && ext != ".jpg" && ext != ".jpeg" && ext != ".webp" {
		return "", fmt.Errorf("unsupported screenshot file extension %q (allowed: .png, .jpg, .jpeg, .webp)", ext)
	}

	checkTargets := []string{cleanPath}
	if absPath, err := filepath.Abs(cleanPath); err == nil {
		checkTargets = append(checkTargets, absPath)
	}
	for _, target := range checkTargets {
		// Allow OS temp directories under /var/folders or /var/tmp when explicitly used by tests/system
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
			strings.Contains(target, ".profile") {
			return "", fmt.Errorf("writing to sensitive user configuration %q is not permitted", cleanPath)
		}
	}
	return cleanPath, nil
}

// SaveScreenshotDataURL decodes dataURL, validates outputPath (or generates a
// timestamped default using the detected extension when empty), ensures parent
// directories exist, and writes the image with 0600 permissions.
func SaveScreenshotDataURL(dataURL, outputPath string) (string, int, error) {
	if outputPath != "" {
		cleanPath, err := ValidateScreenshotOutputPath(outputPath)
		if err != nil {
			return "", 0, err
		}
		outputPath = cleanPath
	}

	imgBytes, ext, err := DecodeImageDataURL(dataURL)
	if err != nil {
		return "", 0, err
	}

	if outputPath == "" {
		seq := atomic.AddInt64(&screenshotSeq, 1)
		outputPath = filepath.Join(os.TempDir(), fmt.Sprintf("screenshot_%d_%d_%d.%s", time.Now().UnixMilli(), os.Getpid(), seq, ext))
	}

	if dir := filepath.Dir(outputPath); dir != "" && dir != "." {
		if mkErr := os.MkdirAll(dir, 0755); mkErr != nil {
			return "", 0, fmt.Errorf("failed to create directory %s: %v", dir, mkErr)
		}
	}

	if writeErr := os.WriteFile(outputPath, imgBytes, 0600); writeErr != nil {
		return "", 0, fmt.Errorf("failed to write screenshot to %s: %v", outputPath, writeErr)
	}

	return outputPath, len(imgBytes), nil
}
