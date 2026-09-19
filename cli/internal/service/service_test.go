package service

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func TestServiceHelpUsage(t *testing.T) {
	err := HandleServiceCommand([]string{"help"})
	if err != nil {
		t.Fatalf("expected nil error for help, got: %v", err)
	}

	err = HandleServiceCommand([]string{"--help"})
	if err != nil {
		t.Fatalf("expected nil error for --help, got: %v", err)
	}
}

func TestServiceInvalidAction(t *testing.T) {
	err := HandleServiceCommand([]string{"invalid_action_xyz"})
	if err == nil {
		t.Fatalf("expected error for invalid action, got nil")
	}
	if !strings.Contains(err.Error(), "unknown service action") {
		t.Errorf("expected error containing 'unknown service action', got: %v", err)
	}
}

func TestGetTargetBinaryPath(t *testing.T) {
	p := getTargetBinaryPath()
	if p == "" {
		t.Fatal("expected non-empty target binary path")
	}
}

func TestLinuxServiceManager_Install_EscapesSpacesAndQuotes(t *testing.T) {
	var executedCommands [][]string
	mockRunner := func(name string, args ...string) (string, error) {
		cmd := append([]string{name}, args...)
		executedCommands = append(executedCommands, cmd)
		return "ok", nil
	}

	var writtenFiles = make(map[string]string)
	mockWriter := func(name string, data []byte, perm os.FileMode) error {
		writtenFiles[name] = string(data)
		return nil
	}

	mockRemover := func(name string) error { return nil }
	mockDirCreator := func(path string, perm os.FileMode) error { return nil }

	// Path with spaces and double quotes
	testExecPath := `/opt/My "Special" Apps/agent-pilot`
	mgr, err := NewServiceManager("linux", testExecPath, "/home/testuser", mockRunner, mockWriter, mockRemover, mockDirCreator)
	if err != nil {
		t.Fatalf("unexpected error creating LinuxServiceManager: %v", err)
	}

	err = mgr.Install()
	if err != nil {
		t.Fatalf("unexpected error on Install: %v", err)
	}

	// Verify unit file content
	expectedUnitPath := "/home/testuser/.config/systemd/user/agent-pilot.service"
	content, ok := writtenFiles[expectedUnitPath]
	if !ok {
		t.Fatalf("expected unit file to be written at %s", expectedUnitPath)
	}

	// Verify ExecStart is safely quoted and double quotes escaped
	expectedExecLine := `ExecStart="/opt/My \"Special\" Apps/agent-pilot" server`
	if !strings.Contains(content, expectedExecLine) {
		t.Errorf("expected unit file to contain %q, got:\n%s", expectedExecLine, content)
	}

	// Verify commands were executed: daemon-reload, then enable --now
	if len(executedCommands) < 2 {
		t.Fatalf("expected at least 2 commands executed, got %d", len(executedCommands))
	}
	if executedCommands[0][0] != "systemctl" || executedCommands[0][2] != "daemon-reload" {
		t.Errorf("expected first command to be daemon-reload, got %v", executedCommands[0])
	}
	if executedCommands[1][0] != "systemctl" || executedCommands[1][2] != "enable" || executedCommands[1][3] != "--now" {
		t.Errorf("expected second command to be enable --now, got %v", executedCommands[1])
	}
}

func TestLinuxServiceManager_Uninstall_RunsAllCommands(t *testing.T) {
	var executedCommands [][]string
	mockRunner := func(name string, args ...string) (string, error) {
		cmd := append([]string{name}, args...)
		executedCommands = append(executedCommands, cmd)
		return "ok", nil
	}

	var removedFile string
	mockRemover := func(name string) error {
		removedFile = name
		return nil
	}

	mgr, err := NewServiceManager("linux", "/bin/agent-pilot", "/home/testuser", mockRunner, nil, mockRemover, nil)
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}

	err = mgr.Uninstall()
	if err != nil {
		t.Fatalf("unexpected error on Uninstall: %v", err)
	}

	expectedUnitPath := "/home/testuser/.config/systemd/user/agent-pilot.service"
	if removedFile != expectedUnitPath {
		t.Errorf("expected file %s to be removed, got: %s", expectedUnitPath, removedFile)
	}

	// Check that stop, disable, and daemon-reload were executed
	foundStop, foundDisable, foundReload := false, false, false
	for _, cmd := range executedCommands {
		if strings.Join(cmd, " ") == "systemctl --user stop agent-pilot.service" {
			foundStop = true
		}
		if strings.Join(cmd, " ") == "systemctl --user disable agent-pilot.service" {
			foundDisable = true
		}
		if strings.Join(cmd, " ") == "systemctl --user daemon-reload" {
			foundReload = true
		}
	}
	if !foundStop || !foundDisable || !foundReload {
		t.Errorf("expected stop, disable, reload commands, got: %v", executedCommands)
	}
}

func TestDarwinServiceManager_Install_XMLEscaping(t *testing.T) {
	var executedCommands [][]string
	mockRunner := func(name string, args ...string) (string, error) {
		cmd := append([]string{name}, args...)
		executedCommands = append(executedCommands, cmd)
		return "ok", nil
	}

	var writtenFiles = make(map[string]string)
	mockWriter := func(name string, data []byte, perm os.FileMode) error {
		writtenFiles[name] = string(data)
		return nil
	}

	mockRemover := func(name string) error { return nil }
	mockDirCreator := func(path string, perm os.FileMode) error { return nil }

	// Path with XML metacharacters like <, >, &
	testExecPath := `/Applications/Tools & More/<Custom>/agent-pilot`
	mgr, err := NewServiceManager("darwin", testExecPath, "/Users/testuser", mockRunner, mockWriter, mockRemover, mockDirCreator)
	if err != nil {
		t.Fatalf("unexpected error creating DarwinServiceManager: %v", err)
	}

	err = mgr.Install()
	if err != nil {
		t.Fatalf("unexpected error on Install: %v", err)
	}

	expectedPlistPath := "/Users/testuser/Library/LaunchAgents/com.agentpilot.bridge.plist"
	content, ok := writtenFiles[expectedPlistPath]
	if !ok {
		t.Fatalf("expected plist file to be written at %s", expectedPlistPath)
	}

	// Verify XML escaping: & -> &amp;, < -> &lt;, > -> &gt;
	expectedEscapedString := `<string>/Applications/Tools &amp; More/&lt;Custom&gt;/agent-pilot</string>`
	if !strings.Contains(content, expectedEscapedString) {
		t.Errorf("expected plist to contain escaped XML %q, got:\n%s", expectedEscapedString, content)
	}

	// Verify launchctl load -w command was called
	foundLoad := false
	for _, cmd := range executedCommands {
		if strings.Join(cmd, " ") == "launchctl load -w "+expectedPlistPath {
			foundLoad = true
		}
	}
	if !foundLoad {
		t.Errorf("expected launchctl load -w command, got: %v", executedCommands)
	}
}

func TestDarwinServiceManager_Uninstall(t *testing.T) {
	var executedCommands [][]string
	mockRunner := func(name string, args ...string) (string, error) {
		cmd := append([]string{name}, args...)
		executedCommands = append(executedCommands, cmd)
		return "ok", nil
	}

	var removedFile string
	mockRemover := func(name string) error {
		removedFile = name
		return nil
	}

	mgr, err := NewServiceManager("darwin", "/usr/local/bin/agent-pilot", "/Users/testuser", mockRunner, nil, mockRemover, nil)
	if err != nil {
		t.Fatalf("unexpected error creating DarwinServiceManager: %v", err)
	}

	err = mgr.Uninstall()
	if err != nil {
		t.Fatalf("unexpected error on Uninstall: %v", err)
	}

	expectedPlistPath := "/Users/testuser/Library/LaunchAgents/com.agentpilot.bridge.plist"
	if removedFile != expectedPlistPath {
		t.Errorf("expected removed file to be %s, got %s", expectedPlistPath, removedFile)
	}
}

func TestWindowsServiceManager_Install_PowerShellSingleQuotes(t *testing.T) {
	var executedCommands [][]string
	mockRunner := func(name string, args ...string) (string, error) {
		cmd := append([]string{name}, args...)
		executedCommands = append(executedCommands, cmd)
		return "ok", nil
	}

	// Executable path with single quotes
	testExecPath := `C:\Users\John's Tools\agent-pilot.exe`
	mgr, err := NewServiceManager("windows", testExecPath, "", mockRunner, nil, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error creating WindowsServiceManager: %v", err)
	}

	err = mgr.Install()
	if err != nil {
		t.Fatalf("unexpected error on Install: %v", err)
	}

	if len(executedCommands) == 0 {
		t.Fatal("expected powershell command to be executed")
	}

	// Verify single quotes are doubled in PowerShell argument
	psScript := executedCommands[0][len(executedCommands[0])-1]
	expectedEscaped := `C:\Users\John''s Tools\agent-pilot.exe`
	if !strings.Contains(psScript, expectedEscaped) {
		t.Errorf("expected PowerShell command to contain escaped path %q, got: %s", expectedEscaped, psScript)
	}
}

func TestWindowsServiceManager_Install_FallbackToSchtasks(t *testing.T) {
	var executedCommands [][]string
	mockRunner := func(name string, args ...string) (string, error) {
		cmd := append([]string{name}, args...)
		executedCommands = append(executedCommands, cmd)
		if name == "powershell" {
			return "powershell execution failed", errors.New("restricted execution policy")
		}
		return "SUCCESS", nil
	}

	testExecPath := `C:\Tools\agent-pilot.exe`
	mgr, err := NewServiceManager("windows", testExecPath, "", mockRunner, nil, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	err = mgr.Install()
	if err != nil {
		t.Fatalf("unexpected error on Install fallback: %v", err)
	}

	// Check that schtasks fallback was executed
	foundSchtasks := false
	for _, cmd := range executedCommands {
		if cmd[0] == "schtasks" && cmd[1] == "/Create" {
			foundSchtasks = true
			expectedTR := `"C:\Tools\agent-pilot.exe" server`
			if cmd[5] != expectedTR {
				t.Errorf("expected /TR to be %s, got %s", expectedTR, cmd[5])
			}
		}
	}
	if !foundSchtasks {
		t.Errorf("expected schtasks /Create fallback, got commands: %v", executedCommands)
	}
}

func TestWindowsServiceManager_Uninstall(t *testing.T) {
	var executedCommands [][]string
	mockRunner := func(name string, args ...string) (string, error) {
		cmd := append([]string{name}, args...)
		executedCommands = append(executedCommands, cmd)
		return "SUCCESS", nil
	}

	mgr, err := NewServiceManager("windows", `C:\Tools\agent-pilot.exe`, "", mockRunner, nil, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	err = mgr.Uninstall()
	if err != nil {
		t.Fatalf("unexpected error on Uninstall: %v", err)
	}

	foundDelete := false
	for _, cmd := range executedCommands {
		if cmd[0] == "schtasks" && cmd[1] == "/Delete" {
			foundDelete = true
		}
	}
	if !foundDelete {
		t.Errorf("expected schtasks /Delete command, got: %v", executedCommands)
	}
}

func TestLinuxServiceManager_ErrorPropagation(t *testing.T) {
	// If daemon-reload fails, Install must NOT swallow the error
	mockRunner := func(name string, args ...string) (string, error) {
		if len(args) > 1 && args[1] == "daemon-reload" {
			return "permission denied", errors.New("exit status 1")
		}
		return "ok", nil
	}
	mockWriter := func(name string, data []byte, perm os.FileMode) error { return nil }
	mockDirCreator := func(path string, perm os.FileMode) error { return nil }

	mgr, _ := NewServiceManager("linux", "/bin/agent-pilot", "/home/test", mockRunner, mockWriter, nil, mockDirCreator)
	err := mgr.Install()
	if err == nil {
		t.Fatal("expected error on daemon-reload failure, got nil")
	}
	if !strings.Contains(err.Error(), "failed to reload systemd daemon") {
		t.Errorf("expected wrapped daemon-reload error, got: %v", err)
	}
}
