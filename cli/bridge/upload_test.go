package bridge

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateUploadFilePath(t *testing.T) {
	forbidden := []string{
		"/etc/passwd",
		"/etc/shadow",
		"/etc/gshadow",
		"/home/user/.ssh/id_rsa",
		"/home/user/.aws/credentials",
		"/home/user/.git-credentials",
		"/home/user/.netrc",
		"/home/user/.npmrc",
		"/home/user/.bash_history",
		"/home/user/.config/gh/hosts.yml",
		"/home/user/.local/bin/agent-pilot",
		"/home/user/project/.env",
		"/home/user/project/.env.production",
		"/proc/self/environ",
		"/tmp/../../etc/passwd",
	}
	for _, p := range forbidden {
		if _, err := ValidateUploadFilePath(p); err == nil {
			t.Errorf("expected error for forbidden path %q, got nil", p)
		}
	}

	if _, err := ValidateUploadFilePath(""); err == nil {
		t.Error("expected error for empty path")
	}

	allowed := []string{
		"/tmp/sample-passport.jpg",
		"./testdata/document.pdf",
	}
	for _, p := range allowed {
		clean, err := ValidateUploadFilePath(p)
		if err != nil {
			t.Errorf("expected allowed path %q to succeed, got %v", p, err)
		}
		if !filepath.IsAbs(clean) {
			t.Errorf("expected cleaned path %q to be absolute", clean)
		}
	}
}

func TestEnrichUploadArgsRejectsSensitivePaths(t *testing.T) {
	directArgs := map[string]interface{}{
		"selector": "#file",
		"files":    []string{"/etc/passwd"},
	}
	if err := EnrichUploadArgs(directArgs); err == nil || !strings.Contains(err.Error(), "sensitive") {
		t.Fatalf("expected direct sensitive path to be rejected, got %v", err)
	}

	// Symlink bypass check: benign symlink path pointing to /etc/passwd
	tmpDir := t.TempDir()
	symlinkPath := filepath.Join(tmpDir, "innocent-avatar.png")
	if err := os.Symlink("/etc/passwd", symlinkPath); err == nil {
		symlinkArgs := map[string]interface{}{
			"selector": "#file",
			"files":    []string{symlinkPath},
		}
		if err := EnrichUploadArgs(symlinkArgs); err == nil || !strings.Contains(err.Error(), "sensitive") {
			t.Fatalf("expected symlink to /etc/passwd to be rejected, got %v", err)
		}
	}
}

func TestEnrichUploadArgsPreloadsFilePayloads(t *testing.T) {
	tmpDir := t.TempDir()
	imgPath := filepath.Join(tmpDir, "passport.jpg")
	sampleBytes := []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F'}
	if err := os.WriteFile(imgPath, sampleBytes, 0644); err != nil {
		t.Fatalf("failed to write temp image: %v", err)
	}

	args := map[string]interface{}{
		"selector": "#file-upload-1",
		"files":    []interface{}{imgPath},
	}
	if err := EnrichUploadArgs(args); err != nil {
		t.Fatalf("EnrichUploadArgs failed: %v", err)
	}

	payloads, ok := args["filePayloads"].([]map[string]interface{})
	if !ok || len(payloads) != 1 {
		t.Fatalf("expected 1 filePayload, got %#v", args["filePayloads"])
	}
	if payloads[0]["name"] != "passport.jpg" {
		t.Errorf("expected name passport.jpg, got %v", payloads[0]["name"])
	}
	if !strings.HasPrefix(payloads[0]["mimeType"].(string), "image/jpeg") {
		t.Errorf("expected image/jpeg mimeType, got %v", payloads[0]["mimeType"])
	}
	if payloads[0]["size"] != len(sampleBytes) {
		t.Errorf("expected size %d, got %v", len(sampleBytes), payloads[0]["size"])
	}
}

func TestEnrichUploadArgsRejectsDirectoryAndMissingSyntheticFile(t *testing.T) {
	tmpDir := t.TempDir()
	dirArgs := map[string]interface{}{
		"selector": "#file",
		"files":    []string{tmpDir},
	}
	if err := EnrichUploadArgs(dirArgs); err == nil {
		t.Error("expected directory upload to be rejected")
	}

	missingSynthetic := map[string]interface{}{
		"selector": "#file",
		"files":    []string{filepath.Join(tmpDir, "nonexistent.png")},
		"via":      "synthetic",
	}
	if err := EnrichUploadArgs(missingSynthetic); err == nil {
		t.Error("expected missing file with via=synthetic to return error")
	}
}

func TestEnrichBatchUploadArgs(t *testing.T) {
	tmpDir := t.TempDir()
	docPath := filepath.Join(tmpDir, "portrait.png")
	if err := os.WriteFile(docPath, []byte("PNGDATA"), 0644); err != nil {
		t.Fatalf("failed to write file: %v", err)
	}

	batchArgs := map[string]interface{}{
		"actions": []interface{}{
			map[string]interface{}{
				"action":   "upload",
				"selector": "#portrait",
				"files":    []interface{}{docPath},
			},
			map[string]interface{}{
				"action":   "upload",
				"selector": "#ssh",
				"files":    []interface{}{"/etc/shadow"},
			},
		},
	}

	err := EnrichBatchUploadArgs(batchArgs)
	if err == nil || !strings.Contains(err.Error(), "sensitive") {
		t.Fatalf("expected sensitive path error in batch upload, got %v", err)
	}

	// Fix second step and verify enrichment succeeds
	actions := batchArgs["actions"].([]interface{})
	actions[1].(map[string]interface{})["files"] = []interface{}{docPath}
	if err := EnrichBatchUploadArgs(batchArgs); err != nil {
		t.Fatalf("expected batch upload enrichment to succeed, got %v", err)
	}
	step0 := actions[0].(map[string]interface{})
	if _, ok := step0["filePayloads"]; !ok {
		t.Errorf("expected filePayloads on batch step 0, got %#v", step0)
	}
}

func TestProcessBatchScreenshots(t *testing.T) {
	tmpDir := t.TempDir()
	outPathFlat := filepath.Join(tmpDir, "step_1_flat.png")
	outPathNested := filepath.Join(tmpDir, "step_2_nested.png")
	tinyPNG := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

	res := map[string]interface{}{
		"completed": 2,
		"total":     2,
		"results": []interface{}{
			map[string]interface{}{
				"step":          1,
				"type":          "screenshot",
				"success":       true,
				"dataUrl":       tinyPNG,
				"requestedPath": outPathFlat,
				"includeBase64": false,
				"annotated":     true,
			},
			map[string]interface{}{
				"step":   2,
				"action": "screenshot",
				"ok":     true,
				"result": map[string]interface{}{
					"dataUrl":       tinyPNG,
					"requestedPath": outPathNested,
					"includeBase64": false,
				},
			},
		},
	}

	processed, err := ProcessBatchScreenshots(res)
	if err != nil {
		t.Fatalf("ProcessBatchScreenshots failed: %v", err)
	}
	resMap := processed.(map[string]interface{})
	step0 := resMap["results"].([]interface{})[0].(map[string]interface{})
	if _, hasDataURL := step0["dataUrl"]; hasDataURL {
		t.Error("expected dataUrl to be stripped from flat batch screenshot step")
	}
	if step0["path"] != outPathFlat {
		t.Errorf("expected path %q, got %v", outPathFlat, step0["path"])
	}
	if info, statErr := os.Stat(outPathFlat); statErr != nil || info.Size() == 0 {
		t.Errorf("expected screenshot file on disk at %q, err=%v", outPathFlat, statErr)
	}

	step1 := resMap["results"].([]interface{})[1].(map[string]interface{})
	stepRes := step1["result"].(map[string]interface{})
	if _, hasDataURL := stepRes["dataUrl"]; hasDataURL {
		t.Error("expected dataUrl to be stripped from nested batch screenshot result")
	}
	if stepRes["path"] != outPathNested {
		t.Errorf("expected path %q, got %v", outPathNested, stepRes["path"])
	}
}

func TestEnrichEvaluateArgsAndProcessResult(t *testing.T) {
	tmpDir := t.TempDir()
	srcFile := filepath.Join(tmpDir, "probe.js")
	if err := os.WriteFile(srcFile, []byte("() => ({ ok: true, count: 42 })"), 0644); err != nil {
		t.Fatalf("failed to write source js: %v", err)
	}
	outFile := filepath.Join(tmpDir, "eval_out.json")

	args := map[string]interface{}{
		"sourcePath": srcFile,
		"filePath":   outFile,
	}
	if err := EnrichEvaluateArgs(args); err != nil {
		t.Fatalf("EnrichEvaluateArgs failed: %v", err)
	}
	if args["script"] != "() => ({ ok: true, count: 42 })" {
		t.Errorf("expected script populated from sourcePath, got %v", args["script"])
	}

	// Reject sensitive sourcePath or filePath (including symlink to /etc)
	badSource := map[string]interface{}{"sourcePath": "/etc/passwd"}
	if err := EnrichEvaluateArgs(badSource); err == nil {
		t.Error("expected sensitive sourcePath /etc/passwd to be rejected")
	}
	badOut := map[string]interface{}{"script": "1+1", "filePath": "/etc/evil.json"}
	if err := EnrichEvaluateArgs(badOut); err == nil {
		t.Error("expected sensitive filePath /etc/evil.json to be rejected")
	}
	badDotfile := map[string]interface{}{"script": "1+1", "filePath": "/home/user/.bashrc"}
	if err := EnrichEvaluateArgs(badDotfile); err == nil {
		t.Error("expected sensitive dotfile /home/user/.bashrc to be rejected")
	}
	etcSymlink := filepath.Join(tmpDir, "etc_link")
	if err := os.Symlink("/etc", etcSymlink); err == nil {
		badSymlinkOut := map[string]interface{}{"script": "1+1", "filePath": filepath.Join(etcSymlink, "evil.json")}
		if err := EnrichEvaluateArgs(badSymlinkOut); err == nil {
			t.Error("expected symlinked /etc output path to be rejected")
		}
	}

	// Also verify "file" alias for sourcePath
	fileAliasArgs := map[string]interface{}{"file": srcFile}
	if err := EnrichEvaluateArgs(fileAliasArgs); err != nil {
		t.Fatalf("EnrichEvaluateArgs with file alias failed: %v", err)
	}
	if fileAliasArgs["script"] != "() => ({ ok: true, count: 42 })" {
		t.Errorf("expected script populated from file alias, got %v", fileAliasArgs["script"])
	}
	if _, hasFile := fileAliasArgs["file"]; hasFile {
		t.Error("expected 'file' key to be cleaned up after enrichment")
	}

	// ProcessEvaluateResult writes JSON to disk and returns metadata
	savedMeta, err := ProcessEvaluateResult(map[string]interface{}{"ok": true, "count": 42}, args)
	if err != nil {
		t.Fatalf("ProcessEvaluateResult failed: %v", err)
	}
	metaMap, ok := savedMeta.(map[string]interface{})
	if !ok || metaMap["saved"] != true {
		t.Fatalf("expected saved=true metadata, got %#v", savedMeta)
	}
	rawSaved, err := os.ReadFile(outFile)
	if err != nil {
		t.Fatalf("failed to read saved eval output: %v", err)
	}
	if !strings.Contains(string(rawSaved), `"count": 42`) {
		t.Errorf("unexpected saved eval output: %s", string(rawSaved))
	}
}

func TestValidateEvalOutputPathBlocksDotDirsBinariesAndOutsideWorkspace(t *testing.T) {
	blocked := []string{
		"/home/ubuntu/.local/bin/agent-pilot",
		"/home/ubuntu/.agk/bin/agent-pilot",
		"/home/ubuntu/.config/systemd/user/agent-pilot.service",
		"/home/ubuntu/other-project/output.json",
		".git/hooks/pre-commit",
		"./.env",
		"sub/.hidden/out.json",
		"out/malicious.sh",
		"out/malicious.exe",
		"out/malicious.service",
	}
	for _, p := range blocked {
		if _, err := ValidateEvalOutputPath(p); err == nil {
			t.Errorf("expected ValidateEvalOutputPath(%q) to be rejected, got nil", p)
		}
	}

	allowed := []string{
		"eval_result.json",
		"artifacts/output.txt",
		filepath.Join(t.TempDir(), "temp_eval.json"),
	}
	for _, p := range allowed {
		if _, err := ValidateEvalOutputPath(p); err != nil {
			t.Errorf("expected ValidateEvalOutputPath(%q) to succeed, got %v", p, err)
		}
	}
}
