package service

import (
	"fmt"
	"html"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/ducconit/agent-pilot-extension/cli/config"
)

// The service identifiers (config.ServerSubcommand, config.ServiceNameLinux, config.PlistNameDarwin,
// config.TaskNameWindows) are defined in config.go alongside the other shared constants.

// CommandRunner abstracts command execution for testability
type CommandRunner func(name string, args ...string) (string, error)

// FileWriter abstracts file writing for testability
type FileWriter func(name string, data []byte, perm os.FileMode) error

// FileRemover abstracts file deletion for testability
type FileRemover func(name string) error

// DirCreator abstracts directory creation for testability
type DirCreator func(path string, perm os.FileMode) error

// ServiceManager defines the lifecycle interface for background services
type ServiceManager interface {
	Install() error
	Uninstall() error
	Start() error
	Stop() error
	Restart() error
	Status() error
}

// Real system defaults
func defaultCommandRunner(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

var (
	systemCommandRunner CommandRunner = defaultCommandRunner
	systemFileWriter    FileWriter    = os.WriteFile
	systemFileRemover   FileRemover   = os.Remove
	systemDirCreator    DirCreator    = os.MkdirAll
)

// HandleServiceCommand dispatches service lifecycle actions
func HandleServiceCommand(args []string) error {
	action := "status"
	if len(args) > 0 {
		action = strings.ToLower(args[0])
	}

	switch action {
	case "install", "uninstall", "start", "stop", "restart", "status", "reload":
		// valid
	case "help", "-h", "--help":
		printServiceUsage()
		return nil
	default:
		printServiceUsage()
		return fmt.Errorf("unknown service action: %s", action)
	}

	execPath := getTargetBinaryPath()
	homeDir, err := os.UserHomeDir()
	if err != nil && (runtime.GOOS == "linux" || runtime.GOOS == "darwin") {
		return fmt.Errorf("cannot resolve user home directory: %w", err)
	}

	manager, err := NewServiceManager(
		runtime.GOOS,
		execPath,
		homeDir,
		systemCommandRunner,
		systemFileWriter,
		systemFileRemover,
		systemDirCreator,
	)
	if err != nil {
		return err
	}

	switch action {
	case "install":
		return manager.Install()
	case "uninstall":
		return manager.Uninstall()
	case "start":
		return manager.Start()
	case "stop":
		return manager.Stop()
	case "restart", "reload":
		return manager.Restart()
	case "status":
		return manager.Status()
	default:
		return fmt.Errorf("unhandled action: %s", action)
	}
}

func printServiceUsage() {
	fmt.Println(`Agent Pilot Background Service Manager
SỬ DỤNG:
  agent-pilot service <hành_động>

CÁC HÀNH ĐỘNG HỖ TRỢ:
  install       Cài đặt và kích hoạt service chạy ngầm tự khởi động cùng máy
  uninstall     Gỡ bỏ và vô hiệu hóa service chạy ngầm
  start         Khởi động service chạy ngầm
  stop          Dừng service chạy ngầm
  restart       Khởi động lại service chạy ngầm
  status        Kiểm tra trạng thái hoạt động của service
  reload        Nạp lại cấu hình service (đồng nghĩa restart)

HỖ TRỢ NỀN TẢNG:
  • Linux:   systemd --user service (~/.config/systemd/user/agent-pilot.service)
  • macOS:   launchd User Agent (~/Library/LaunchAgents/com.agentpilot.bridge.plist)
  • Windows: Task Scheduler background task (AgentPilotBridge)`)
}

func candidateBinaryPaths(goos, homeDir, localAppData string) []string {
	trimmedHome := strings.TrimSpace(homeDir)
	trimmedAppData := strings.TrimSpace(localAppData)

	switch goos {
	case "windows":
		var paths []string
		if trimmedAppData != "" {
			paths = append(paths, filepath.Join(trimmedAppData, "Programs", "agent-pilot", "agent-pilot.exe"))
		}
		if trimmedHome != "" {
			paths = append(
				paths,
				filepath.Join(trimmedHome, ".local", "bin", "agent-pilot.exe"),
				filepath.Join(trimmedHome, ".agk", "bin", "agent-pilot.exe"),
			)
		}
		return paths
	case "darwin":
		var paths []string
		if trimmedHome != "" {
			paths = append(
				paths,
				filepath.Join(trimmedHome, ".local", "bin", "agent-pilot"),
				filepath.Join(trimmedHome, ".agk", "bin", "agent-pilot"),
			)
		}
		paths = append(paths, "/opt/homebrew/bin/agent-pilot", "/usr/local/bin/agent-pilot")
		return paths
	default:
		var paths []string
		if trimmedHome != "" {
			paths = append(
				paths,
				filepath.Join(trimmedHome, ".local", "bin", "agent-pilot"),
				filepath.Join(trimmedHome, ".agk", "bin", "agent-pilot"),
			)
		}
		paths = append(paths, "/usr/local/bin/agent-pilot")
		return paths
	}
}

func resolveTargetBinaryPath(goos, homeDir, localAppData, fallbackExec string, isFile func(string) bool) string {
	for _, p := range candidateBinaryPaths(goos, homeDir, localAppData) {
		if isFile != nil && isFile(p) {
			return p
		}
	}
	if strings.TrimSpace(fallbackExec) != "" {
		return fallbackExec
	}
	if goos == "windows" {
		return "agent-pilot.exe"
	}
	return "agent-pilot"
}

func getTargetBinaryPath() string {
	home, _ := os.UserHomeDir()
	localAppData := os.Getenv("LOCALAPPDATA")

	var fallbackExec string
	if execPath, err := os.Executable(); err == nil {
		if realPath, symErr := filepath.EvalSymlinks(execPath); symErr == nil {
			fallbackExec = realPath
		} else {
			fallbackExec = execPath
		}
	}

	return resolveTargetBinaryPath(runtime.GOOS, home, localAppData, fallbackExec, func(p string) bool {
		info, err := os.Stat(p)
		return err == nil && !info.IsDir()
	})
}

// NewServiceManager constructs an OS-specific ServiceManager instance
func NewServiceManager(
	goos string,
	execPath string,
	homeDir string,
	runner CommandRunner,
	writer FileWriter,
	remover FileRemover,
	dirCreator DirCreator,
) (ServiceManager, error) {
	switch goos {
	case "linux":
		return &LinuxServiceManager{
			execPath:   execPath,
			homeDir:    homeDir,
			runCmd:     runner,
			writeFile:  writer,
			removeFile: remover,
			mkdirAll:   dirCreator,
		}, nil
	case "darwin":
		return &DarwinServiceManager{
			execPath:   execPath,
			homeDir:    homeDir,
			runCmd:     runner,
			writeFile:  writer,
			removeFile: remover,
			mkdirAll:   dirCreator,
		}, nil
	case "windows":
		return &WindowsServiceManager{
			execPath: execPath,
			runCmd:   runner,
		}, nil
	default:
		return nil, fmt.Errorf("background service management is not supported on %s", goos)
	}
}

// ---------------------------------------------------------------------------
// Linux: systemd --user service
// ---------------------------------------------------------------------------
type LinuxServiceManager struct {
	execPath   string
	homeDir    string
	runCmd     CommandRunner
	writeFile  FileWriter
	removeFile FileRemover
	mkdirAll   DirCreator
}

func (m *LinuxServiceManager) unitPath() string {
	return filepath.Join(m.homeDir, ".config", "systemd", "user", config.ServiceNameLinux)
}

func (m *LinuxServiceManager) Install() error {
	userSystemdDir := filepath.Join(m.homeDir, ".config", "systemd", "user")
	if err := m.mkdirAll(userSystemdDir, 0755); err != nil {
		return fmt.Errorf("failed to create systemd user directory: %w", err)
	}

	// Escape special characters and wrap path in quotes to handle paths with spaces safely
	escapedExec := strings.ReplaceAll(m.execPath, "\\", "\\\\")
	escapedExec = strings.ReplaceAll(escapedExec, "\"", "\\\"")
	escapedExec = strings.ReplaceAll(escapedExec, "%", "%%")
	unitContent := fmt.Sprintf(`[Unit]
Description=Agent Pilot Browser Control Bridge (User Mode)
Documentation=https://github.com/ducconit/agent-pilot-extension
After=network.target

[Service]
Type=simple
ExecStart="%s" %s
Restart=always
RestartSec=3s
LimitNOFILE=65536
KillMode=mixed
TimeoutStopSec=10s

[Install]
WantedBy=default.target
`, escapedExec, config.ServerSubcommand)

	serviceFilePath := m.unitPath()
	if err := m.writeFile(serviceFilePath, []byte(unitContent), 0644); err != nil {
		return fmt.Errorf("failed to write service unit file: %w", err)
	}

	reloadOut, reloadErr := m.runCmd("systemctl", "--user", "daemon-reload")
	if reloadErr != nil {
		return fmt.Errorf("failed to reload systemd daemon: %s (%w)", reloadOut, reloadErr)
	}

	out, err := m.runCmd("systemctl", "--user", "enable", "--now", config.ServiceNameLinux)
	if err != nil {
		return fmt.Errorf("failed to enable systemd service: %s (%w)", out, err)
	}

	fmt.Printf("✅ Đã cài đặt và kích hoạt thành công Agent Pilot Service (systemd --user)!\n")
	fmt.Printf("📁 Tệp cấu hình: %s\n", serviceFilePath)
	fmt.Printf("🚀 Lệnh thực thi: \"%s\" %s\n", escapedExec, config.ServerSubcommand)
	fmt.Printf("🌐 Cổng lắng nghe: http://127.0.0.1:%d (ws://127.0.0.1:%d)\n", config.DefaultBridgePort(), config.DefaultBridgePort())
	return nil
}

func (m *LinuxServiceManager) Uninstall() error {
	serviceFilePath := m.unitPath()

	stopOut, stopErr := m.runCmd("systemctl", "--user", "stop", config.ServiceNameLinux)
	if stopErr != nil {
		fmt.Fprintf(os.Stderr, "⚠️ Cảnh báo dừng service trước khi gỡ cài đặt: %s (%v)\n", stopOut, stopErr)
	}

	disOut, disErr := m.runCmd("systemctl", "--user", "disable", config.ServiceNameLinux)
	if disErr != nil {
		fmt.Fprintf(os.Stderr, "⚠️ Cảnh báo vô hiệu hóa service: %s (%v)\n", disOut, disErr)
	}

	if err := m.removeFile(serviceFilePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove service unit file: %w", err)
	}

	reloadOut, reloadErr := m.runCmd("systemctl", "--user", "daemon-reload")
	if reloadErr != nil {
		return fmt.Errorf("failed to reload systemd daemon after uninstall: %s (%w)", reloadOut, reloadErr)
	}

	fmt.Println("✅ Đã gỡ bỏ và vô hiệu hóa Agent Pilot Service thành công.")
	return nil
}

func (m *LinuxServiceManager) Start() error {
	out, err := m.runCmd("systemctl", "--user", "start", config.ServiceNameLinux)
	if err != nil {
		return fmt.Errorf("failed to start service: %s (%w)", out, err)
	}
	fmt.Println("✅ Agent Pilot Service đã khởi động.")
	return nil
}

func (m *LinuxServiceManager) Stop() error {
	out, err := m.runCmd("systemctl", "--user", "stop", config.ServiceNameLinux)
	if err != nil {
		return fmt.Errorf("failed to stop service: %s (%w)", out, err)
	}
	fmt.Println("✅ Agent Pilot Service đã dừng.")
	return nil
}

func (m *LinuxServiceManager) Restart() error {
	out, err := m.runCmd("systemctl", "--user", "restart", config.ServiceNameLinux)
	if err != nil {
		return fmt.Errorf("failed to restart service: %s (%w)", out, err)
	}
	fmt.Println("✅ Agent Pilot Service đã được khởi động lại.")
	return nil
}

func (m *LinuxServiceManager) Status() error {
	out, err := m.runCmd("systemctl", "--user", "status", config.ServiceNameLinux)
	if out != "" {
		fmt.Println(out)
	}
	if err != nil {
		return err
	}
	return nil
}

// ---------------------------------------------------------------------------
// macOS: launchd User Agent
// ---------------------------------------------------------------------------
type DarwinServiceManager struct {
	execPath   string
	homeDir    string
	runCmd     CommandRunner
	writeFile  FileWriter
	removeFile FileRemover
	mkdirAll   DirCreator
}

func (m *DarwinServiceManager) plistPath() string {
	return filepath.Join(m.homeDir, "Library", "LaunchAgents", config.PlistNameDarwin)
}

func (m *DarwinServiceManager) Install() error {
	launchAgentsDir := filepath.Join(m.homeDir, "Library", "LaunchAgents")
	if err := m.mkdirAll(launchAgentsDir, 0755); err != nil {
		return fmt.Errorf("failed to create LaunchAgents directory: %w", err)
	}
	logsDir := filepath.Join(m.homeDir, "Library", "Logs")
	if err := m.mkdirAll(logsDir, 0755); err != nil {
		return fmt.Errorf("failed to create Library/Logs directory: %w", err)
	}

	plistPath := m.plistPath()
	// Safely escape XML characters in executable and log paths
	escapedExec := html.EscapeString(m.execPath)
	escapedOutLog := html.EscapeString(filepath.Join(logsDir, "agent-pilot.log"))
	escapedErrLog := html.EscapeString(filepath.Join(logsDir, "agent-pilot.err"))
	plistContent := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agentpilot.bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
        <string>%s</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>%s</string>
    <key>StandardErrorPath</key>
    <string>%s</string>
</dict>
</plist>
`, escapedExec, config.ServerSubcommand, escapedOutLog, escapedErrLog)

	if err := m.writeFile(plistPath, []byte(plistContent), 0644); err != nil {
		return fmt.Errorf("failed to write launchd plist: %w", err)
	}

	// Attempt to unload previous instance if exists; log warning if unexpected error
	unloadOut, unloadErr := m.runCmd("launchctl", "unload", plistPath)
	if unloadErr != nil && !strings.Contains(unloadOut, "Could not find") {
		fmt.Fprintf(os.Stderr, "⚠️ Cảnh báo khi unload instance cũ: %s (%v)\n", unloadOut, unloadErr)
	}

	out, err := m.runCmd("launchctl", "load", "-w", plistPath)
	if err != nil {
		return fmt.Errorf("failed to load launchd service: %s (%w)", out, err)
	}

	fmt.Printf("✅ Đã cài đặt và kích hoạt thành công Agent Pilot LaunchAgent trên macOS!\n")
	fmt.Printf("📁 Tệp plist: %s\n", plistPath)
	fmt.Printf("🌐 Cổng lắng nghe: http://127.0.0.1:%d (ws://127.0.0.1:%d)\n", config.DefaultBridgePort(), config.DefaultBridgePort())
	return nil
}

func (m *DarwinServiceManager) Uninstall() error {
	plistPath := m.plistPath()

	unloadOut, unloadErr := m.runCmd("launchctl", "unload", plistPath)
	if unloadErr != nil {
		fmt.Fprintf(os.Stderr, "⚠️ Cảnh báo khi unload launchd agent: %s (%v)\n", unloadOut, unloadErr)
	}

	if err := m.removeFile(plistPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove launchd plist: %w", err)
	}

	fmt.Println("✅ Đã gỡ bỏ Agent Pilot LaunchAgent trên macOS thành công.")
	return nil
}

func (m *DarwinServiceManager) Start() error {
	out, err := m.runCmd("launchctl", "start", "com.agentpilot.bridge")
	if err != nil {
		return fmt.Errorf("failed to start launchd agent: %s (%w)", out, err)
	}
	fmt.Println("✅ Agent Pilot LaunchAgent đã khởi động.")
	return nil
}

func (m *DarwinServiceManager) Stop() error {
	out, err := m.runCmd("launchctl", "stop", "com.agentpilot.bridge")
	if err != nil {
		return fmt.Errorf("failed to stop launchd agent: %s (%w)", out, err)
	}
	fmt.Println("✅ Agent Pilot LaunchAgent đã dừng.")
	return nil
}

func (m *DarwinServiceManager) Restart() error {
	plistPath := m.plistPath()
	unloadOut, unloadErr := m.runCmd("launchctl", "unload", plistPath)
	if unloadErr != nil {
		fmt.Fprintf(os.Stderr, "⚠️ Cảnh báo khi unload agent lúc khởi động lại: %s (%v)\n", unloadOut, unloadErr)
	}

	out, err := m.runCmd("launchctl", "load", "-w", plistPath)
	if err != nil {
		return fmt.Errorf("failed to restart launchd agent: %s (%w)", out, err)
	}
	fmt.Println("✅ Agent Pilot LaunchAgent đã được khởi động lại.")
	return nil
}

func (m *DarwinServiceManager) Status() error {
	out, err := m.runCmd("launchctl", "list", "com.agentpilot.bridge")
	if out != "" {
		fmt.Println(out)
	}
	if err != nil {
		fmt.Println("⚠️ Dịch vụ chưa chạy hoặc chưa được nạp.")
		return err
	}
	return nil
}

// ---------------------------------------------------------------------------
// Windows: Task Scheduler Background Service
// ---------------------------------------------------------------------------
type WindowsServiceManager struct {
	execPath string
	runCmd   CommandRunner
}

func (m *WindowsServiceManager) Install() error {
	// Escape single quotes for PowerShell
	escapedExec := strings.ReplaceAll(m.execPath, "'", "''")
	psCmd := fmt.Sprintf(`$action = New-ScheduledTaskAction -Execute '%s' -Argument '%s'; $trigger = New-ScheduledTaskTrigger -AtLogOn; $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0; Register-ScheduledTask -TaskName '%s' -Action $action -Trigger $trigger -Settings $settings -Description 'Agent Pilot Universal AI Agent Browser Bridge' -Force; Start-ScheduledTask -TaskName '%s'`, escapedExec, config.ServerSubcommand, config.TaskNameWindows, config.TaskNameWindows)

	out, err := m.runCmd("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
	if err != nil {
		// Fallback to schtasks.exe if PowerShell cmdlet fails
		schOut, schErr := m.runCmd("schtasks", "/Create", "/TN", config.TaskNameWindows, "/TR", fmt.Sprintf("\"%s\" %s", m.execPath, config.ServerSubcommand), "/SC", "ONLOGON", "/F")
		if schErr != nil {
			return fmt.Errorf("failed to create scheduled task via PowerShell (%s) and schtasks (%s): %w", out, schOut, schErr)
		}

		runOut, runErr := m.runCmd("schtasks", "/Run", "/TN", config.TaskNameWindows)
		if runErr != nil {
			fmt.Fprintf(os.Stderr, "⚠️ Cảnh báo khi kích hoạt task qua schtasks: %s (%v)\n", runOut, runErr)
		}
	}

	fmt.Printf("✅ Đã cài đặt và kích hoạt thành công Agent Pilot Background Service trên Windows!\n")
	fmt.Printf("📌 Task Name: %s\n", config.TaskNameWindows)
	fmt.Printf("🌐 Cổng lắng nghe: http://127.0.0.1:%d (ws://127.0.0.1:%d)\n", config.DefaultBridgePort(), config.DefaultBridgePort())
	return nil
}

func (m *WindowsServiceManager) Uninstall() error {
	endOut, endErr := m.runCmd("schtasks", "/End", "/TN", config.TaskNameWindows)
	if endErr != nil {
		fmt.Fprintf(os.Stderr, "⚠️ Cảnh báo khi kết thúc task đang chạy: %s (%v)\n", endOut, endErr)
	}

	out, err := m.runCmd("schtasks", "/Delete", "/TN", config.TaskNameWindows, "/F")
	if err != nil {
		return fmt.Errorf("failed to delete task: %s (%w)", out, err)
	}
	fmt.Println("✅ Đã gỡ bỏ Agent Pilot Task Scheduler thành công.")
	return nil
}

func (m *WindowsServiceManager) Start() error {
	out, err := m.runCmd("schtasks", "/Run", "/TN", config.TaskNameWindows)
	if err != nil {
		return fmt.Errorf("failed to start task: %s (%w)", out, err)
	}
	fmt.Println("✅ Agent Pilot Task đã được kích hoạt chạy.")
	return nil
}

func (m *WindowsServiceManager) Stop() error {
	out, err := m.runCmd("schtasks", "/End", "/TN", config.TaskNameWindows)
	if err != nil {
		return fmt.Errorf("failed to stop task: %s (%w)", out, err)
	}
	fmt.Println("✅ Agent Pilot Task đã dừng.")
	return nil
}

func (m *WindowsServiceManager) Restart() error {
	endOut, endErr := m.runCmd("schtasks", "/End", "/TN", config.TaskNameWindows)
	if endErr != nil {
		fmt.Fprintf(os.Stderr, "⚠️ Cảnh báo khi dừng task trước restart: %s (%v)\n", endOut, endErr)
	}

	out, err := m.runCmd("schtasks", "/Run", "/TN", config.TaskNameWindows)
	if err != nil {
		return fmt.Errorf("failed to restart task: %s (%w)", out, err)
	}
	fmt.Println("✅ Agent Pilot Task đã được khởi động lại.")
	return nil
}

func (m *WindowsServiceManager) Status() error {
	out, err := m.runCmd("schtasks", "/Query", "/TN", config.TaskNameWindows, "/FO", "LIST", "/V")
	if out != "" {
		fmt.Println(out)
	}
	if err != nil {
		fmt.Println("⚠️ Task Scheduler chưa đăng ký hoặc chưa chạy.")
		return err
	}
	return nil
}
