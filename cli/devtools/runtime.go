// Package devtools runs the private runtime embedded in release binaries, with
// graceful developer-build fallback to cached unpacked runtimes or a local
// source checkout.
package devtools

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ducconit/agent-pilot/cli/version"
)

//go:embed payload
var payload embed.FS

type ExtensionRequest func(string, map[string]interface{}) (interface{}, error)
type response struct {
	result interface{}
	err    error
}
type Host struct {
	mu        sync.Mutex
	writeMu   sync.Mutex
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	done      chan struct{}
	pending   map[int64]chan response
	sequence  atomic.Int64
	extension ExtensionRequest
}

func NewHost(extension ExtensionRequest) *Host {
	return &Host{extension: extension, pending: make(map[int64]chan response)}
}

func runtimeNodeBinaryName() string {
	if runtime.GOOS == "windows" {
		return "node.exe"
	}
	return "node"
}

func isValidUnpackedRuntimeDir(dir string) bool {
	if dir == "" {
		return false
	}
	if _, err := os.Stat(filepath.Join(dir, ".ready")); err != nil {
		return false
	}
	if _, err := os.Stat(filepath.Join(dir, runtimeNodeBinaryName())); err != nil {
		return false
	}
	if _, err := os.Stat(filepath.Join(dir, "devtools", "runner.mjs")); err != nil {
		return false
	}
	return true
}

func findCachedUnpackedRuntime(cacheRoot string) string {
	if strings.TrimSpace(cacheRoot) == "" {
		return ""
	}
	runtimeParent := filepath.Join(cacheRoot, "agent-pilot", "runtime")
	entries, err := os.ReadDir(runtimeParent)
	if err != nil {
		return ""
	}
	var bestDir string
	var bestMod time.Time
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		candidate := filepath.Join(runtimeParent, entry.Name())
		if !isValidUnpackedRuntimeDir(candidate) {
			continue
		}
		info, statErr := os.Stat(filepath.Join(candidate, ".ready"))
		if statErr != nil {
			continue
		}
		if bestDir == "" || info.ModTime().After(bestMod) {
			bestDir = candidate
			bestMod = info.ModTime()
		}
	}
	return bestDir
}

func isValidWorkspaceRuntimeRoot(dir string) bool {
	if dir == "" {
		return false
	}
	if _, err := os.Stat(filepath.Join(dir, "devtools", "runner.mjs")); err != nil {
		return false
	}
	if _, err := os.Stat(filepath.Join(dir, "node_modules", "lighthouse", "package.json")); err != nil {
		return false
	}
	return true
}

func resolveNodeExecutable() string {
	if envNode := strings.TrimSpace(os.Getenv("AGENT_PILOT_BUILD_NODE_BINARY")); envNode != "" {
		if info, err := os.Stat(envNode); err == nil && !info.IsDir() {
			return envNode
		}
	}
	if path, err := exec.LookPath(runtimeNodeBinaryName()); err == nil {
		return path
	}
	return ""
}

func findWorkspaceRuntimeFromSeeds(nodeBin string, seeds []string) (string, string) {
	if strings.TrimSpace(nodeBin) == "" {
		return "", ""
	}
	seen := make(map[string]bool)
	for _, seed := range seeds {
		if strings.TrimSpace(seed) == "" {
			continue
		}
		curr := filepath.Clean(seed)
		for i := 0; i < 6 && curr != "" && curr != "." && !seen[curr]; i++ {
			seen[curr] = true
			if isValidWorkspaceRuntimeRoot(curr) {
				return nodeBin, filepath.Join(curr, "devtools", "runner.mjs")
			}
			parent := filepath.Dir(curr)
			if parent == curr {
				break
			}
			curr = parent
		}
	}
	return "", ""
}

func findWorkspaceRuntime() (string, string) {
	nodeBin := resolveNodeExecutable()
	if nodeBin == "" {
		return "", ""
	}
	var seeds []string
	if envRoot := strings.TrimSpace(os.Getenv("AGENT_PILOT_ROOT")); envRoot != "" {
		seeds = append(seeds, envRoot)
	}
	if execPath, err := os.Executable(); err == nil {
		if realExec, symErr := filepath.EvalSymlinks(execPath); symErr == nil {
			seeds = append(seeds, filepath.Dir(realExec))
		}
		seeds = append(seeds, filepath.Dir(execPath))
	}
	if wd, err := os.Getwd(); err == nil {
		seeds = append(seeds, wd)
	}
	return findWorkspaceRuntimeFromSeeds(nodeBin, seeds)
}

func resolveRuntimeExec() (string, string, error) {
	directory, err := unpackRuntime()
	if err == nil {
		return filepath.Join(directory, runtimeNodeBinaryName()), filepath.Join(directory, "devtools", "runner.mjs"), nil
	}
	if cache, cacheErr := os.UserCacheDir(); cacheErr == nil {
		if cachedDir := findCachedUnpackedRuntime(cache); cachedDir != "" {
			return filepath.Join(cachedDir, runtimeNodeBinaryName()), filepath.Join(cachedDir, "devtools", "runner.mjs"), nil
		}
	}
	if nodeBin, runnerPath := findWorkspaceRuntime(); nodeBin != "" && runnerPath != "" {
		return nodeBin, runnerPath, nil
	}
	return "", "", err
}

func unpackRuntime() (string, error) {
	archive, err := payload.ReadFile("payload/runtime.zip")
	if err != nil {
		return "", fmt.Errorf("this developer build (%s) has no embedded DevTools runtime; build with 'npm ci && npm run build:cli' (and run 'agent-pilot service restart' if a background bridge server is active)", version.Full())
	}
	sum := sha256.Sum256(archive)
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	destination := filepath.Join(cache, "agent-pilot", "runtime", hex.EncodeToString(sum[:16]))
	if _, err := os.Stat(filepath.Join(destination, ".ready")); err == nil {
		return destination, nil
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(filepath.Dir(destination), ".extract-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return "", err
	}
	for _, entry := range reader.File {
		name := filepath.FromSlash(entry.Name)
		if !filepath.IsLocal(name) || entry.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("invalid runtime entry: %s", entry.Name)
		}
		target := filepath.Join(stage, name)
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0700); err != nil {
				return "", err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return "", err
		}
		input, err := entry.Open()
		if err != nil {
			return "", err
		}
		mode := os.FileMode(0600)
		if entry.Mode()&0111 != 0 {
			mode = 0700
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
		if err != nil {
			input.Close()
			return "", err
		}
		_, copyErr := io.Copy(output, input)
		input.Close()
		closeErr := output.Close()
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
	}
	if err := os.WriteFile(filepath.Join(stage, ".ready"), []byte("ok"), 0600); err != nil {
		return "", err
	}
	if err := os.Rename(stage, destination); err != nil {
		if _, statErr := os.Stat(filepath.Join(destination, ".ready")); statErr != nil {
			return "", err
		}
	}
	return destination, nil
}

func (h *Host) start() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cmd != nil {
		return nil
	}
	nodeBin, runnerPath, err := resolveRuntimeExec()
	if err != nil {
		return err
	}
	cmd := exec.Command(nodeBin, runnerPath)
	// Do not let a caller's Node preload options change our private runtime.
	for _, variable := range os.Environ() {
		if !strings.HasPrefix(variable, "NODE_OPTIONS=") && !strings.HasPrefix(variable, "NODE_PATH=") {
			cmd.Env = append(cmd.Env, variable)
		}
	}
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return err
	}
	if err := cmd.Start(); err != nil {
		stdin.Close()
		return err
	}
	done := make(chan struct{})
	h.cmd, h.stdin, h.done = cmd, stdin, done
	go h.read(cmd, stdout, done)
	return nil
}

func (h *Host) write(value interface{}) error {
	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	h.mu.Lock()
	input := h.stdin
	h.mu.Unlock()
	if input == nil {
		return fmt.Errorf("DevTools runtime is not running")
	}
	return json.NewEncoder(input).Encode(value)
}

func (h *Host) read(cmd *exec.Cmd, stdout io.Reader, done chan struct{}) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 65536), 64*1024*1024)
	for scanner.Scan() {
		var message struct {
			ID     int64                  `json:"id"`
			Kind   string                 `json:"kind"`
			Method string                 `json:"method"`
			Params map[string]interface{} `json:"params"`
			Result interface{}            `json:"result"`
			Error  string                 `json:"error"`
		}
		if json.Unmarshal(scanner.Bytes(), &message) != nil {
			continue
		}
		if message.Kind == "extensionRequest" {
			go func(id int64, method string, params map[string]interface{}) {
				result, err := h.extension(method, params)
				reply := map[string]interface{}{"kind": "extensionResponse", "id": id, "result": result}
				if err != nil {
					reply["error"] = err.Error()
				}
				_ = h.write(reply)
			}(message.ID, message.Method, message.Params)
			continue
		}
		h.mu.Lock()
		channel := h.pending[message.ID]
		delete(h.pending, message.ID)
		h.mu.Unlock()
		if channel != nil {
			var err error
			if message.Error != "" {
				err = fmt.Errorf("%s", message.Error)
			}
			channel <- response{message.Result, err}
		}
	}
	err := cmd.Wait()
	if err == nil {
		err = fmt.Errorf("DevTools runtime closed")
	}
	h.mu.Lock()
	if h.cmd == cmd {
		h.cmd, h.stdin = nil, nil
		h.done = nil
		for id, channel := range h.pending {
			channel <- response{nil, err}
			delete(h.pending, id)
		}
	}
	h.mu.Unlock()
	close(done)
}

// abort stops a wedged private runtime and waits until its reader has released
// all pending calls. Without this, a timed-out Lighthouse command leaves the
// line-oriented runner alive with a serialized queue, so later AX/DevTools
// calls appear to hang even though Chrome itself is healthy.
func (h *Host) abort() {
	h.mu.Lock()
	cmd, input, done := h.cmd, h.stdin, h.done
	h.mu.Unlock()
	if input != nil {
		_ = input.Close()
	}
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	if done != nil {
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
	}
}

func (h *Host) Call(method string, params map[string]interface{}, timeout time.Duration) (interface{}, error) {
	if err := h.start(); err != nil {
		return nil, err
	}
	id := h.sequence.Add(1)
	channel := make(chan response, 1)
	h.mu.Lock()
	h.pending[id] = channel
	h.mu.Unlock()
	defer func() { h.mu.Lock(); delete(h.pending, id); h.mu.Unlock() }()
	if err := h.write(map[string]interface{}{"id": id, "method": method, "params": params}); err != nil {
		return nil, err
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case result := <-channel:
		return result.result, result.err
	case <-timer.C:
		h.abort()
		return nil, fmt.Errorf("DevTools command timed out: %s", method)
	}
}

func (h *Host) Event(message map[string]interface{}) {
	h.mu.Lock()
	running := h.cmd != nil
	h.mu.Unlock()
	if running {
		_ = h.write(map[string]interface{}{"kind": "extensionEvent", "event": message})
	}
}

func (h *Host) Close() {
	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	h.mu.Lock()
	input := h.stdin
	h.mu.Unlock()
	if input != nil {
		_ = input.Close()
	}
}
