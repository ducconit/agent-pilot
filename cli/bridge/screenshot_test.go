package bridge

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	validPNGDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)

func TestDecodeImageDataURL(t *testing.T) {
	t.Run("ValidPNG", func(t *testing.T) {
		b, ext, err := DecodeImageDataURL(validPNGDataURL)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ext != "png" || len(b) == 0 {
			t.Fatalf("expected png bytes, got ext=%q len=%d", ext, len(b))
		}
	})

	t.Run("ValidJPEGAndWebPMagicBytes", func(t *testing.T) {
		jpegB64 := base64.StdEncoding.EncodeToString([]byte("\xff\xd8\xff\xe0\x00\x10JFIF"))
		_, ext, err := DecodeImageDataURL("data:image/jpeg;base64," + jpegB64)
		if err != nil || ext != "jpg" {
			t.Fatalf("expected valid jpg decode, got ext=%q err=%v", ext, err)
		}

		webpB64 := base64.StdEncoding.EncodeToString([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "))
		_, ext, err = DecodeImageDataURL("data:image/webp;base64," + webpB64)
		if err != nil || ext != "webp" {
			t.Fatalf("expected valid webp decode, got ext=%q err=%v", ext, err)
		}
	})

	t.Run("RejectsNonImagePrefix", func(t *testing.T) {
		htmlB64 := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\n<script>alert(1)</script>"))
		_, _, err := DecodeImageDataURL("data:text/html;base64," + htmlB64)
		if err == nil || !strings.Contains(err.Error(), "expected data:image/ prefix") {
			t.Fatalf("expected non-image prefix rejection, got %v", err)
		}
	})

	t.Run("RejectsInvalidMagicBytes", func(t *testing.T) {
		nonImageB64 := base64.StdEncoding.EncodeToString([]byte("not an image payload"))
		_, _, err := DecodeImageDataURL("data:image/png;base64," + nonImageB64)
		if err == nil || !strings.Contains(err.Error(), "magic bytes") {
			t.Fatalf("expected magic bytes rejection, got %v", err)
		}
	})
}

func TestValidateScreenshotOutputPath(t *testing.T) {
	if _, err := ValidateScreenshotOutputPath("shot.sh"); err == nil {
		t.Fatalf("expected unsupported extension error")
	}
	for _, bad := range []string{
		"/etc/malicious.png",
		"/bin/evil.png",
		"/usr/local/bin/evil.png",
		"../../../../etc/cron.d/pwn.png",
		".ssh/authorized_keys.png",
		"/home/user/.bashrc/evil.png",
	} {
		if _, err := ValidateScreenshotOutputPath(bad); err == nil {
			t.Errorf("expected path %q to be rejected", bad)
		}
	}

	clean, err := ValidateScreenshotOutputPath("sub/valid_shot.webp")
	if err != nil || clean != filepath.Clean("sub/valid_shot.webp") {
		t.Fatalf("expected valid path to pass, got clean=%q err=%v", clean, err)
	}
}

func TestSaveScreenshotDataURLUsesDetectedExtensionAnd0600Perm(t *testing.T) {
	tmpDir := t.TempDir()
	prevWd, _ := os.Getwd()
	_ = os.Chdir(tmpDir)
	defer func() { _ = os.Chdir(prevWd) }()

	jpegB64 := base64.StdEncoding.EncodeToString([]byte("\xff\xd8\xff\xe0\x00\x10JFIF"))
	savedPath, n, err := SaveScreenshotDataURL("data:image/jpeg;base64,"+jpegB64, "")
	if err != nil {
		t.Fatalf("unexpected SaveScreenshotDataURL error: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(savedPath) })
	if !strings.HasSuffix(savedPath, ".jpg") || n <= 0 {
		t.Fatalf("expected default filename with .jpg extension, got %q (%d bytes)", savedPath, n)
	}
	info, statErr := os.Stat(savedPath)
	if statErr != nil {
		t.Fatalf("failed to stat saved screenshot: %v", statErr)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Fatalf("expected 0600 file permission, got %04o", perm)
	}
}
