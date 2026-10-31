# Agent Pilot - Setup, Installation & Configuration Guide

This reference guide provides end-to-end instructions for installing, configuring, and verifying the Agent Pilot browser control ecosystem across all operating systems.

---

## 1. Quick Installation Overview

Agent Pilot consists of two core components:
1. **Chrome Extension (Manifest V3)**: Injected into the browser to control DOM, mouse cursor, screenshots, and DevTools via CDP.
2. **Standalone Go CLI & MCP Server (`agent-pilot`)**: High-performance local bridge running as a user background service on the configured port (default `58765`).

### 1.1 Rapid AI Agent Installation (`npx skills add`)

For quick integration into AI assistants without manual archive downloads:

```bash
npx skills add https://github.com/ducconit/agent-pilot -g --all
```

> 💡 **Notice**: The `npx skills add` package includes native binaries for all 3 supported operating systems (Linux, macOS, and Windows) in `skills/agent-pilot/scripts/` to ensure immediate out-of-the-box compatibility on any host machine. For a trimmed single-binary installation with native system daemon configuration (`systemd`/`launchd`/Windows service), use the [OS-Specific Release Bundle](#2-os-specific-all-in-one-bundle-installation-recommended).

### 1.2 Standalone Skill CLI Installation

The `agent-pilot` skill (SKILL.md + references + examples) is also embedded in the standalone binary. If you already have the binary on your PATH, install it without cloning the repo:

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

## 2. OS-Specific All-in-One Bundle Installation (Recommended)

Each release provides 3 OS-specific bundles (`agent-pilot-v1.3.0-linux.zip`, `agent-pilot-v1.3.0-macos.zip`, `agent-pilot-v1.3.0-windows.zip`) containing:
- `extensions/` — Chrome/Brave/Edge Manifest V3 unpacked extension
- `skills/agent-pilot/scripts/agent-pilot` (`agent-pilot.exe` on Windows) — Pre-compiled standalone CLI & MCP server for that OS
- `install.sh` / `install.ps1` — 1-step automated installer
- `skills/agent-pilot/` — Embedded Agent Pilot skill bundle
- `README.md` — OS-tailored setup & troubleshooting guide

### Step 1: Run the 1-Step Installer (CLI + Background Service + Skill)
- **Ubuntu / Linux**:
  ```bash
  unzip agent-pilot-v1.3.0-linux.zip -d ~/agent-pilot
  cd ~/agent-pilot/agent-pilot-v1.3.0-linux && ./install.sh
  ```
- **macOS (Apple Silicon)**:
  ```bash
  unzip agent-pilot-v1.3.0-macos.zip -d ~/agent-pilot
  cd ~/agent-pilot/agent-pilot-v1.3.0-macos && ./install.sh
  ```
- **Windows (PowerShell)**:
  ```powershell
  Expand-Archive .\agent-pilot-v1.3.0-windows.zip -DestinationPath "$HOME\agent-pilot"
  cd "$HOME\agent-pilot\agent-pilot-v1.3.0-windows"
  powershell -ExecutionPolicy Bypass -File .\install.ps1
  ```

### Step 2: Load the Chrome Extension
1. Open Google Chrome, Brave, or Microsoft Edge and navigate to `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** (top-right corner).
3. Click **Load unpacked** (Tải tiện ích đã giải nén).
4. Select the `extensions/` folder inside your unzipped bundle.

### Alternative: Build & Pack from Source
```bash
git clone https://github.com/ducconit/agent-pilot.git
cd agent-pilot
npm install
npm run pack:bundle
# Outputs OS-specific bundles + universal archive in dist/
```

---

## 3. Standalone Go CLI & Background Service Setup

### Step 1: Install Binary Manually (if not using the 1-step installer)
Download the pre-compiled binary for your operating system from GitHub Releases or build from source:

```bash
# Build from source (run from the repository root)
npm run build:cli
sudo cp cli/agent-pilot /usr/local/bin/   # or copy to ~/.local/bin/
```

### Step 2: Install Persistent Background Service
Agent Pilot includes an OS-native service manager that requires **no root/administrator privileges** (it automatically copies the binary to a permanent per-OS location if invoked from a temporary folder):

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
- **Linux**: Binary at `~/.local/bin/agent-pilot`, managed via `systemd --user` (`~/.config/systemd/user/agent-pilot.service`).
- **macOS**: Binary at `~/.local/bin/agent-pilot`, managed via `launchd User Agent` (`~/Library/LaunchAgents/com.agentpilot.bridge.plist`).
- **Windows**: Binary at `%LOCALAPPDATA%\AgentPilot\bin\agent-pilot.exe`, managed via `Task Scheduler` (`AgentPilotBridge` run at user logon).

---

## 4. MCP (Model Context Protocol) Client Setup

To equip AI coding agents with the exported Agent Pilot browser tools over `stdio`, add the following snippet to your IDE's MCP configuration:

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

### Issue 1: `WebSocket connection to 'ws://127.0.0.1:<port>/' failed: ERR_CONNECTION_REFUSED`
* **Root Cause**: The Agent Pilot background bridge server is not running on the selected port.
* **Fix**:
  ```bash
  agent-pilot service install
  agent-pilot service start
  agent-pilot service status
  ```
  Verify the default port is active:
  ```bash
  curl http://127.0.0.1:58765/health
  # Verify status=ok, port=58765, extensionConnected=true, and clients[].bridgePort,
  # clients[].extensionVersion, clients[].extensionBuildId match the artifact under test.
  # NOTE: `clients` is an ARRAY of connected extension client objects (may be empty).
  ```

### Issue 2: Extension Shows "Mất kết nối Bridge" (Disconnected)
* **Fix**:
  1. Ensure `agent-pilot service status` shows `active (running)`.
  2. Open the Extension Side Panel in Chrome, navigate to the Monitor tab, and click **Kết nối lại**.
  3. Check console logs in `chrome://extensions` -> click "Inspect views: service worker" on Agent Pilot.

### Issue 3: Multi-Agent Port Collision (`EADDRINUSE`)
* **Behavior**: When running multiple agents concurrently (Antigravity, Codex, CLI), other tools crash trying to bind the same bridge port.
* **Resolution**: Agent Pilot has built-in **Dual Mode**:
  - The Master Bridge Service holds its configured port.
  - All subsequent CLI and MCP invocations detect the master service and forward commands over HTTP (`/api`) or stdio without binding the same port.

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

### Issue 5: Headless Linux / CI (`--load-extension is not allowed in Google Chrome`)
* **Root Cause**: Starting from Google Chrome Stable v137, consumer Chrome builds ignore the `--load-extension` CLI flag (`WARNING: ... --load-extension is not allowed in Google Chrome, ignoring.`).
* **Fix**:
  1. On headless Linux / CI-CD machines where you cannot manually click **Load unpacked** in `chrome://extensions`, use **Google Chrome for Testing** or **Chromium** (and set `CHROME_BIN=/path/to/chrome-for-testing` if not on `PATH`).
  2. Chrome for Testing also enables experimental CDP features such as `Page.startScreenRecording` (`agent-pilot devtools video-start`) and full isolated contexts (`agent-pilot devtools context-create`).

### Issue 6: `this developer build has no embedded DevTools runtime` on `video-start` / `context-create`
* **Root Cause**: Either the binary was compiled with bare `go build` without running `npm ci && npm run build:cli`, or an older background bridge daemon (`agent-pilot server`) is still holding port `58765` after a binary upgrade.
* **Fix**:
  ```bash
  # 1. Rebuild with embedded DevTools runtime (or install from the official OS release bundle)
  npm ci && npm run build:cli && npm run sync:mcp
  # 2. Restart the background service so the active daemon on port 58765 uses the new binary
  agent-pilot service restart
  ```
