# 📖 Agent Pilot User Guide

Welcome to **Agent Pilot**! Originally built for personal use to **replace the default Chrome MCP on Google Antigravity** and eliminate the need for **AI agents to generate ad-hoc Python scripts to manipulate the browser or draw text/annotations onto images** during web testing, Agent Pilot provides a complete, token-efficient browser control and QA/QC suite. This guide walks you through installing, configuring, and operating every feature.

::: warning ⚠️ 100% Vibe Coding Notice & Legal Disclaimer
**Agent Pilot is an experimental open-source tool developed 100% via "vibe coding" using Google Antigravity.**
All architecture, Go CLI binaries, Chrome MV3 extension scripts, and MCP tooling were generated autonomously by AI models via prompt engineering. While automated tests and a dual-layer secret sanitization engine (13 regex patterns and 23 sensitive property keys) are implemented, please exercise caution:
- **Sandbox Testing**: Always test automated browser interactions in separate user profiles (`--user-data-dir`) or non-production environments.
- **Limitation of Liability**: The authors, contributors, and maintainers assume no liability for any data corruption, financial charges, or unintended actions taken by autonomous AI agents operating through this browser controller.
:::

---

## 1. Installation & Environment Setup

Agent Pilot provides three installation methods suited to different needs:

### Method A: Install from OS Release Bundle (Recommended)

This is the **strongly recommended installation method** for end users and QA engineers. Each bundle is built specifically for your operating system, packaging only the single native binary for your OS, the unpacked Chrome extension, and an automated 1-step installer script:

| Operating System | Release Archive | 1-Step Installer Command | Detailed Guide |
| :--- | :--- | :--- | :--- |
| 🐧 **Linux / Ubuntu** | `agent-pilot-*-linux.zip` | `./install.sh` | [README.ubuntu.md](/bundles/README.ubuntu) |
| 🍎 **macOS** | `agent-pilot-*-macos.zip` | `./install.sh` | [README.macos.md](/bundles/README.macos) |
| 🪟 **Windows** | `agent-pilot-*-windows.zip` | `powershell -ExecutionPolicy Bypass -File .\install.ps1` | [README.windows.md](/bundles/README.windows) |

1. Download the latest release package matching your OS from [GitHub Releases](https://github.com/ducconit/agent-pilot/releases).
2. Unpack the `.zip` archive to a permanent directory on your computer.
3. Run the OS installer script (`./install.sh` or `.\install.ps1`). This installs the standalone binary to your user `PATH` and registers the auto-starting background service (`systemd` / `launchd` / Windows service).
4. Open Google Chrome and navigate to: `chrome://extensions`.
5. Enable **Developer mode** toggle in the top-right corner.
6. Click **Load unpacked** in the top-left → Select the `extensions/` folder from the unpacked bundle.
7. Click the Extensions puzzle icon in the Chrome toolbar and **Pin (📌)** the **Agent Pilot** icon.

### Method B: Quick Install for AI Agents (`npx skills add`)

If you want to quickly integrate Agent Pilot into your AI coding agent (Claude Code, Cursor, Windsurf, Antigravity, OpenCode, Codex, Roo Code, etc.) without manually downloading archives:

```bash
# Install globally for all AI assistants on your computer
npx skills add https://github.com/ducconit/agent-pilot -g --all

# Or install for the current workspace only
npx skills add https://github.com/ducconit/agent-pilot
```

> 💡 **Quick Install Note**: This method is tailored for **fast agent bootstrapping**. Because it must support any host machine immediately, the installed skill package contains pre-compiled binaries for **all 3 operating systems** (Linux `agent-pilot`, macOS `agent-pilot`, Windows `agent-pilot.exe`) in `skills/agent-pilot/scripts/`. For a lightweight, single-binary setup with native system daemon registration, prefer **Method A (OS Release Bundle)**.

To load the Chrome extension, load the `extensions/` directory from the installed skill or release download via `chrome://extensions` (Load unpacked).

### Method C: Build & Install from Source Code

For developers, contributors, and those who want to customize Go CLI commands or Chrome MV3 extension scripts:

1. Clone the repository:
   ```bash
   git clone https://github.com/ducconit/agent-pilot.git
   cd agent-pilot
   ```
2. Build the Go CLI binary:
   ```bash
   go build -o bin/agent-pilot ./cli/cmd/agent-pilot
   ```
3. Install the background service:
   ```bash
   ./bin/agent-pilot service install
   ./bin/agent-pilot service status
   ```
4. Navigate to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select:
   ```
   /path/to/agent-pilot/extensions
   ```

---

## 2. Launching the Side Panel

Open the Agent Pilot control center using either method:
1. **Method 1 (Fastest)**: Click the pinned **Agent Pilot (📌)** icon in the Chrome toolbar. The side panel slides open instantly on the right.
2. **Method 2 (Context Menu)**: Right-click anywhere on any web page → Select **Open Agent Pilot (Side Panel)**.

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
- **✂️ Region Crop**: The page dims with crosshair cursor; drag a rectangle over the target area → Click **✓ Capture Region**.
- **🎯 Element Capture**: Hover over the web page to select an element (purple outline and tooltip). Clicking captures the element bounds and exits selection mode.
- **📋 Auto-Copy to Clipboard (Toggle)**: Automatically copies captured screenshots to system clipboard without additional clicks.
- After capture, preview appears in the Side Panel with real pixel dimensions, **💾 Download PNG**, and **📋 Copy** buttons.

---

### 3.7 In-Page UI Annotation & Feedback Studio
Switch to the **✏️ UI Feedback** tab on the Side Panel or click the floating Feedback Studio HUD on the page:

#### 4 Visual Feedback Capture Modes:
1. **🎯 Element Mode**:
   - Hover to highlight element → Click to select.
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
1. **🚀 Channel A (Live Agent Push)**: Click **"🚀 Send to Agent"** → Dispatches payload directly to the AI agent holding a `browser_wait_for_feedback()` long-poll.
2. **💾 Channel B (Shared Persistent Inbox)**: Click **"💾 Save to Inbox"** → Persists session to `~/.agent-pilot/inbox/feedback/<timestamp>/` (`session.json`, clean `prompt.md`, `item_*.png`). AI agent queries anytime with `browser_get_pending_feedback()`.
3. **📋 Channel C (1-Click Clipboard Prompt)**: Click **"📋 Copy Prompt"** → Formats rich Markdown with all metrics and file locations ready to paste into any LLM chat.

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

Engineers and AI agents can automate Chrome directly from the terminal using the standalone `agent-pilot` binary. Below is the complete command reference grouped by capability, followed by practical examples, inline wait flag options, trusted CDP operations, and batch execution scripts.

#### 4.4.1. Complete Command Lookup Reference

##### Group 1: Page Interaction Commands (17 Commands)

| Command | Syntax | Description | CDP Required? |
| :--- | :--- | :--- | :--- |
| `open` | `agent-pilot open <url>` | Open URL in a background tab inside the `🤖 Agent Pilot` group (or navigate target tab with `--tab`) | ❌ No |
| `navigate` | `agent-pilot navigate <url\|back\|forward\|reload>` | Navigate tab with history back/forward, cache-bypass, init scripts, or beforeunload handling | ❌ No |
| `click` | `agent-pilot click <selector>` | Click element or coordinate (`--x`, `--y`); supports `--dblclick`, `--button`, and `--via cdp` | ⚙️ Optional (`--via cdp`) |
| `type` | `agent-pilot type <selector> <text>` | Type text into input/textarea; supports `--clear` before typing and `--enter` | ❌ No |
| `fill` | `agent-pilot fill <fields.json>` | Fill multiple form fields and automatically submit in a single round-trip | ❌ No |
| `scroll` | `agent-pilot scroll [down\|up\|left\|right\|dx dy]` | Scroll page or element by direction (`down`, `up`, `right`, `left`) or pixel delta (`--dx`, `--dy`) | ❌ No |
| `hover` | `agent-pilot hover <selector>` | Hover virtual cursor over DOM element to trigger `:hover` CSS and dynamic JS tooltips | ❌ No |
| `drag` | `agent-pilot drag <from> <to>` | Drag element or coordinates (`--from-x`, `--from-y`, `--to-x`, `--to-y`); supports `--hold` and `--via cdp` | ⚙️ Optional (`--via cdp`) |
| `key` | `agent-pilot key <key1> [key2...]` | Send single keys, shortcuts (`Ctrl+A`, `Ctrl+V`), or sequences (`--delay`, `--repeat`) | ❌ No |
| `wait` | `agent-pilot wait [selector\|text\|ms]` | Wait for selector, text, state (`visible`, `attached`), or fixed sleep milliseconds | ❌ No |
| `upload` | `agent-pilot upload <selector> <files...>` | Upload local files to `<input type="file">` via CDP or synthetic `DataTransfer` fallback | ⚙️ Optional (`--via auto`) |
| `dialog` | `agent-pilot dialog <accept\|dismiss>` | Automatically handle JavaScript dialogs (`alert`, `confirm`, `prompt`) with prompt text | ✅ Yes |
| `inspect` | `agent-pilot inspect <selector>` | Inspect element bounds, selector, XPath, text, and computed CSS (`--styles`) | ❌ No |
| `snapshot` | `agent-pilot snapshot` | Extract ultra-compact interactive element map (`@1`, `@2`...) for LLM context | ❌ No |
| `screenshot` | `agent-pilot screenshot` | Capture high-res screenshot with annotations (`--highlight`, `--step`, `--title`, `--arrow`, `--badge`) | ✅ Yes (bg tabs) |
| `close` | `agent-pilot close [ids...\|--all]` | Close current tab, specified tab ID(s), or all tabs in the `🤖 Agent Pilot` group | ❌ No |
| `tabs` | `agent-pilot tabs` | List all open tabs in the `🤖 Agent Pilot` group (Aliases: `list`, `ls`) | ❌ No |

##### Group 2: Evaluation & DevTools Commands (11 Commands)

| Command | Syntax | Description | CDP Required? |
| :--- | :--- | :--- | :--- |
| `eval` / `evaluate` | `agent-pilot eval <script>` | Evaluate JavaScript expression in `MAIN` world (access to `window`, React/Vue states) | ❌ No (CDP fallback) |
| `console` | `agent-pilot console [list\|errors\|clear]` | View console logs, warnings, or page runtime exceptions (`errors`) | ✅ Yes |
| `network` | `agent-pilot network [list\|get <id>\|clear]` | Inspect network requests/responses, filter by URL/type/navigation, or get response body | ✅ Yes |
| `metrics` | `agent-pilot metrics` | Measure Core Web Vitals (LCP, CLS, FCP, TTFB, TBT), DOM health, and V8 heap stats | ✅ Yes |
| `trace` | `agent-pilot trace <start\|stop>` | Record timeline performance trace, detecting long tasks (>=50ms) and reflows | ✅ Yes |
| `heap` | `agent-pilot heap [snapshot\|baseline\|diff\|gc]` | Capture V8 heap snapshot, measure memory leaks, or trigger garbage collection | ✅ Yes |
| `resize` | `agent-pilot resize <width> <height>` | Adjust browser viewport dimensions dynamically for responsive layout auditing | ✅ Yes |
| `emulate` | `agent-pilot emulate` | Emulate network throttling (`slow-3g`, `offline`), CPU throttling, and color theme | ✅ Yes |
| `webauthn` | `agent-pilot webauthn <action>` | Manage virtual WebAuthn authenticators and passkeys for passwordless auth testing | ✅ Yes |
| `extensions` | `agent-pilot extensions [list\|toggle]` | Inspect, enable, or disable installed browser extensions | ✅ Yes |
| `cdp` | `agent-pilot cdp status` | Check if Chrome DevTools debugger is attached and available for trusted CDP input | ✅ Yes |

##### Group 3: Session, Security & Automation Commands (6 Commands)

| Command | Syntax | Description | CDP Required? |
| :--- | :--- | :--- | :--- |
| `session` | `agent-pilot session [start\|end\|status]` | Maintain persistent session with visible neon cursor and action lock shield | ❌ No |
| `busy` | `agent-pilot busy [on\|off]` | Directly toggle the human input lock shield with an optional status banner | ❌ No |
| `service` | `agent-pilot service <action>` | Manage OS background daemon (`install`, `uninstall`, `start`, `stop`, `restart`, `status`) | ❌ No |
| `skill` | `agent-pilot skill install` | Install embedded `agent-pilot` skill into agent skills directories (`--agy`, `--path`) | ❌ No |
| `batch` | `agent-pilot batch <flow.json>` | Execute an ordered workflow of browser actions in a single atomic network call | ❌ No (per step) |
| `recorder` | `agent-pilot recorder <operation>` | Record, replay, export, import, or measure Chrome DevTools Recorder flows | ❌ No (per step) |

---

#### 4.4.2. Practical CLI Examples

```bash
# === 1. PAGE INTERACTIONS ===
# Open URL in background and bring to front
agent-pilot open "https://example.com" --active

# Reload tab bypassing cache
agent-pilot navigate reload --ignore-cache --tab 12345

# Capture interactive element snapshot (@1, @2...)
agent-pilot snapshot --tab 12345

# Type text into search box and press Enter
agent-pilot type "#search-box" "mechanical keyboard" --clear --enter

# Click element with visual neon ripple cursor
agent-pilot click ".btn-search" --tab 12345

# Fill an entire form and submit
agent-pilot fill form_data.json --submit "#btn-submit"

# Scroll down 800px or by direction
agent-pilot scroll down --tab 12345
agent-pilot scroll --dy 800 --tab 12345

# Hover over menu dropdown
agent-pilot hover ".dropdown-menu-trigger" --tab 12345

# Send keyboard shortcuts
agent-pilot key Ctrl+a Backspace 1 2 3 Enter --selector "#otp-input" --tab 12345

# Wait for selector or text
agent-pilot wait "#success-banner" --state visible --timeout 5000
agent-pilot wait --text "Payment Successful" --timeout 5000

# File upload to <input type="file">
agent-pilot upload "input[type=file]" ./document.pdf --via auto --tab 12345

# Auto-accept JavaScript dialogs
agent-pilot dialog accept --tab 12345

# Inspect DOM element details
agent-pilot inspect "#product-price" --styles --tab 12345

# Capture annotated screenshot
agent-pilot screenshot -o /tmp/checkout.png --step "1/3" --title "Checkout" --highlight "@1" --tab 12345

# Tab management
agent-pilot tabs
agent-pilot close --tab 12345

# === 2. EVALUATION & DEVTOOLS ===
# Run JavaScript in MAIN world (access to window, React/Vue internals)
agent-pilot eval "document.title" --tab 12345
agent-pilot eval -f ./extract-data.js -o /tmp/extracted.json --tab 12345

# Inspect console logs and page runtime errors
agent-pilot console errors --tab 12345
agent-pilot console list --level warn --limit 20 --tab 12345

# Filter network requests from the current navigation
agent-pilot network list --current-nav --tab 12345
agent-pilot network get req_abc123 --tab 12345

# Measure Core Web Vitals & DOM health
agent-pilot metrics --tab 12345

# Record performance timeline trace
agent-pilot trace start --tab 12345
agent-pilot click "#compute-btn" --tab 12345
agent-pilot trace stop --tab 12345

# Detect memory leaks via heap snapshots
agent-pilot heap baseline --tab -12345 --file /tmp/base.heapsnapshot
agent-pilot heap diff --tab -12345 --file /tmp/curr.heapsnapshot

# Viewport resizing for mobile responsiveness
agent-pilot resize 375 812 --tab 12345

# Emulate network throttling and dark theme
agent-pilot emulate --network slow-3g --cpu 4x --theme dark --tab 12345

# Virtual WebAuthn / Passkey authenticator
agent-pilot webauthn enable --tab 12345
agent-pilot webauthn add --protocol ctap2 --transport internal --tab 12345

# Extension inspection
agent-pilot extensions list

# === 3. SESSION, SECURITY & AUTOMATION ===
# Start persistent session with continuous neon cursor
agent-pilot session start --name "Checkout Automation" --tab 12345
agent-pilot busy on --action "Processing automated order..." --tab 12345
agent-pilot busy off --tab 12345
agent-pilot session end --tab 12345

# Chrome DevTools Recorder flow
agent-pilot recorder start --title "Login Journey" --tab 12345
agent-pilot click "#login-button" --tab 12345
agent-pilot recorder stop --tab 12345
agent-pilot recorder export --tab 12345 --format json > flow.recorder.json
agent-pilot recorder replay --file flow.recorder.json --tab 12345

# Execute batch automation workflow from JSON
agent-pilot batch flow_test.json
```

---

#### 4.4.3. Inline Wait Flags (Token & Roundtrip Optimization)

In standard browser automation, chaining actions typically requires 3 separate round-trips:
1. `click` element -> wait for response.
2. `wait_for_selector` -> wait for response.
3. `snapshot` -> wait for response.

Agent Pilot features **Inline Wait Flags**, allowing agents to chain waiting conditions and snapshot retrieval directly onto interaction commands (`open`, `navigate`, `click`, `type`, `fill`, `scroll`, `hover`, `drag`, `key`, `upload`) in a **single atomic call**:

| Inline Wait Flag | Aliases | Description |
| :--- | :--- | :--- |
| `--wait <ms>` | `--sleep`, `--wait-ms`, `--sleep-ms` | Sleep for specified milliseconds after the action executes (e.g. `--wait 500` or `--wait 500ms`) |
| `--wait-for <selector>` | `--wait-selector` | Wait for target CSS selector or `@ref` to be attached/visible in DOM before returning |
| `--wait-text <text>` | *(none)* | Wait for specified visible text to appear in DOM before returning |
| `--include-snapshot` | `--snapshot` | Automatically capture and return an interactive DOM snapshot (`@1`, `@2`...) in the same response |

**Why this matters**:
- **~80% Token Reduction**: Eliminates repeated round-trips and conversational overhead for wait and snapshot commands.
- **Zero Flakiness**: The browser bridge waits locally before taking the snapshot, avoiding premature assertions.

**Examples**:
```bash
# Click submit button, wait for dashboard to appear, and get updated DOM snapshot in 1 command:
agent-pilot click "#btn-submit" --wait-for "#dashboard-view" --include-snapshot --tab 12345

# Type search query, press Enter, wait 500ms for results to render, and return snapshot:
agent-pilot type "#search-box" "laptop gaming" --enter --wait 500 --include-snapshot --tab 12345

# Open URL and wait for welcome text:
agent-pilot open "https://example.com" --wait-text "Welcome back" --include-snapshot
```

---

#### 4.4.4. Trusted CDP Control for Cross-Origin Iframes, Canvas, and Games

By default, `click` and `drag` use fast synthetic DOM events (with neon cursor effects). For **cross-origin iframes, `<canvas>`, and WebGL/Unity games**, synthetic DOM events cannot penetrate origin barriers. Enable trusted CDP input via `--via cdp`:

```bash
# Check CDP debugger availability
agent-pilot cdp status --tab 12345

# Trusted click by coordinate (using standard GNU/Cobra flags --x and --y)
agent-pilot click --x 733 --y 668 --via cdp --tab 12345

# Drag gesture (slingshot aim with 800ms hold)
agent-pilot drag --from-x 745 --from-y 490 --to-x 745 --to-y 832 --steps 10 --hold 800 --via cdp --tab 12345

# Safe auto mode: tries CDP first, falls back to synthetic if debugger is blocked
agent-pilot click "#play-button" --via auto --tab 12345
```

- `--via cdp` **does not fall back silently**: if attaching the debugger fails, it returns `CDP_UNAVAILABLE: <reason>` with actionable hints.
- `--via auto` is ideal when executing workflows across mixed DOM and canvas/iframe interfaces.
- The visual neon cursor only appears with the synthetic engine; trusted CDP input dispatches native system-level events and does not render virtual cursor overlays.

---

#### 4.4.5. Batch Automation JSON Structure (`flow_test.json`)

Batch automation allows executing an entire sequence of browser operations in a single network call:

```json
[
  { "action": "open", "url": "https://google.com", "active": true },
  { "action": "wait", "ms": 1000 },
  { "action": "type", "selector": "textarea[name='q']", "text": "Agent Pilot Golang", "pressEnter": true },
  { "action": "wait", "ms": 2000 },
  { "action": "screenshot", "label": "google_search_results" }
]
```

Or using the structured `actions` object format:

```json
{
  "actions": [
    { "type": "open", "url": "https://example.com/login" },
    { "type": "wait_for_selector", "selector": "#username", "timeout": 5000 },
    { "type": "type", "selector": "#username", "text": "tester@example.com" },
    { "type": "type", "selector": "#password", "text": "Secret123!" },
    { "type": "click", "selector": "#btn-submit" },
    { "type": "screenshot", "mode": "visible", "path": "/tmp/step-login.png", "title": "Login Completed" },
    { "type": "close" }
  ]
}
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

> 💡 **Notice on Binaries**: The `npx skills add` package includes pre-compiled binaries for all 3 supported operating systems (Linux, macOS, Windows) inside `skills/agent-pilot/scripts/` to enable rapid zero-configuration agent execution. If you prefer a trimmed single-binary installation with native system service integration, use the [OS Release Bundle](#method-a-install-from-os-release-bundle-recommended).

---

## 6. Questions & Answers (Q&A)

For comprehensive explanations on architecture, token savings, and Web QA/QC testing workflows, consult the [Questions & Answers (Q&A)](/QA) guide.

---

## 7. Common Issues & Troubleshooting

Encountering an issue with the local bridge, CDP debugger attachment, or system PATH? Consult the detailed [Troubleshooting & Diagnostics](/TROUBLESHOOTING) guide for step-by-step solutions.
