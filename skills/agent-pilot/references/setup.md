# Agent Pilot - Setup, Installation & Configuration Guide

This reference guide provides end-to-end instructions for installing, configuring, and verifying the Agent Pilot browser control ecosystem across all operating systems.

---

## 1. Quick Installation Overview

Agent Pilot consists of two core components:
1. **Chrome Extension (Manifest V3)**: Injected into the browser to control DOM, mouse cursor, screenshots, and DevTools via CDP.
2. **Standalone Go CLI & MCP Server (`agent-pilot`)**: High-performance local bridge running as a user background service on port `58765`.

---

## 2. Chrome Extension Installation

### Option A: From Release ZIP (Recommended)
1. Download the latest `agent-pilot-vX.X.X-beta.zip` from [GitHub Releases](https://github.com/ducconit/agent-pilot-extension/releases).
2. Unzip the file to a permanent directory (e.g., `~/agent-pilot-extension` or `C:\Users\<user>\agent-pilot-extension`).
3. Open Google Chrome, Brave, or Microsoft Edge and navigate to:
   - Chrome / Brave: `chrome://extensions`
   - Edge: `edge://extensions`
4. Toggle **Developer mode** (top-right corner).
5. Click **Load unpacked** (Tải tiện ích đã giải nén).
6. Select the unzipped folder (the folder containing `manifest.json`).
7. The Agent Pilot icon will appear in the extensions toolbar.

### Option B: Build & Pack from Source
```bash
git clone https://github.com/ducconit/agent-pilot-extension.git
cd agent-pilot-extension
npm install
npm run pack
# Output archive: dist/agent-pilot-vX.X.X-beta.zip
```

---

## 3. Standalone Go CLI & Background Service Setup

### Step 1: Install Binary
Download the pre-compiled binary for your operating system from GitHub Releases or build from source:

```bash
# Build from source
cd cli
CGO_ENABLED=0 go build -ldflags="-s -w" -o agent-pilot .
sudo cp agent-pilot /usr/local/bin/   # or copy to ~/.local/bin/
```

### Step 2: Install Persistent Background Service
Agent Pilot includes an OS-native service manager that requires **no root/administrator privileges**:

```bash
# Install and enable auto-start on boot
agent-pilot service install

# Check status (active, PID, memory, listening port)
agent-pilot service status

# Restart service after updates
agent-pilot service restart

# Uninstall service if no longer needed
agent-pilot service uninstall
```

#### OS Background Daemon Specifications:
- **Linux**: Managed via `systemd --user` (`~/.config/systemd/user/agent-pilot.service`).
- **macOS**: Managed via `launchd User Agent` (`~/Library/LaunchAgents/com.agentpilot.bridge.plist`).
- **Windows**: Managed via `Task Scheduler` (`AgentPilotBridge` run at user logon).

---

## 4. MCP (Model Context Protocol) Client Setup

To equip AI coding agents with the 16+ Agent Pilot browser tools over `stdio`, add the following snippet to your IDE's MCP configuration:

### Google Antigravity / AGK
Add to `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "agent-pilot",
      "args": ["mcp"]
    }
  }
}
```

### Claude Desktop
Add to `claude_desktop_config.json`:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "agent-pilot",
      "args": ["mcp"]
    }
  }
}
```

### Cursor IDE
In Cursor Settings -> Features -> MCP Servers -> Add New MCP Server:
- **Name**: `agent-pilot`
- **Type**: `command`
- **Command**: `agent-pilot mcp`

---

## 5. Troubleshooting & Diagnostics

### Issue 1: `WebSocket connection to 'ws://127.0.0.1:58765/' failed: ERR_CONNECTION_REFUSED`
* **Root Cause**: The Agent Pilot background bridge server is not running on port 58765.
* **Fix**:
  ```bash
  agent-pilot service install
  agent-pilot service start
  agent-pilot service status
  ```
  Verify port 58765 is active:
  ```bash
  curl http://127.0.0.1:58765/health
  # Expected: {"status":"ok","clients":1,"version":"1.0.7-beta"}
  ```

### Issue 2: Extension Shows "Mất kết nối Bridge" (Disconnected)
* **Fix**:
  1. Ensure `agent-pilot service status` shows `active (running)`.
  2. Open the Extension Side Panel in Chrome, navigate to the Monitor tab, and click **Kết nối lại**.
  3. Check console logs in `chrome://extensions` -> click "Inspect views: service worker" on Agent Pilot.

### Issue 3: Multi-Agent Port Collision (`EADDRINUSE`)
* **Behavior**: When running multiple agents concurrently (Antigravity, Codex, CLI), other tools crash trying to bind port 58765.
* **Resolution**: Agent Pilot has built-in **Dual Mode**:
  - The Master Bridge Service holds port 58765.
  - All subsequent CLI and MCP invocations detect the master service and forward commands over HTTP (`/api`) or stdio without binding 58765.
