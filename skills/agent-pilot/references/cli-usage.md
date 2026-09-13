# Agent Pilot - CLI Usage & Command Reference

The `agent-pilot` standalone binary is a zero-dependency CLI written in Go for controlling web browsers, executing batch automation workflows, managing background services, and running MCP servers.

---

## 1. Global Flags & Conventions

- **Default Port**: `58765` (WebSocket: `ws://127.0.0.1:58765`, HTTP: `http://127.0.0.1:58765`)
- **Target Tab (`--tab <id>`)**: By default, CLI commands target the active browser tab or the most recently controlled agent tab. Specify `--tab <id>` to explicitly target a specific tab.
- **Output Format**: Commands output user-friendly icons (`✅`, `❌`, `🌐`) with structured JSON results where applicable.

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

## 4. Browser Navigation & Tabs

```bash
# Open a new URL in background (active=false by default to prevent stealing user focus)
agent-pilot open https://example.com

# Open URL and make it the active tab
agent-pilot open https://example.com --active

# List all open tabs across all browser windows
agent-pilot tabs
```

---

## 5. Web Interactions (`click`, `type`, `inspect`)

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

# Inspect DOM element details (rect, selector, XPath, text, computed CSS)
agent-pilot inspect "#product-card"
```

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

## 7. Screenshots (`screenshot`)

Capture high-resolution PNG screenshots via Chrome DevTools Protocol:

```bash
# Capture visible viewport
agent-pilot screenshot -o ./viewport.png

# Capture specific element
agent-pilot screenshot --mode element --selector ".hero-banner" -o ./banner.png

# Capture specific screen region
agent-pilot screenshot --mode region -o ./region.png
```

---

## 8. Batch Automation (`batch`)

Execute an ordered sequence of browser actions in a single atomic network round-trip, saving ~80% context tokens and eliminating network round-trips:

```bash
agent-pilot batch ./workflows/login-flow.json
```

### Batch Script Format (`flow.json`):
```json
{
  "actions": [
    { "type": "open", "url": "https://example.com/login" },
    { "type": "wait_for_selector", "selector": "#username", "timeout": 5000 },
    { "type": "type", "selector": "#username", "text": "tester@example.com" },
    { "type": "type", "selector": "#password", "text": "Secret123!" },
    { "type": "click", "selector": "#btn-submit" },
    { "type": "sleep", "ms": 1000 },
    { "type": "screenshot", "mode": "visible" }
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

# Export all 19 MCP JSON tool schemas to target directory
agent-pilot export-mcp ./mcp/agent-pilot
```
