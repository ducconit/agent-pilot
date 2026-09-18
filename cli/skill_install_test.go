package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEmbeddedSkillAssetsPresent(t *testing.T) {
	if len(embeddedSkillFilesBase64) == 0 {
		t.Fatal("no embedded skill files; run npm run sync:skills")
	}
	if _, ok := embeddedSkillFilesBase64["SKILL.md"]; !ok {
		t.Error("embedded skill assets should contain SKILL.md")
	}
	if _, ok := embeddedSkillFilesBase64["references/cli-usage.md"]; !ok {
		t.Error("embedded skill assets should contain references/cli-usage.md")
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
	if count != len(embeddedSkillFilesBase64) {
		t.Errorf("expected %d files, got %d", len(embeddedSkillFilesBase64), count)
	}
	if _, err := os.Stat(filepath.Join(target, "SKILL.md")); err != nil {
		t.Errorf("SKILL.md not installed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(target, "references", "setup.md")); err != nil {
		t.Errorf("references/setup.md not installed: %v", err)
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
