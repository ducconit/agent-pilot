# 🔍 Common Issues & Troubleshooting

This troubleshooting guide addresses the most frequent issues encountered when installing, configuring, and operating **Agent Pilot**, along with concrete, step-by-step diagnostic and remediation instructions.

::: warning 100% Vibe Coding Notice
Agent Pilot is experimental software developed 100% via vibe coding with Google Antigravity. Always verify browser automation behavior inside non-sensitive browser sessions or isolated test environments.
:::

---

## 📋 Quick Diagnostic Checklist

Before diving into specific errors, run these quick diagnostic checks:

```bash
# 1. Check if the standalone CLI is installed and responsive
agent-pilot version

# 2. Check the background service status
agent-pilot service status

# 3. Test HTTP health endpoint on the bridge port
curl -s http://127.0.0.1:58765/health

# 4. List active tabs currently under Agent Pilot control
agent-pilot tabs
```

---

## 1. Connection & Bridge Errors

### 1.1 `Connection refused on 127.0.0.1:58765` or `Bridge not connected`

#### Symptoms:
- CLI commands return: `Error: dial tcp 127.0.0.1:58765: connect: connection refused`.
- AI Agent reports that the browser bridge is unreachable.
- Side Panel displays: `🔴 Bridge: Disconnected`.

#### Causes:
1. The background daemon service has not been installed or started.
2. The port `58765` is blocked by local firewall or in use by another application.
3. The Chrome extension is disabled or not loaded.

#### Solutions:
1. **Restart the Background Service**:
   - **Linux / macOS**:
     ```bash
     agent-pilot service stop
     agent-pilot service start
     agent-pilot service status
     ```
   - **Windows**:
     ```powershell
     agent-pilot service restart
     agent-pilot service status
     ```
2. **Run in Foreground Mode to Inspect Logs**:
   ```bash
   agent-pilot server --port 58765
   ```
   If port `58765` is already in use by another software, specify a different port:
   ```bash
   agent-pilot server --port 59000
   ```
   *(Remember to configure the extension Side Panel settings to connect to the new port).*
3. **Verify Chrome Extension**:
   - Navigate to `chrome://extensions`.
   - Ensure the **Agent Pilot** extension toggle is switched **ON**.
   - Click the reload icon (🔄) on the extension card if the service worker went inactive.

---

### 1.2 `No controlled tabs found` or `Tab not in Agent Pilot group`

#### Symptoms:
- Running `agent-pilot snapshot` or `agent-pilot click` returns: `Error: tab not found or not in Agent Pilot tab group`.
- MCP tools return an empty tab list: `[]`.

#### Causes:
Agent Pilot enforces a strict safety boundary: **it only interacts with tabs inside the dedicated `🤖 Agent Pilot` tab group**. It will never interact with your personal tabs or steal focus from your active workspace.

#### Solutions:
1. **Open a Controlled Tab**:
   Always launch tabs using the CLI or MCP tool:
   ```bash
   # CLI
   agent-pilot open "https://example.com"
   ```
   ```json
   // MCP
   { "tool": "browser_open_tab", "arguments": { "url": "https://example.com" } }
   ```
2. **Capture and Pass the `tabId`**:
   The `open` command returns a numerical `tabId` (e.g., `1546114498`). Supply this `tabId` to subsequent commands:
   ```bash
   agent-pilot snapshot --tab 1546114498
   agent-pilot click "@1" --tab 1546114498
   ```

---

## 2. CLI & PATH Errors

### 2.1 `command not found: agent-pilot`

#### Symptoms:
- Terminal reports: `zsh: command not found: agent-pilot` or `'agent-pilot' is not recognized as an internal or external command`.

#### Causes:
The directory containing the compiled binary is not included in your operating system's `PATH` environment variable.

#### Solutions:
1. **Linux / Ubuntu**:
   Ensure `~/.local/bin` is in your `PATH`:
   ```bash
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
   source ~/.bashrc
   ```
2. **macOS**:
   Ensure `~/.local/bin` is in your `PATH`:
   ```bash
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```
3. **Windows (PowerShell)**:
   Add the install directory to your User Environment Variables:
   ```powershell
   $targetDir = "$env:LOCALAPPDATA\Programs\agent-pilot"
   [Environment]::SetEnvironmentVariable("Path", "$targetDir;" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")
   ```
   Restart your terminal.

---

### 2.2 `spawn agent-pilot ENOENT` in GUI AI Assistants (Claude Desktop / Cursor / Antigravity on macOS)

#### Symptoms:
- AI IDE or MCP client fails to launch Agent Pilot with error: `spawn agent-pilot ENOENT`.

#### Causes:
On macOS, applications launched from the Finder, Dock, or Spotlight do not inherit the shell environment configured in `~/.zshrc` or `~/.bash_profile`. They run with a minimal system `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`).

#### Solutions:
In your MCP configuration file (`claude_desktop_config.json`, `~/.gemini/antigravity/mcp/`, or Cursor Settings), use the **absolute path** to the executable:

```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "/Users/YOUR_USERNAME/.local/bin/agent-pilot",
      "args": ["mcp"]
    }
  }
}
```

---

## 3. Chrome DevTools Protocol (CDP) Errors

### 3.1 `CDP_UNAVAILABLE: Cannot attach to this target`

#### Symptoms:
- Executing `--via cdp` commands, Lighthouse audits, or heap snapshots returns: `Error: CDP_UNAVAILABLE: Cannot attach to this target: Another debugger is already attached`.

#### Causes:
Google Chrome permits only **one active debugger connection** to a tab at any given time. If you have the native Chrome DevTools window (F12 / Inspect) open on that tab, Chrome blocks Agent Pilot's CDP attachment request.

#### Solutions:
1. **Close Native DevTools**: Close the Chrome DevTools (F12) panel on the inspected tab.
2. **Use Auto Mode**: For interaction commands, use `--via auto` so Agent Pilot attempts CDP first and gracefully falls back to synthetic DOM events if the debugger is blocked:
   ```bash
   agent-pilot click "#submit" --via auto --tab 12345
   ```
3. **Target Restriction**: Note that Chrome disallows attaching debuggers to special browser URLs (such as `chrome://`, `chrome-extension://`, and the Chrome Web Store).

---

### 3.2 Black Screens or Missing Views in Headless Environments

#### Symptoms:
- Screenshots or video recordings result in completely black or empty frames on headless Linux servers or Wayland compositors.

#### Causes:
Hardware acceleration or lack of an active X11 / Wayland virtual framebuffer display.

#### Solutions:
1. Run under a virtual framebuffer like `xvfb`:
   ```bash
   xvfb-run -a agent-pilot screenshot -o output.png --tab 12345
   ```
2. In Chrome launch flags, pass `--disable-gpu` and `--ozone-platform=x11` when operating on headless Linux servers.

---

## 4. Multi-Agent & WebSocket Security

### 4.1 `403 Forbidden: Origin not allowed` during WebSocket handshake

#### Symptoms:
- WebSocket connection to `ws://127.0.0.1:58765/ws` is rejected with HTTP `403 Forbidden`.

#### Causes:
Agent Pilot incorporates a strict **Cross-Site WebSocket Hijacking (CSWSH)** mitigation guard. It explicitly rejects connections initiated from arbitrary web pages (including `http://localhost` or external websites). Only connections from verified Chrome extension IDs (`chrome-extension://...`) or native loopback clients without origin headers are accepted.

#### Solutions:
- Ensure the connection request originates from the loaded Agent Pilot Chrome extension.
- If communicating via external automation scripts, connect as a native TCP socket or standard HTTP REST client, not via an untrusted browser-hosted WebSocket script.

---

## 5. PowerShell & Windows Specific Issues

### 5.1 `install.ps1 cannot be loaded because running scripts is disabled on this system`

#### Symptoms:
- Running `.\install.ps1` returns: `File C:\...\install.ps1 cannot be loaded because running scripts is disabled on this system. (PSSecurityException)`.

#### Causes:
Windows PowerShell defaults to the `Restricted` execution policy, which prevents running unsigned local `.ps1` scripts.

#### Solutions:
Execute the installer with the `Bypass` execution policy flag:
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

---

### 5.2 JSON Parsing Errors with Windows File Paths

#### Symptoms:
- MCP configuration fails with: `Invalid character in string: escape sequence`.

#### Causes:
Windows file paths use backslashes (`\`). In JSON configuration files, unescaped single backslashes are invalid.

#### Solutions:
Double every backslash in your JSON paths:
```json
{
  "command": "C:\\Users\\Username\\.local\\bin\\agent-pilot.exe"
}
```
Or use forward slashes, which Windows handles correctly:
```json
{
  "command": "C:/Users/Username/.local/bin/agent-pilot.exe"
}
```

---

## 6. Still Having Issues?

If your issue is not listed above:
1. Check the live server log in foreground mode:
   ```bash
   agent-pilot server
   ```
2. Open Chrome's extension background log:
   - Navigate to `chrome://extensions`.
   - Find **Agent Pilot** and click **Inspect views: service worker** to view real-time runtime diagnostics.
3. Submit a bug report with logs to [GitHub Issues](https://github.com/ducconit/agent-pilot/issues/new) or view our [Community Support Guide](/COMMUNITY_SUPPORT).
