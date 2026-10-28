package devtools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFindCachedUnpackedRuntimeSelectsNewestReadyDir(t *testing.T) {
	cacheRoot := t.TempDir()
	runtimeParent := filepath.Join(cacheRoot, "agent-pilot", "runtime")

	olderDir := filepath.Join(runtimeParent, "aaaa1111")
	newerDir := filepath.Join(runtimeParent, "bbbb2222")
	incompleteDir := filepath.Join(runtimeParent, "cccc3333")

	for _, dir := range []string{olderDir, newerDir, incompleteDir} {
		if err := os.MkdirAll(filepath.Join(dir, "devtools"), 0700); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
		if err := os.WriteFile(filepath.Join(dir, runtimeNodeBinaryName()), []byte("node"), 0700); err != nil {
			t.Fatalf("write node: %v", err)
		}
		if err := os.WriteFile(filepath.Join(dir, "devtools", "runner.mjs"), []byte("export {}"), 0600); err != nil {
			t.Fatalf("write runner.mjs: %v", err)
		}
	}

	readyOld := filepath.Join(olderDir, ".ready")
	readyNew := filepath.Join(newerDir, ".ready")
	if err := os.WriteFile(readyOld, []byte("ok"), 0600); err != nil {
		t.Fatalf("write old .ready: %v", err)
	}
	if err := os.WriteFile(readyNew, []byte("ok"), 0600); err != nil {
		t.Fatalf("write new .ready: %v", err)
	}

	past := time.Now().Add(-10 * time.Minute)
	if err := os.Chtimes(readyOld, past, past); err != nil {
		t.Fatalf("chtimes old .ready: %v", err)
	}

	selected := findCachedUnpackedRuntime(cacheRoot)
	if selected != newerDir {
		t.Fatalf("expected newest cached runtime %q, got %q", newerDir, selected)
	}
}

func TestFindWorkspaceRuntimeFromSeedsWalksUpToCheckoutRoot(t *testing.T) {
	repoRoot := t.TempDir()
	if err := os.MkdirAll(filepath.Join(repoRoot, "devtools"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(repoRoot, "node_modules", "lighthouse"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(repoRoot, "cli", "cmd", "agent-pilot"), 0755); err != nil {
		t.Fatal(err)
	}
	runnerFile := filepath.Join(repoRoot, "devtools", "runner.mjs")
	if err := os.WriteFile(runnerFile, []byte("// runner"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, "node_modules", "lighthouse", "package.json"), []byte(`{"version":"13.5.0"}`), 0644); err != nil {
		t.Fatal(err)
	}

	nodeBin, resolvedRunner := findWorkspaceRuntimeFromSeeds("/usr/bin/node", []string{filepath.Join(repoRoot, "cli", "cmd", "agent-pilot")})
	if nodeBin != "/usr/bin/node" {
		t.Fatalf("expected nodeBin /usr/bin/node, got %q", nodeBin)
	}
	if resolvedRunner != runnerFile {
		t.Fatalf("expected runner %q, got %q", runnerFile, resolvedRunner)
	}
}

func TestUnpackRuntimeErrorIncludesVersionAndRemediation(t *testing.T) {
	_, err := unpackRuntime()
	if err == nil {
		// When runtime.zip is embedded during release/packaged builds, unpackRuntime succeeds.
		return
	}
	msg := err.Error()
	if !strings.Contains(msg, "npm ci && npm run build:cli") || !strings.Contains(msg, "agent-pilot service restart") {
		t.Fatalf("expected actionable build + restart guidance in error, got: %s", msg)
	}
}
