# Agent Pilot - CLI Usage & Command Reference

The `agent-pilot` standalone binary is a zero-dependency CLI written in Go for controlling web browsers, executing batch automation workflows, managing background services, and running MCP servers.

---

## 1. Global Flags & Conventions

- **Default Port**: `58765` (WebSocket: `ws://127.0.0.1:58765`, HTTP: `http://127.0.0.1:58765`)
- **Target Tab (`--tab <id>`) & Group Isolation (`🤖 Agent Pilot`)**: Commands strictly target tabs belonging to the `🤖 Agent Pilot` tab group. They never hijack the user's personal active tab outside the group. Specify `--tab <id>` to explicitly target a specific tab within the group, and always run `agent-pilot close` when finished testing to free RAM.
- **Output Format**: Commands output user-friendly icons (`✅`, `❌`, `🌐`) by default. `open`, `navigate`, `click`, `close`, and `emulate` accept `--format json` for machine-readable output without Go map formatting; `batch` and DevTools commands already emit JSON.

### 1.1 CDP Requirement Matrix (Mandatory vs Optional)

Commands use either the **synthetic DOM engine** (no debugger needed) or the **CDP engine** (`chrome.debugger`, trusted input). Use `agent-pilot cdp status --tab <id>` to check CDP availability before CDP-dependent workflows.

| CLI command | CDP required? |
| :--- | :--- |
| `tabs`, `open`, `close`, `navigate`, `snapshot`, `inspect`, `fill`, `type`, `scroll`, `wait`, `evaluate` | ❌ No (DOM / `chrome.tabs` / content script) |
| `click`, `drag` | ⚙️ Optional — default synthetic; add `--via cdp` for cross-origin iframes / canvas / WebGL |
| `click --via auto`, `drag --via auto` | ⚙️ Optional — tries CDP, falls back to synthetic |
| `hover`, `key` | ⚙️ Optional — CDP-first with automatic synthetic fallback |
| `upload` | ⚙️ Optional — default `--via auto` tries CDP `DOM.setFileInputFiles`, falls back to `MAIN`-world `DataTransfer` + `File` (`--via cdp` requires CDP) |
| `screenshot` | ✅ Yes for background tabs (active tab has a `captureVisibleTab` fallback) |
| `dialog`, `emulate`, `resize`, `network`, `trace`, `metrics`, `heap` | ✅ Yes |
| `cdp status` | ✅ Yes (by definition; reports attach status) |
| `--via cdp` failure mode | Returns `CDP_UNAVAILABLE: <reason>` — no silent fallback |

Notes:
- Common CDP failures: DevTools already open on the tab, debugger permission/policy blocked.
- Synthetic commands cannot cross cross-origin iframe boundaries; they also will not drive canvas/WebGL input.
- The visual neon cursor only appears with the synthetic engine; `--via cdp` input is invisible (no cursor/ripple).

---

## 2. Background Service Management (`service`)

Manage the persistent Agent Pilot bridge daemon on your operating system without needing sudo/root:

```bash
# Install and enable auto-start on boot
agent-pilot service install

# Check running status (PID, memory, CPU, port)
agent-pilot service status

# Restart the service (e.g. after updating binary)
agent-pilot service restart

# Reload configuration
agent-pilot service reload

# Stop background service
agent-pilot service stop

# Start background service
agent-pilot service start

# Completely uninstall background service
agent-pilot service uninstall
```

---

## 3. Session & Visual Indicator Control (`session` & `busy`)

Control continuous session visibility and action locking on target tabs:

### Continuous Session (`agent-pilot session`)
Keeps the virtual mouse cursor and lock shield (neon border + action pill) continuously visible on the web page throughout the agent's work session:

```bash
# Start an active session on the current tab
agent-pilot session start

# Start a session with a custom task description
agent-pilot session start --name "Automated Regression Test Suite"

# Start session on a specific tab
agent-pilot session start --tab 12345 --name "Product Data Scraping"

# Check active session status
agent-pilot session status [--tab <id>]

# End session and dismiss cursor/shield
agent-pilot session end [--tab <id>]
# (Alias: agent-pilot session stop)
```

### Action Lock Shield (`agent-pilot busy`)
Directly toggle the in-page human input lock shield:

```bash
# Turn lock shield ON
agent-pilot busy on

# Turn lock shield ON with custom action text
agent-pilot busy on --action "Processing checkout payment..."

# Turn lock shield OFF
agent-pilot busy off
```

---

## 4. Browser Navigation & Tabs (`open`, `navigate`, `close`, `tabs`)

```bash
# Open a new URL in background inside the 🤖 Agent Pilot tab group (active=false by default)
agent-pilot open https://example.com

# Open URL and make it the active tab
agent-pilot open https://example.com --active

# Open or navigate to a Basic Auth protected staging URL (safely encodes @, &, :, # in credentials)
agent-pilot open https://staging.example.com --user admin --password "p@ss&&word!"
agent-pilot navigate https://staging.example.com/checkout --user admin --password "p@ss&&word!" --tab 12345

# Close the current or specified Agent tab when testing is done to free RAM
agent-pilot close [--tab <id>]

# List all open tabs across all browser windows
agent-pilot tabs

# Machine-readable results for scripts and agents
agent-pilot open https://example.com --format json
agent-pilot navigate https://example.com/checkout --tab 12345 --format json
agent-pilot close --tab 12345 --format json
```

---

## 5. Web Interactions (`click`, `type`, `fill`, `upload`, `inspect`)

> Engine: synthetic DOM by default (no CDP). `click`/`drag` support opt-in trusted CDP input via `--via cdp`, and `upload` uses `--via auto` (CDP with automatic `MAIN`-world `DataTransfer` fallback).

```bash
# Click an element by CSS selector (auto-calculates center & plays neon ripple)
agent-pilot click "#submit-button"

# Click at specific viewport coordinates
agent-pilot click -x 350 -y 220

# Click element on a specific tab
agent-pilot click ".nav-item" --tab 12345

# Type text into an input field (simulates human keystrokes)
agent-pilot type "#email" "user@example.com"

# Clear field before typing and press Enter afterwards
agent-pilot type "#search" "agent pilot automation" --clear --enter

# Upload local file(s) to <input type="file"> (CDP first + automatic MAIN-world DataTransfer fallback)
agent-pilot upload "input[type=file]" ./receipt.png
agent-pilot upload "#avatar-upload" ./photo1.png ./photo2.jpg --via auto --tab 12345

# Inspect DOM element details (rect, selector, XPath, text, computed CSS)
agent-pilot inspect "#product-card"

# Wait for an element selector or visible text
agent-pilot wait "#dashboard-ready" --state visible --timeout 5000
agent-pilot wait --text "Payment Successful" --timeout 5000

# Pure sleep for a fixed duration (ms) or wait for document.readyState === "complete"
agent-pilot wait 1500
agent-pilot wait --ms 1500
agent-pilot wait
```

### Trusted input via CDP (`--via cdp`) — cross-origin iframes, canvas & WebGL games

By default `click`/`drag` use synthetic DOM events (`--via synthetic`, unchanged). For cross-origin iframes or canvas/WebGL apps (Unity, games) where synthetic events fail, opt in to trusted CDP input:

```bash
# Check whether the debugger can attach (required for --via cdp)
agent-pilot cdp status --tab 12345

# Trusted click at coordinates (works inside cross-origin iframes / canvas)
agent-pilot click -x 733 -y 668 --via cdp --tab 12345

# Trusted click resolved from a CSS selector (auto-resolves to its center)
agent-pilot click "#play-button" --via cdp --tab 12345

# Trusted drag between coordinates, with hold for slingshot-style mechanics
agent-pilot drag --from-x 745 --from-y 490 --to-x 745 --to-y 832 --steps 10 --hold 800 --via cdp --tab 12345

# Same as above with element selectors
agent-pilot drag "#handle" "#dropzone" --via cdp --tab 12345

# Auto mode: try CDP first, fall back to synthetic on failure (e.g. debugger blocked)
agent-pilot click -x 733 -y 668 --via auto --tab 12345
```

Notes:
- `--via cdp` fails with a clear `CDP_UNAVAILABLE` error (no silent fallback) when the debugger cannot attach (DevTools open, permission blocked). Use `--via auto` to fall back.
- Flags may appear before or after the selector/URL arguments.

---

## 6. JavaScript Evaluation (`evaluate` / `eval`)

Execute arbitrary JavaScript expressions directly within the page context. Evaluates first in the `MAIN` execution world for full access to window/DOM state, React/Vue/Svelte internals, and globals, with automatic fallback to CDP `Runtime.evaluate`:

```bash
# Evaluate a simple expression
agent-pilot eval "document.title"

# Query window location and document state
agent-pilot eval "({ url: location.href, readyState: document.readyState })"

# Evaluate script on a specific tab
agent-pilot evaluate "document.querySelector('h1').innerText" --tab 12345
```

---

## 7. Screenshots & Step Annotations (`screenshot`)

> Engine: CDP `Page.captureScreenshot`. CDP is **required for background tabs**; the active tab can fall back to `chrome.tabs.captureVisibleTab`.

Capture high-resolution PNG screenshots via Chrome DevTools Protocol. Supports built-in visual annotations (`--step`, `--title`, `--description`, `--highlight`) rendered directly onto the PNG via `OffscreenCanvas` before saving. When `-o` is omitted, screenshots are saved by default into the OS temporary directory (`os.TempDir()`, e.g., `/tmp/screenshot_<timestamp>.png`) so home and project directories stay clean:

```bash
# Capture visible viewport (saved to OS temp directory by default)
agent-pilot screenshot

# Capture visible viewport to a specific file path
agent-pilot screenshot -o ./viewport.png

# Capture annotated step screenshot with banner and highlighted element
agent-pilot screenshot -o /tmp/step-01.png \
  --step 1 \
  --title "Chọn gói dịch vụ" \
  --description "Khách hàng chọn gói chụp và bấm Thêm vào giỏ hàng" \
  --highlight "[data-testid='package-card']"

# Capture specific element
agent-pilot screenshot --mode element --selector ".hero-banner" -o ./banner.png

# Capture specific screen region
agent-pilot screenshot --mode region -o ./region.png
```

---

## 7b. Deep Performance Metrics, Timeline Trace & Memory Leak Detection (`metrics`, `trace`, `heap`, `devtools`)

> Engine: CDP `Performance`, `Tracing`, and `HeapProfiler` domains + `MAIN`-world Web Vitals & DOM/A11y probe.

```bash
# Query CDP runtime metrics + Core Web Vitals (LCP, CLS, TBT, FCP, TTFB) + DOM/A11y health + diagnostics
agent-pilot metrics [--tab 12345]
agent-pilot metrics --no-vitals --no-dom-health --tab 12345

# Start & stop DevTools timeline trace (returns CPU breakdown, Long Tasks >=50ms, Forced Reflows, Hot Scripts)
agent-pilot trace start [--tab 12345]
agent-pilot click "#heavy-filter-btn" --tab 12345
agent-pilot trace stop [--tab 12345]

# Probe first. Ordinary extension-debugger tabs report HEAPPROFILER_UNAVAILABLE;
# use a negative tab ID from an isolated DevTools context for a real snapshot.
agent-pilot heap capability --tab 12345

# Memory Leak Detection workflow on an isolated context:
agent-pilot heap baseline --tab -12345 --file /tmp/base.heapsnapshot
agent-pilot click "#open-modal" --tab 12345
agent-pilot click "#close-modal" --tab 12345
agent-pilot heap diff --tab -12345 --file /tmp/current.heapsnapshot

# Analyze saved snapshots without returning the full heap graph to the agent.
agent-pilot devtools heap-analyze --params '{"action":"summary","filePath":"/tmp/base.heapsnapshot"}'
agent-pilot devtools heap-analyze --params '{"action":"compare","baseFilePath":"/tmp/base.heapsnapshot","currentFilePath":"/tmp/current.heapsnapshot"}'

# One-shot V8 heap snapshot (top constructors + Detached DOM nodes) or forced Garbage Collection
agent-pilot heap snapshot [--max-constructors 25] [--tab 12345]
agent-pilot heap gc [--tab 12345]

# Native extension-debugger tabs return HEAPPROFILER_UNAVAILABLE; no metrics
# fallback baseline is created. Isolated tabs support real baseline/diff files.

# All-in-one DevTools snapshot (Console errors, failed Network requests, Web Vitals, DOM health, diagnostics)
agent-pilot devtools [--tab 12345]
```

CSS inspection defaults to a compact summary. Use `agent-pilot devtools css --params '{"selector":"#app","detail":"computed","groups":["layout","typography"]}'` for targeted values, `detail:"rules"` with `includeInherited:true` for paginated cascade declarations, or `detail:"full"` only for the complete payload.

---

## 8. Batch Automation (`batch`)

Execute an ordered sequence of browser actions in a single atomic network round-trip, saving ~80% context tokens and eliminating network round-trips. Any `screenshot` step in the batch with `path` (or `savePath`) is automatically saved to disk and its raw `dataUrl` is stripped from the JSON response (unless `base64: true`):

```bash
agent-pilot batch ./workflows/login-flow.json
agent-pilot batch ./skills/agent-pilot/examples/step-recording-booking-flow.json
```

### Batch Script Format (`flow.json`):
```json
{
  "actions": [
    { "type": "open", "url": "https://example.com/login", "username": "staging", "password": "secret" },
    { "type": "wait_for_selector", "selector": "#username", "timeout": 5000 },
    { "type": "fill_form", "fields": [
      { "selector": "#username", "value": "tester@example.com" },
      { "selector": "#password", "value": "Secret123!" },
      { "selector": "[role='checkbox']", "value": true }
    ]},
    { "type": "upload", "selector": "input[type='file']", "files": ["/tmp/sample.png"], "via": "auto" },
    { "type": "click", "selector": "#btn-submit" },
    { "type": "sleep", "ms": 1000 },
    { "type": "screenshot", "mode": "visible", "path": "/tmp/step-login.png", "step": 1, "title": "Login Completed", "highlightSelector": "#dashboard" },
    { "type": "close" }
  ]
}
```

---

## 9. Visual UI Feedback Studio (`feedback`)

Query and interact with the 3-Channel Visual UI Feedback System:

```bash
# List pending human feedback sessions from ~/.agent-pilot/inbox/feedback/
agent-pilot feedback list

# Long-poll and reactively wait for user to submit feedback in the browser
agent-pilot feedback wait 120
```

---

## 10. Server & MCP Utilities

```bash
# Start standalone bridge server in foreground (default port 58765)
agent-pilot server [--port 58765]

# Start MCP server over stdio for AI Agents
agent-pilot mcp

# Export all MCP JSON tool schemas to target directory
agent-pilot export-mcp ./mcp/agent-pilot
```

---

## 11. Skill Installation (`skill install`)

Install this `agent-pilot` skill directly from the standalone binary (the skill files are embedded at build time — no repository clone or Node.js required):

```bash
# Default: install to ~/.agents/skills/agent-pilot
agent-pilot skill install

# Install into the Antigravity skills root ~/.gemini/config/skills/agent-pilot
agent-pilot skill install --agy
agent-pilot skill install --antigravity

# Custom skills root (the skill folder is created inside it)
agent-pilot skill install --path ~/my-skills

# Overwrite an existing installation
agent-pilot skill install --force
```

| Flag | Description |
| :--- | :--- |
| `--path <dir>` | Skills root directory (default `~/.agents/skills`; `~` is expanded) |
| `--agy`, `--antigravity` | Use `~/.gemini/config/skills` as the skills root |
| `--force`, `-f` | Overwrite the existing `agent-pilot` skill folder |

Notes:
- Without `--force`, an existing `agent-pilot` folder is left untouched and the command exits with an error.
- Running `agent-pilot skill` (no subcommand) is treated as `agent-pilot skill install`.
- The installed folder mirrors `skills/agent-pilot/` (`SKILL.md`, `references/`, `examples/`).
