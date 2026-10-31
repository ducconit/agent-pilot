# 📖 Agent Pilot User Guide

Welcome to **Agent Pilot**! This comprehensive guide walks you through every step of installing, configuring, and operating the full capability suite of the browser controller.

::: warning ⚠️ 100% Vibe Coding Notice & Legal Disclaimer
**Agent Pilot is an experimental open-source tool developed 100% via "vibe coding" using Google Antigravity.**
All architecture, Go CLI binaries, Chrome MV3 extension scripts, and MCP tooling were generated autonomously by AI models via prompt engineering. While automated tests and a 29-rule secret sanitization filter are implemented, please exercise caution:
- **Sandbox Testing**: Always test automated browser interactions in separate user profiles (`--user-data-dir`) or non-production environments.
- **Limitation of Liability**: The authors, contributors, and maintainers assume no liability for any data corruption, financial charges, or unintended actions taken by autonomous AI agents operating through this browser controller.
:::

---

## 1. Google Chrome Installation

### Method A: Install from Release ZIP (Recommended)
1. Download the latest release from [GitHub Releases](https://github.com/ducconit/agent-pilot/releases) (e.g. `agent-pilot-v1.3.0-linux.zip`, `agent-pilot-v1.3.0-macos.zip`, or `agent-pilot-v1.3.0-windows.zip`).
2. Unpack the `.zip` archive to a permanent directory on your computer.
3. Open Google Chrome and navigate to: `chrome://extensions`.
4. Enable **Developer mode** toggle in the top-right corner.
5. Click **Load unpacked** in the top-left $\rightarrow$ Select the unpacked folder.
6. Click the Extensions puzzle icon in the Chrome toolbar and **Pin (📌)** the **Agent Pilot** icon.

### Method B: Install from Source Code
1. Clone the repository:
   ```bash
   git clone https://github.com/ducconit/agent-pilot.git
   ```
2. Navigate to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select:
   ```
   /path/to/agent-pilot/extensions
   ```

---

## 2. Launching the Side Panel

Open the Agent Pilot control center using either method:
1. **Method 1 (Fastest)**: Click the pinned **Agent Pilot (📌)** icon in the Chrome toolbar. The side panel slides open instantly on the right.
2. **Method 2 (Context Menu)**: Right-click anywhere on any web page $\rightarrow$ Select **Open Agent Pilot (Side Panel)**.

> 💡 **Custom Keyboard Shortcut (Optional)**: To avoid conflicts with system window managers (e.g. rofi, i3wm, macOS Spotlight), no default shortcut is registered. To set your own:
> - Open a new tab and enter: `chrome://extensions/shortcuts`
> - Locate **Agent Pilot** and press your desired shortcut key combination.

---

## 3. Feature Walkthrough

### 3.1 Navigation & Documentation Quick Access
- **Navigate to URL**: Enter a URL in the address bar on the Side Panel header (e.g., `google.com` or `localhost:3000`) and press **Enter** or click **Go**.
- **Open Documentation & Help**: Click the 📖 icon on the header:
  - If the guide tab is not yet open: Opens a new tab and focuses on it.
  - If the guide tab is already open: Automatically focuses on the existing tab without opening duplicates.
- **Attach CDP**: Click **Attach CDP** in the top-right corner to manually connect Chrome DevTools Protocol when needed.

---

### 3.2 Real-Time AI Agent Monitoring
Switch to the **🤖 AI Agent** tab on the Side Panel:
- **Autonomous AI Control**: All virtual mouse cursor movements, ripple effects, text inputs, and smooth scrolling are autonomously driven by AI agents via MCP (port `58765`).
- **Secret & Credential Redaction Filter**:
  - Enabled by default: Automatically masks private keys (RSA, EC, OpenSSH), API keys (OpenAI, Gemini, Claude, AWS, GitHub, Stripe, Slack...), JWTs, and query secrets with asterisks `*` before transmitting to AI agents.
  - Hover over the **`?`** icon to read the filter specification.
  - Disabling the filter displays a security confirmation modal warning of potential LLM provider logging.
- **Live Action Stream**: Displays real-time agent command execution (`moveMouse`, `click`, `type`, `run_actions`...) with copy (📋) and clear (🗑️) buttons.
- **Subtle Focus-Preserving Indicator**: During AI interactions, the target web page displays a gentle neon edge glow and temporarily shields human input to prevent interference—without blocking view or rendering intrusive overlay banners.
- **System Self-Test**: Click **🧪 Self-Test** to run an automated 3-step check:
  1. Access permissions to the active tab.
  2. Content Script injection & Virtual Cursor API availability.
  3. Bridge Server connection status (Port 58765).

---

### 3.3 DevTools Engine for AI Agents (CDP Superpowers)
DevTools capabilities are fully accessible to AI Agents as first-class tools:
- AI agents inspect `console.log/warn/error` entries, `Network traffic`, and memory/performance metrics (`JS Heap`, DOM node counts, style recalculations) via MCP tool `browser_get_devtools_data` or batched within `browser_run_actions`.
- When an agent requests DevTools data, the extension automatically attaches CDP and delivers sanitized, privacy-filtered structures.

---

### 3.4 DOM Inspector & CSS Style Studio
Switch to the **🎯 Inspector & Colors** tab:
1. Click **Inspect Element**: Hover your real mouse over the webpage; an animated cyan bounding box snaps to elements with tag name and dimensions `W x H`.
2. **Click to select element**: Clicking an element **automatically exits inspection mode** immediately, restoring standard page interactivity.
3. The Side Panel presents two subtabs:
   - **📌 Overview**: Shows Tag Name, `X, Y` coordinates, Dimensions `W × H`, CSS Selector, XPath expression, Text content, and Form value. Click any field to copy or click **📋 Copy All**.
   - **🎨 Computed CSS**: Shows computed styles grouped by category (Typography, Layout, Dimensions, Spacing, Visuals, Flexbox, Grid...), featuring a live CSS search filter and **Copy All CSS**.

---

### 3.5 Precision Eyedropper Magnifier
1. Click **🎨 Pick Color** in the Side Panel or Popup.
2. An **11x11 pixel high-definition magnifying loupe** tracks the cursor, displaying individual pixels with dual crosshairs and dynamic color codes.
3. Left-click to sample a pixel:
   - Supports 5 modern color formats: `HEX`, `RGB`, `RGBA`, `HSL`, `OKLCH`.
   - **1-Click Copy**: Click any color format or 📋 to copy immediately with toast feedback.
   - Automatically copies HEX to clipboard and appends to the Palette History Chips tray.
   - Automatically exits eyedropper mode after selection (press `Esc` to cancel).

---

### 3.6 Screenshot Studio
Switch to the **📸 Screenshots** tab:
- **🖥️ Full Viewport**: Captures the entire visible area of the current tab.
- **✂️ Region Crop**: The page dims with crosshair cursor; drag a rectangle over the target area $\rightarrow$ Click **✓ Capture Region**.
- **🎯 Element Capture**: Hover over the web page to select an element (purple outline and tooltip). Clicking captures the element bounds and exits selection mode.
- **📋 Auto-Copy to Clipboard (Toggle)**: Automatically copies captured screenshots to system clipboard without additional clicks.
- After capture, preview appears in the Side Panel with real pixel dimensions, **💾 Download PNG**, and **📋 Copy** buttons.

---

### 3.7 In-Page UI Annotation & Feedback Studio
Switch to the **✏️ UI Feedback** tab on the Side Panel or click the floating Feedback Studio HUD on the page:

#### 4 Visual Feedback Capture Modes:
1. **🎯 Element Mode**:
   - Hover to highlight element $\rightarrow$ Click to select.
   - Crops element snapshot and extracts framework source location (`fileName:lineNumber` from React Fiber `_debugSource`, Vue Component `__file`, or Astro).
2. **✂️ Region Crop Mode**:
   - Drag a rectangle over the bug area.
   - Pinned numbering badges (`#1`, `#2`...) with cycling colors anchor to the page to prevent duplicate selections.
   - Quick comment popover slides open beside the selection box.
3. **📱 Viewport Mode**:
   - Captures the full viewport.
   - Opens Annotator modal supporting pins (📍 Pin) and rectangles (⬜ Box) to annotate multiple defects on one screenshot.
4. **📄 Full Page Mode**:
   - Automatically scrolls and stitches the entire long webpage from header to footer into one high-resolution image.

#### Managing Annotations:
- **Edit note**: Click ✏️ on the Side Panel card or click the `#N` badge on the in-page pin.
- **Delete annotation**: Click ✕ on the pin or 🗑️ on the Side Panel card. Remaining pins re-index automatically.
- **Real-Time Bidirectional Sync**: All additions, edits, and deletions sync instantly across page and Side Panel.

#### 3 Export Channels:
1. **🚀 Channel A (Live Agent Push)**: Click **"🚀 Send to Agent"** $\rightarrow$ Dispatches payload directly to the AI agent holding a `browser_wait_for_feedback()` long-poll.
2. **💾 Channel B (Shared Persistent Inbox)**: Click **"💾 Save to Inbox"** $\rightarrow$ Persists session to `~/.agent-pilot/inbox/feedback/<timestamp>/` (`session.json`, clean `prompt.md`, `item_*.png`). AI agent queries anytime with `browser_get_pending_feedback()`.
3. **📋 Channel C (1-Click Clipboard Prompt)**: Click **"📋 Copy Prompt"** $\rightarrow$ Formats rich Markdown with all metrics and file locations ready to paste into any LLM chat.

---

## 4. Standalone Go CLI & MCP Server (`agent-pilot`)

The standalone **Golang** binary eliminates Node.js/npm dependencies, bundling the bridge server, stdio MCP server, and CLI tools:

### 4.1. Binary Installation
- **Download pre-built binary from GitHub Releases**:
  - Linux x86_64: `agent-pilot-linux-amd64`
  - Linux ARM64: `agent-pilot-linux-arm64`
  - macOS Apple Silicon: `agent-pilot-darwin-arm64`
  - macOS Intel: `agent-pilot-darwin-amd64`
  - Windows: `agent-pilot-windows-amd64.exe` or `agent-pilot-windows-arm64.exe`
- Rename to `agent-pilot` and move to `/usr/local/bin/` (Linux/macOS) or add to `PATH` (Windows).

### 4.2. Background Service Management
Manage cross-platform background daemons with a single command:
```bash
# Install and enable auto-start on boot/login:
agent-pilot service install

# Check service status:
agent-pilot service status

# Restart service:
agent-pilot service restart

# Stop service:
agent-pilot service stop

# Uninstall service:
agent-pilot service uninstall
```

**Platform Daemon Implementations:**
- **Linux**: Configures `systemd --user` at `~/.config/systemd/user/agent-pilot.service` (runs in user space, no `sudo` required).
- **macOS**: Loads LaunchAgent at `~/Library/LaunchAgents/com.agentpilot.bridge.plist`.
- **Windows**: Registers Task Scheduler task (`AgentPilotBridge`) running silently without console popup.

### 4.3. MCP Server Configuration (`stdio`)
Add to your AI agent configuration (Antigravity, Claude Desktop, Cursor):
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

### 4.4. CLI Automation Commands
Engineers can automate Chrome directly from the terminal:
```bash
# Open URL
agent-pilot open "https://example.com" --active

# Type text into form input and press Enter
agent-pilot type "#search-box" "mechanical keyboard" --enter

# Click element
agent-pilot click ".btn-search"

# Inspect DOM element
agent-pilot inspect "#product-price"

# Capture screenshot to file
agent-pilot screenshot -o search_results.png --mode visible

# List open tabs
agent-pilot tabs

# Execute batch automation workflow from JSON
agent-pilot batch flow_test.json

# View feedback sessions
agent-pilot feedback list
```

#### CDP Control for Cross-Origin Iframes, Canvas, and Games
By default, `click` and `drag` use fast synthetic DOM events. For **cross-origin iframes, `<canvas>`, and WebGL/Unity games**, enable trusted CDP input:
```bash
# Check CDP debugger availability
agent-pilot cdp status --tab 12345

# Trusted click by coordinate
agent-pilot click -x 733 -y 668 --via cdp --tab 12345

# Drag gesture (slingshot aim with 800ms hold)
agent-pilot drag --from-x 745 --from-y 490 --to-x 745 --to-y 832 --steps 10 --hold 800 --via cdp --tab 12345

# Safe auto mode: tries CDP first, falls back to synthetic if debugger is blocked
agent-pilot click "#play-button" --via auto --tab 12345
```

---

### 4.5. Multi-Agent Concurrency & Tab Isolation

When running multiple AI agents concurrently (e.g. Antigravity IDE, Codex, Claude Code, Antigravity CLI):
1. **Run Background Service**: `agent-pilot service install`. Port 58765 stays ready. Dual Mode forwards requests through the HTTP REST Gateway without `EADDRINUSE` port conflicts.
2. **Pass Explicit `tabId`**: When an agent opens a tab via `browser_open_tab(url)`, the extension returns a unique `tabId`. Pass this `tabId` to subsequent calls (`browser_click`, `browser_type`, `browser_screenshot`, `browser_run_actions`) to keep agents strictly isolated.
3. **Background Focus Preservation**: Agent tabs open in the background (`active: false`) and group into `🤖 Agent Pilot`. Background screenshotting captures viewports without stealing focus from your workspace.

---

## 5. Agent Skills Ecosystem Integration

Agent Pilot adheres to the open **Agent Skills Standard** ([skills.sh](https://skills.sh/)). Any AI coding agent (Claude Code, Cursor, Codex, OpenCode, Antigravity, Devin...) installs browser control with one command:

```bash
# Install for current project
npx skills add https://github.com/ducconit/agent-pilot

# Install globally for all assistants on machine
npx skills add https://github.com/ducconit/agent-pilot -g --all
```
