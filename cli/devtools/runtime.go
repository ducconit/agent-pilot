// Package devtools runs the private runtime embedded in release binaries.
// It never searches PATH for Node and never downloads code on a user's machine.
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
	pending   map[int64]chan response
	sequence  atomic.Int64
	extension ExtensionRequest
}

func NewHost(extension ExtensionRequest) *Host {
	return &Host{extension: extension, pending: make(map[int64]chan response)}
}

func unpackRuntime() (string, error) {
	archive, err := payload.ReadFile("payload/runtime.zip")
	if err != nil {
		return "", fmt.Errorf("this developer build has no embedded DevTools runtime; build with npm run build:cli (release binaries include it)")
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
	directory, err := unpackRuntime()
	if err != nil {
		return err
	}
	binary := "node"
	if runtime.GOOS == "windows" {
		binary = "node.exe"
	}
	cmd := exec.Command(filepath.Join(directory, binary), filepath.Join(directory, "devtools", "runner.mjs"))
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
	h.cmd, h.stdin = cmd, stdin
	go h.read(cmd, stdout)
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

func (h *Host) read(cmd *exec.Cmd, stdout io.Reader) {
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
		for id, channel := range h.pending {
			channel <- response{nil, err}
			delete(h.pending, id)
		}
	}
	h.mu.Unlock()
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
