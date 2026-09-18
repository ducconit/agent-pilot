package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const skillDirName = "agent-pilot"

// DefaultSkillRoot returns ~/.agents/skills (default install root).
func DefaultSkillRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory: %w", err)
	}
	return filepath.Join(home, ".agents", "skills"), nil
}

// AntigravitySkillRoot returns ~/.gemini/config/skills (Antigravity skills root).
func AntigravitySkillRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory: %w", err)
	}
	return filepath.Join(home, ".gemini", "config", "skills"), nil
}

func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			if p == "~" {
				return home
			}
			return filepath.Join(home, p[2:])
		}
	}
	return p
}

// ResolveSkillRoot picks the install root: explicit --path wins, then --agy/--antigravity, then the default.
func ResolveSkillRoot(flagPath string, antigravity bool) (string, error) {
	if strings.TrimSpace(flagPath) != "" {
		return expandHome(strings.TrimSpace(flagPath)), nil
	}
	if antigravity {
		return AntigravitySkillRoot()
	}
	return DefaultSkillRoot()
}

// EmbeddedSkillFileCount returns the number of skill files embedded in this binary.
func EmbeddedSkillFileCount() int {
	return len(embeddedSkillFilesBase64)
}

// InstallSkill writes the embedded skill into <root>/agent-pilot.
// Without force, an existing skill directory causes an error.
func InstallSkill(root string, force bool) (string, int, error) {
	if strings.TrimSpace(root) == "" {
		return "", 0, fmt.Errorf("thư mục cài đặt skill rỗng")
	}
	if len(embeddedSkillFilesBase64) == 0 {
		return "", 0, fmt.Errorf("binary này không nhúng sẵn skill (hãy build lại bằng npm run build:cli)")
	}

	target := filepath.Join(root, skillDirName)
	if _, err := os.Stat(target); err == nil {
		if !force {
			return target, 0, fmt.Errorf("skill đã tồn tại tại %s (dùng --force để ghi đè)", target)
		}
		if err := os.RemoveAll(target); err != nil {
			return target, 0, fmt.Errorf("không thể xoá skill cũ tại %s: %w", target, err)
		}
	}

	count := 0
	for rel, b64 := range embeddedSkillFilesBase64 {
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return target, count, fmt.Errorf("dữ liệu skill lỗi (%s): %w", rel, err)
		}
		dest := filepath.Join(target, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return target, count, fmt.Errorf("không thể tạo thư mục %s: %w", filepath.Dir(dest), err)
		}
		if err := os.WriteFile(dest, data, 0644); err != nil {
			return target, count, fmt.Errorf("không thể ghi %s: %w", dest, err)
		}
		count++
	}

	return target, count, nil
}

// ExecSkillInstall resolves the install root and installs the embedded skill.
func ExecSkillInstall(flagPath string, antigravity, force bool) error {
	root, err := ResolveSkillRoot(flagPath, antigravity)
	if err != nil {
		return err
	}
	target, count, err := InstallSkill(root, force)
	if err != nil {
		return err
	}
	fmt.Printf("✅ Đã cài skill '%s' vào %s (%d tệp)\n", skillDirName, target, count)
	return nil
}
