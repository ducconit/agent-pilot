package skill

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"

	agentpilot "github.com/ducconit/agent-pilot"
)

const skillDirName = "agent-pilot"

// embeddedSkillsRoot is the directory inside the repository embed that holds
// the skills published to `npx skills add` (see embed.go at the module root).
const embeddedSkillsRoot = "skills"

// collectEmbeddedFiles walks the embedded skills tree and returns file contents
// keyed by skill-relative path (e.g. "SKILL.md", "references/setup.md").
func collectEmbeddedFiles() (map[string][]byte, error) {
	root := path.Join(embeddedSkillsRoot, skillDirName)
	files := make(map[string][]byte)
	err := fs.WalkDir(agentpilot.SkillFiles, root, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		data, readErr := agentpilot.SkillFiles.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		rel := strings.TrimPrefix(p, root+"/")
		files[rel] = data
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

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
	root := path.Join(embeddedSkillsRoot, skillDirName)
	count := 0
	err := fs.WalkDir(agentpilot.SkillFiles, root, func(_ string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !d.IsDir() {
			count++
		}
		return nil
	})
	if err != nil {
		return 0
	}
	return count
}

// copyRunningBinary keeps the installed skill self-contained. Release
// binaries are also the tool agents invoke; placing a copy next to the skill
// makes it usable when an IDE does not inherit the user's PATH. Go test
// executables are intentionally ignored by checking the release binary name.
func copyRunningBinary(target string) (bool, error) {
	executable, err := os.Executable()
	if err != nil {
		return false, nil
	}
	baseName := strings.ToLower(filepath.Base(executable))
	if baseName != "agent-pilot" && baseName != "agent-pilot.exe" {
		return false, nil
	}
	destinationName := "agent-pilot"
	if runtime.GOOS == "windows" {
		destinationName += ".exe"
	}
	destination := filepath.Join(target, "scripts", destinationName)
	if filepath.Clean(executable) == filepath.Clean(destination) {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return false, err
	}
	source, err := os.Open(executable)
	if err != nil {
		return false, err
	}
	defer source.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
	if err != nil {
		return false, err
	}
	_, copyErr := io.Copy(output, source)
	closeErr := output.Close()
	if copyErr != nil {
		return false, copyErr
	}
	if closeErr != nil {
		return false, closeErr
	}
	return true, nil
}

// InstallSkill writes the embedded skill into <root>/agent-pilot.
// Without force, an existing skill directory causes an error.
func InstallSkill(root string, force bool) (string, int, error) {
	if strings.TrimSpace(root) == "" {
		return "", 0, fmt.Errorf("thư mục cài đặt skill rỗng")
	}

	files, err := collectEmbeddedFiles()
	if err != nil {
		return "", 0, fmt.Errorf("không đọc được skill nhúng sẵn: %w", err)
	}
	if len(files) == 0 {
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
	for rel, data := range files {
		dest := filepath.Join(target, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return target, count, fmt.Errorf("không thể tạo thư mục %s: %w", filepath.Dir(dest), err)
		}
		if err := os.WriteFile(dest, data, 0644); err != nil {
			return target, count, fmt.Errorf("không thể ghi %s: %w", dest, err)
		}
		count++
	}
	if copied, err := copyRunningBinary(target); err != nil {
		return target, count, fmt.Errorf("không thể sao chép binary vào skill/scripts: %w", err)
	} else if copied {
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
