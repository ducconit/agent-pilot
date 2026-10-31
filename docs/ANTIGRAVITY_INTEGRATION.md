# 🚀 Antigravity-First Integration Guide (Agent Pilot)

**Agent Pilot** is engineered with an **Antigravity-First** philosophy, empowering Google Antigravity AI coding and automation agents to "see", "understand", and "drive" developers' browsers safely, accurately, and intuitively.

---

## 1. Antigravity & Agent Pilot Architectural Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HOST WORKSTATION                               │
│                                                                             │
│  ┌───────────────────────────┐                ┌──────────────────────────┐  │
│  │   Antigravity AI Agent    │                │  Developer / QA Tester   │  │
│  │   (Coding Assistant)      │                │  (Direct Observer)       │  │
│  └─────────────┬─────────────┘                └────────────┬─────────────┘  │
│                │                                           │                │
│                │ 1. Dispatches JSON Actions                │ Observes neon  │
│                │    via CLI or MCP                         │ cursor & logs  │
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

## 2. Agent Control Protocol (ACP) - JSON Action Schema

Antigravity generates structured JSON action pipelines executed sequentially by Agent Pilot:

### Action Pipeline Example:
```json
[
  {
    "action": "navigate",
    "url": "http://localhost:3000/dashboard"
  },
  {
    "action": "wait",
    "ms": 1000
  },
  {
    "action": "mouse_move",
    "x": 380,
    "y": 240,
    "duration": 400
  },
  {
    "action": "mouse_click",
    "x": 380,
    "y": 240
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
]
```

### Supported Actions:
| Action | Parameters | Description |
| :--- | :--- | :--- |
| `navigate` | `url` (string) | Navigates the target tab to URL |
| `wait` | `ms` (number) | Pauses execution for millisecond duration |
| `mouse_move` | `x`, `y`, `duration` (ms) | Moves virtual cursor smoothly along Bezier curve to coordinates |
| `mouse_click` | `x`, `y`, `via?` ("synthetic" \| "cdp" \| "auto") | Emits ripple effect and DOM click cascade; `via: "cdp"` issues trusted click (required for cross-origin iframes, Canvas, WebGL) |
| `mouse_drag` | `from`/`to` (selector) or `fromX/fromY/toX/toY`, `steps?`, `holdMs?`, `via?` | Drag-and-drop gesture; use coordinates + `via: "cdp"` for canvas games |
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

### 3.3. Key MCP Tools Provided to AI Agents (51 Tools):
1. `browser_open_tab(url, active)`: Opens a new tab (defaults to background to preserve developer focus; groups into `🤖 Agent Pilot`).
2. `browser_list_tabs()`: Lists all tabs and isolation states.
3. `browser_navigate(url, tabId)`: Navigates specified or active tab.
4. `browser_click(x, y, selector, via)`: Moves virtual cursor and clicks element or coordinates. Add `via: "cdp"` for trusted input.
5. `browser_drag(from, to, fromX, fromY, toX, toY, steps, holdMs, via)`: Drags between elements or coordinates.
6. `browser_type(selector, text, clear, pressEnter)`: Human-like typing into form fields.
7. `browser_scroll(deltaX, deltaY)`: Smooth horizontal and vertical scrolling.
8. `browser_get_element(selector)`: Extracts bounding boxes, dimensions, CSS selectors, and XPath.
9. `browser_screenshot(mode, tabId)`: Captures screenshots (including background tabs via CDP).
10. `browser_get_devtools_data(tabId, type, limit, clear)`: Retrieves console logs, network requests, and performance metrics (JS Heap, DOM nodes).
11. `browser_pick_color(x, y)`: Extracts pixel colors across 5 formats (HEX, RGB, RGBA, HSL, OKLCH).
12. `browser_run_actions(actions, tabId, stopOnError)`: Batch execution engine executing multiple actions in one round-trip, saving 80%+ latency and tokens.
13. `browser_wait_for_feedback(timeout, tabId)`: Long-polls for human visual feedback submitted via In-Page Feedback Studio.

> 📝 *The full tool suite comprises 51 tools, detailed in [Advanced DevTools](DEVTOOLS.md).*

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
const info = window.__AGENT_PILOT__.getElement("#submit-button");
console.log("Element bounds:", info.rect);

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
