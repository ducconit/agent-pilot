# Agent Pilot - Setup, Installation & Configuration Guide

This reference guide provides end-to-end instructions for installing, configuring, and verifying the Agent Pilot browser control ecosystem across all operating systems.

---

## 1. Quick Installation Overview

Agent Pilot consists of two core components:
1. **Chrome Extension (Manifest V3)**: Injected into the browser to control DOM, mouse cursor, screenshots, and DevTools via CDP.
2. **Standalone Go CLI & MCP Server (`agent-pilot`)**: High-performance local bridge running as a user background service on port `58765`.

### 1.1 Agent Skills Installation

The `agent-pilot` skill (SKILL.md + references + examples) is embedded in the standalone binary. Install it without cloning the repo:

```bash
agent-pilot skill install                # ~/.agents/skills/agent-pilot (default)
agent-pilot skill install --agy          # ~/.gemini/config/skills/agent-pilot (Antigravity)
agent-pilot skill install --path <dir>   # custom skills root
agent-pilot skill install --force        # overwrite if it already exists
```

Verify the installation:

```bash
ls ~/.agents/skills/agent-pilot/SKILL.md
```

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
# Build from source (run from the repository root)
go build -ldflags "-s -w -X github.com/ducconit/agent-pilot-extension/cli/version.Version=1.0.8-beta" -o cli/agent-pilot ./cli/cmd/agent-pilot
sudo cp cli/agent-pilot /usr/local/bin/   # or copy to ~/.local/bin/
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
  # Expected: {"status":"ok","name":"Agent Pilot Go Bridge Server","port":58765,"extensionConnected":true,"clientCount":1,"version":"1.0.8-beta","clients":[{"instanceId":"<id>","browser":"Chromium","os":"linux","isActive":true,"connectedAt":1789295000000}]}
  # NOTE: `clients` is an ARRAY of connected extension client objects (may be empty).
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

### Issue 4: `CDP_UNAVAILABLE` / CDP-required command fails
* **Root Cause**: The debugger cannot attach to the tab. Common causes:
  1. Chrome DevTools is already open on that tab (only one debugger client per tab).
  2. The `chrome.debugger` permission/policy is blocked (enterprise policy or restricted profile).
* **Diagnosis**:
  ```bash
  agent-pilot cdp status --tab <id>
  # 🟢 CDP attached (trusted input available)  → trusted CDP input works
  # 🔴 CDP NOT attached — <reason>             → fix the cause or use --via auto/synthetic
  ```
* **Fix / Workarounds**:
  1. Close DevTools on the target tab and retry.
  2. For `click`/`drag`, use `--via auto` (CDP first, automatic synthetic fallback) or the default synthetic mode for regular DOM pages.
  3. Commands that are inherently CDP-based (`upload`, `dialog`, `emulate`, `resize`, `network`, `trace`, `metrics`, `heap`, background-tab `screenshot`) cannot run without debugger access — use an unrestricted profile.
  4. Remember: synthetic input cannot cross cross-origin iframes or drive canvas/WebGL apps; on those targets CDP access is required.
