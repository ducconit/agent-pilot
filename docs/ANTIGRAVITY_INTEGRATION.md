# 🤖 AI Agent Integration Guide (Skills + CLI & MCP)

**Agent Pilot** is a universal browser controller designed to work seamlessly with **any AI coding agent or automation tool** that supports either:
1. **Agent Skills + Command Line (CLI)** (`skills.sh` + shell execution)
2. **Model Context Protocol (MCP)** (`mcpServers` JSON configuration)

Compatible agents & tools include **Claude Code**, **Cursor**, **Windsurf**, **Google Antigravity**, **Cline / Roo Code**, **OpenCode**, **Codex**, **Aider**, **Zed**, and any custom LLM agent with terminal or MCP capabilities.

---

## 1. Dual Integration Modes

### Mode A: Agent Skills + Command Line (CLI) — Recommended for Token Efficiency
Any AI agent capable of reading markdown skill instructions (`SKILL.md`) and executing terminal commands can control Chrome via the standalone `agent-pilot` CLI binary:

```bash
# 1. Install the Agent Skill globally across all detected AI tools
npx skills add https://github.com/ducconit/agent-pilot -g --all

# Or use the built-in CLI installer:
agent-pilot install-skill --all
```

Once installed, the agent automatically learns how to run compact CLI commands (`agent-pilot open`, `agent-pilot snapshot`, `agent-pilot click`, `agent-pilot screenshot`) without loading heavy tool schemas into its context window.

### Mode B: Model Context Protocol (MCP) Server
For MCP-enabled IDEs and desktop clients, Agent Pilot includes a built-in stdio MCP server exposing 68 browser & DevTools tools:

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

| AI Agent / Tool | Supported Modes | Configuration File / Command |
| :--- | :--- | :--- |
| **Claude Code** | Skills + CLI, MCP | `npx skills add ...` or `claude mcp add agent-pilot -- agent-pilot mcp` |
| **Cursor** | Skills + CLI, MCP | `.cursor/mcp.json` or `~/.cursor/mcp.json` |
| **Windsurf** | Skills + CLI, MCP | `~/.codeium/windsurf/mcp_config.json` |
| **Google Antigravity** | Skills + CLI, MCP | `~/.gemini/config/mcp_config.json` or `skills/` |
| **Cline / Roo Code** | Skills + CLI, MCP | VS Code MCP Settings JSON |
| **OpenCode / Codex** | Skills + CLI, MCP | `npx skills add ...` or project MCP config |

---

## 2. Architectural Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HOST WORKSTATION                               │
│                                                                             │
│  ┌───────────────────────────┐                ┌──────────────────────────┐  │
│  │     Any AI Coding Agent   │                │  Developer / QA Tester   │  │
│  │ (Claude/Cursor/Antigravity│                │  (Direct Observer)       │  │
│  └─────────────┬─────────────┘                └────────────┬─────────────┘  │
│                │                                           │                │
│                │ 1. Dispatches Commands                    │ Observes neon  │
│                │    via Skills+CLI or MCP                  │ cursor & logs  │
│                ▼                                           ▼                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                 CHROME BROWSER (AGENT PILOT EXTENSION)                │  │
│  │                                                                       │  │
│  │  ┌────────────────────────┐            ┌───────────────────────────┐  │  │
│  │  │  Side Panel Controller │◄──────────►│ Background Service Worker │  │  │
│  │  │  - JSON Action Runner  │            │ - Chrome DevTools (CDP)   │  │  │
│  │  │  - Live Monitor UI     │            │ - Tab & Screenshot Engine │  │  │
│  │  └───────────┬────────────┘            └─────────────┬─────────────┘  │  │
│  │              │                                       │                │  │
│  │              ▼                                       ▼                │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Web Tab (Localhost / Web Application)                           │  │  │
│  │  │ - Smooth virtual neon cursor trajectory (X, Y)                  │  │  │
│  │  │ - Click ripple effects & automated form input                   │  │  │
│  │  │ - DOM bounding box & framework source extraction                │  │  │
│  │  │ - window.__AGENT_PILOT__ in-page API                            │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Agent Control Protocol (ACP) - JSON Action Schema

Antigravity generates structured JSON action pipelines executed sequentially by Agent Pilot:

### Action Pipeline Example:
```json
{
  "actions": [
    {
      "action": "navigate",
      "url": "http://localhost:3000/dashboard"
    },
    {
      "action": "wait",
      "ms": 1000
    },
    {
      "action": "hover",
      "selector": "input[name='search']"
    },
    {
      "action": "click",
      "selector": "input[name='search']"
    },
    {
      "action": "type",
      "selector": "input[name='search']",
      "text": "Antigravity Browser Control"
    },
    {
      "action": "scroll",
      "deltaY": 400
    },
    {
      "action": "screenshot",
      "mode": "visible"
    }
  ],
  "stopOnError": true
}
```

### Supported Actions:
| Action | Parameters | Description |
| :--- | :--- | :--- |
| `navigate` | `url` (string) | Navigates the target tab to URL |
| `wait` | `ms` (number) | Pauses execution for millisecond duration |
| `hover` | `selector` (string) or `x`, `y` | Moves virtual cursor smoothly / hovers element or coordinates |
| `click` | `selector?`, `x?`, `y?`, `via?` ("synthetic" \| "cdp" \| "auto") | Emits ripple effect and DOM click cascade; `via: "cdp"` issues trusted click (required for cross-origin iframes, Canvas, WebGL) |
| `drag` | `from`/`to` (selector) or `fromX/fromY/toX/toY`, `steps?`, `holdMs?`, `via?` | Drag-and-drop gesture; use coordinates + `via: "cdp"` for canvas games |
| `type` | `selector` (string), `text` (string) | Focuses input element and types text sequentially |
| `scroll` | `deltaX`, `deltaY` (px) | Smooth scrolling along X/Y axes |
| `screenshot` | `mode` ("visible" \| "element" \| "region" \| "full") | Triggers screenshot engine |

---

## 3. WebSocket Bridge & Model Context Protocol (MCP) Server (Port 58765)

Agent Pilot operates a dual **Model Context Protocol (MCP)** and **WebSocket** bridge server on private IANA port **`58765`** (`49152 – 65535`, avoiding port collisions with standard development servers).

### 3.1. Starting the Bridge Server
```bash
# Using the Go standalone binary (recommended):
agent-pilot server

# Or via npm script:
npm run server

# Or with custom port:
AGENT_PILOT_PORT=58765 agent-pilot server
```

### 3.2. Configuring Antigravity MCP Server
Add the following configuration to your Antigravity MCP settings (`~/.gemini/config/mcp_config.json` or project MCP config) to grant agents complete browser control:

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

### 3.3. Key MCP Tools Provided to AI Agents (68 Tools):
1. `browser_open_tab(url, active)`: Opens a new tab (defaults to background to preserve developer focus; groups into `🤖 Agent Pilot`).
2. `browser_list_tabs()`: Lists all tabs and isolation states.
3. `browser_navigate(url, tabId)`: Navigates specified or active tab.
4. `browser_click(x, y, selector, via)`: Moves virtual cursor and clicks element or coordinates. Add `via: "cdp"` for trusted input.
5. `browser_drag(from, to, fromX, fromY, toX, toY, steps, holdMs, via)`: Drags between elements or coordinates; use `via: "cdp"` + `holdMs` for slingshot mechanics.
6. `browser_type(selector, text, clear, pressEnter)`: Human-like typing into form fields.
7. `browser_scroll(deltaX, deltaY)`: Smooth horizontal and vertical scrolling.
8. `browser_get_element(selector)`: Extracts bounding boxes, dimensions, CSS selectors, and XPath.
9. `browser_screenshot(mode, tabId)`: Captures screenshots (including background tabs via CDP).
10. `browser_get_devtools_data(tabId, type, limit, clear)`: Retrieves console logs, network requests, and performance metrics (JS Heap, DOM nodes).
11. `browser_pick_color(x, y)`: Extracts pixel colors across 5 formats (HEX, RGB, RGBA, HSL, OKLCH).
12. `browser_list_instances()`: Lists all connected Chrome browser instances across ports.
13. `browser_select_instance(instanceId)`: Targets a specific browser instance in multi-browser setups.
14. `browser_start_session(name, tabId)`: Starts an active agent session on the target tab, keeping the virtual cursor and neon status shield continuously visible.
15. `browser_end_session(tabId, closeTab)`: Ends the active agent session, dismissing the cursor and visual shield (optionally closing the tab).
16. `browser_set_busy(busy, action)`: Displays subtle glowing neon border and floating status pill with unlock control during complex operations.
17. `browser_handle_dialog(accept, promptText, tabId)`: Handles JavaScript alert/confirm/prompt dialogs using CDP `Page.handleJavaScriptDialog`.
18. `browser_resize_page(width, height, deviceScaleFactor, mobile, tabId)`: Dynamically resizes the target page viewport using CDP `Emulation.setDeviceMetricsOverride`.
19. `browser_run_actions(actions, tabId, stopOnError)`: Batch execution engine executing multiple actions in one round-trip, saving 80%+ latency and tokens.
20. `browser_get_pending_feedback(limit, sessionId, clear)`: Retrieves human UI feedback sessions recorded via Feedback Studio stored in local inbox.
21. `browser_wait_for_feedback(timeout, tabId)`: Long-polls for human visual feedback submitted via In-Page Feedback Studio (Channel A live push).

> 📝 *The full tool suite comprises 68 tools, detailed in [Advanced DevTools](DEVTOOLS.md).*

---

## 4. In-Page Bridge API (`window.__AGENT_PILOT__`)

The extension automatically exposes `window.__AGENT_PILOT__` in the page context for direct programmatic automation:

```javascript
// Move virtual cursor to (500, 300) over 350ms
await window.__AGENT_PILOT__.moveMouse(500, 300, 350);

// Perform click with ripple effect
await window.__AGENT_PILOT__.click(500, 300);

// Type text into form input
await window.__AGENT_PILOT__.type("#username-field", "admin@antigravity.ai");

// Inspect element geometry
const info = await window.__AGENT_PILOT__.getElement("#submit-button");
console.log("Element bounds:", info?.rect);

// Pick pixel color
const color = await window.__AGENT_PILOT__.pickColor();
console.log("Color codes:", color.hex, color.rgb, color.rgba, color.hsl, color.oklch);
```

---

## 5. Antigravity Autonomous Debugging Workflow

1. **Start Dev Server**: Antigravity spins up local application server (`http://localhost:3000`).
2. **Launch Target Tab**: Agent opens background tab via Agent Pilot.
3. **Attach CDP Diagnostics**: Agent Pilot monitors `console.error` and HTTP 4xx/5xx network failures.
4. **Simulate User Journey**: Neon cursor clicks buttons, completes forms, and exercises application flows.
5. **Collect Diagnostics & Auto-Remediate**: On runtime exceptions, Agent Pilot captures viewport screenshots, stack traces, and framework component sources (`fileName:lineNumber`) for autonomous root-cause remediation.
