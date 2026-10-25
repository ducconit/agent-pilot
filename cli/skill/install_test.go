package skill

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// repoSkillsDir is the canonical source published to `npx skills add`; the
// embedded filesystem must always mirror it exactly.
const repoSkillsDir = "../../skills/agent-pilot"

func TestEmbeddedSkillAssetsPresent(t *testing.T) {
	files, err := collectEmbeddedFiles()
	if err != nil {
		t.Fatalf("cannot read embedded skill files: %v", err)
	}
	if len(files) == 0 {
		t.Fatal("no embedded skill files; build the CLI from the repository root")
	}
	if _, ok := files["SKILL.md"]; !ok {
		t.Error("embedded skill assets should contain SKILL.md")
	}
	if _, ok := files["references/cli-usage.md"]; !ok {
		t.Error("embedded skill assets should contain references/cli-usage.md")
	}
}

// TestEmbeddedSkillMatchesRepoSource is the single-source guarantee: editing
// skills/ and rebuilding changes the installed skill with no sync/regenerate
// step in between.
func TestEmbeddedSkillMatchesRepoSource(t *testing.T) {
	files, err := collectEmbeddedFiles()
	if err != nil {
		t.Fatalf("cannot read embedded skill files: %v", err)
	}

	for rel, data := range files {
		src, readErr := os.ReadFile(filepath.Join(repoSkillsDir, filepath.FromSlash(rel)))
		if readErr != nil {
			t.Errorf("embedded file %q is not present in %s: %v", rel, repoSkillsDir, readErr)
			continue
		}
		if !bytes.Equal(src, data) {
			t.Errorf("embedded %q differs from %s/%s — rebuild or check the embed directive", rel, repoSkillsDir, rel)
		}
	}

	repoCount := 0
	walkErr := filepath.WalkDir(repoSkillsDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			rel, relErr := filepath.Rel(repoSkillsDir, p)
			if relErr == nil {
				slashRel := filepath.ToSlash(rel)
				if slashRel == "scripts/agent-pilot" || slashRel == "scripts/agent-pilot.exe" {
					return nil
				}
			}
			repoCount++
		}
		return nil
	})
	if walkErr != nil {
		t.Fatalf("cannot walk %s: %v", repoSkillsDir, walkErr)
	}
	if repoCount != len(files) {
		t.Errorf("embedded file count %d != repository count %d", len(files), repoCount)
	}
}

func TestInstallSkillToTempRoot(t *testing.T) {
	root := t.TempDir()
	target, count, err := InstallSkill(root, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if target != filepath.Join(root, skillDirName) {
		t.Errorf("expected target %s, got %s", filepath.Join(root, skillDirName), target)
	}
	if count != EmbeddedSkillFileCount() {
		t.Errorf("expected %d files, got %d", EmbeddedSkillFileCount(), count)
	}
	if _, err := os.Stat(filepath.Join(target, "SKILL.md")); err != nil {
		t.Errorf("SKILL.md not installed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(target, "references", "setup.md")); err != nil {
		t.Errorf("references/setup.md not installed: %v", err)
	}

	// Installed content must equal the repository source byte-for-byte.
	installed, err := os.ReadFile(filepath.Join(target, "SKILL.md"))
	if err != nil {
		t.Fatalf("cannot read installed SKILL.md: %v", err)
	}
	source, err := os.ReadFile(filepath.Join(repoSkillsDir, "SKILL.md"))
	if err != nil {
		t.Fatalf("cannot read source SKILL.md: %v", err)
	}
	if !bytes.Equal(installed, source) {
		t.Error("installed SKILL.md differs from skills/agent-pilot/SKILL.md")
	}
}

func TestInstallSkillExistingWithoutForceFails(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, skillDirName), 0755); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if _, _, err := InstallSkill(root, false); err == nil {
		t.Fatal("expected error when skill already exists without --force")
	}
}

func TestInstallSkillForceOverwrites(t *testing.T) {
	root := t.TempDir()
	stale := filepath.Join(root, skillDirName, "stale.txt")
	if err := os.MkdirAll(filepath.Dir(stale), 0755); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	if err := os.WriteFile(stale, []byte("old"), 0644); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	if _, _, err := InstallSkill(root, true); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Error("stale file should be removed on --force")
	}
	if _, err := os.Stat(filepath.Join(root, skillDirName, "SKILL.md")); err != nil {
		t.Errorf("SKILL.md not installed after force: %v", err)
	}
}

func TestResolveSkillRoot(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory")
	}

	// 1. default -> ~/.agents/skills
	got, err := ResolveSkillRoot("", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != filepath.Join(home, ".agents", "skills") {
		t.Errorf("default root = %s", got)
	}

	// 2. antigravity -> ~/.gemini/config/skills
	got, err = ResolveSkillRoot("", true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != filepath.Join(home, ".gemini", "config", "skills") {
		t.Errorf("antigravity root = %s", got)
	}

	// 3. explicit path with ~ expansion
	got, err = ResolveSkillRoot("~/custom-skills", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != filepath.Join(home, "custom-skills") {
		t.Errorf("expanded path = %s", got)
	}

	// 4. explicit path wins over antigravity flag
	got, err = ResolveSkillRoot("/tmp/agent-pilot-skills", true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "/tmp/agent-pilot-skills" {
		t.Errorf("explicit path = %s", got)
	}
}
