# 🏛️ Agent Pilot System Architecture
**Version**: v1.3.0<br/>
**Mission**: Provide a comprehensive, ultra-low latency, focus-preserving browser control interface for AI Coding Agents (Antigravity-First), featuring dual-engine DOM/CDP execution and rich visual feedback.<br/>
**Maintainer**: DNT ([github.com/ducconit](https://github.com/ducconit))

---

## 1. 🌐 End-to-End Multi-Tier Architecture

Agent Pilot establishes a secure, bidirectional, closed-loop bridge between AI Coding Agents (Google Antigravity, Claude Code, Cursor, OpenCode) and the Chromium browser:

```mermaid
flowchart TB
    subgraph AgentLayer["🤖 1. AI AGENT TIER"]
        Agent["<b>AI Coding Agent</b><br/>(Google Antigravity / Claude Code / Cursor)"]
    end

    subgraph BridgeLayer["🌉 2. BRIDGE & CLI TIER (GOLANG STANDALONE ENGINE)"]
        direction TB
        ServerEntry["<b>Agent Pilot Engine (cli/agent-pilot)</b><br/>Port 58765 (Local Loopback 127.0.0.1)"]
        DualMode{"<b>Dual Mode Engine</b><br/>Port Busy?"}
        Master["<b>Master Mode</b><br/>Binds WebSocket ws://127.0.0.1:58765"]
        Forwarder["<b>Forwarder Mode</b><br/>Forwards Stdio to HTTP POST /api"]
        VerifyClient["<b>verifyClient Security Guard</b><br/>Validates Origin: chrome-ext & localhost"]
        ServerRedactor["<b>Secret Redaction Filter</b><br/>Masks 12 Key Patterns with *"]
        InboxFS["<b>Local Inbox Storage</b><br/>~/.agent-pilot/inbox/feedback/"]
    end

    subgraph ExtensionLayer["🧩 3. CHROME EXTENSION TIER (MANIFEST V3)"]
        direction TB
        SW["<b>Background Service Worker (background.js)</b>"]
        WSClient["<b>Bridge Client</b><br/>(bridge-client.js)"]
        TabMgr["<b>Tab & Lock Manager</b><br/>(tab-manager.js)<br/>• Tab Groups '🤖 Agent Pilot'<br/>• runWithTabLock"]
        CDPMgr["<b>CDP Manager</b><br/>(cdp-manager.js)<br/>• chrome.debugger (v1.3)<br/>• Console, Network, Perf"]
        BatchExec["<b>Batch Executor</b><br/>(batch-executor.js)<br/>• Single Tool Call<br/>• omitDataUrls RAM Guard"]
        ShotSvc["<b>Screenshot Service</b><br/>(screenshot-service.js)<br/>• CDP Screen Capture<br/>• OffscreenCanvas Crop"]
        ClientRedactor["<b>Secret Sanitizer Layer</b><br/>(secret-sanitizer.js)<br/>• WeakSet Anti-Recursion"]
        SidePanel["<b>Side Panel UI</b><br/>(sidepanel.html/js)<br/>• Agent Monitor & Inspector<br/>• Screenshot Studio & Loupe"]
    end

    subgraph PageLayer["🖥️ 4. WEB PAGE & DOM TIER"]
        direction TB
        MainWorld["<b>Main World Bridge</b><br/>(main-world-bridge.js)<br/>Exposes window.__AGENT_PILOT__"]
        ContentScripts["<b>Isolated World Content Scripts</b>"]
        CursorSim["<b>Virtual Mouse Cursor</b><br/>(cursor-simulator.js)<br/>Cubic Ease-Out & Ripple"]
        LockShield["<b>Human Lock Shield</b><br/>(lock-shield.js)<br/>Prevents Human Interference"]
        DOMInspector["<b>DOM Inspector & Loupe</b><br/>(dom-inspector.js, eyedropper.js)"]
        FeedbackHUD["<b>Feedback Studio HUD & Pinned Layer</b><br/>(feedback-studio/*)<br/>Pins, Rect Boxes, Source Detection"]
        TargetDOM["<b>Target Web Page DOM</b><br/>(React / Vue / Astro / HTML)"]
    end

    %% Communication Links
    Agent -->|Stdio MCP JSON-RPC| ServerEntry
    Agent -.->|Direct HTTP POST /api| ServerEntry
    ServerEntry --> DualMode
    DualMode -->|No: First Process| Master
    DualMode -->|Yes: Port In Use| Forwarder
    Master --> VerifyClient
    VerifyClient -->|WebSocket Handshake| WSClient
    Forwarder -.->|HTTP POST /api| Master

    WSClient <--> SW
    SW --> TabMgr
    SW --> CDPMgr
    SW --> BatchExec
    SW --> ShotSvc
    SW --> ClientRedactor
    SW <--> SidePanel

    CDPMgr -->|chrome.debugger CDP Commands| TargetDOM
    ShotSvc -->|Page.captureScreenshot / OffscreenCanvas| TargetDOM
    TabMgr -->|Dynamic Script Injection| ContentScripts
    TabMgr -->|chrome.tabs.sendMessage| ContentScripts

    ContentScripts --> CursorSim
    ContentScripts --> LockShield
    ContentScripts --> DOMInspector
    ContentScripts --> FeedbackHUD

    CursorSim -->|Synthetic DOM Events| TargetDOM
    LockShield -->|Intercepts Pointer Events| TargetDOM
    DOMInspector -->|Extracts Selector/XPath/CSS| TargetDOM
    FeedbackHUD -->|Pins & Pinned Layer| TargetDOM

    MainWorld <-->|CustomEvent __AGENT_PILOT_REQ/RES__| ContentScripts
    FeedbackHUD -->|Channel B: Save Session| Master
    Master --> InboxFS
    Master --> ServerRedactor
```

---

## 2. ⏱️ Sequence Diagram: Agent Execution Lifecycle

The diagram below details the end-to-end execution flow when an AI Agent sends an interaction command (e.g. `browser_click` or `browser_run_actions`):

```mermaid
sequenceDiagram
    autonumber
    actor Agent as 🤖 AI Agent (Antigravity)
    participant Server as 🌉 Bridge Server (58765)
    participant Ext as 🧩 Extension Background
    participant Tab as 📑 Tab & Lock Manager
    participant Content as 📄 Content Script
    participant CDP as ⚡ Chrome DevTools (CDP)
    participant DOM as 🌐 Web Page DOM

    Note over Agent,Server: 1. INITIALIZE & DISPATCH COMMAND
    Agent->>Server: MCP call: browser_click({ selector: "#submit-btn", tabId: 101 })
    Server->>Server: Validate active client (activeClientId)
    Server->>Ext: WebSocket JSON-RPC: { id: 42, method: "page.click", params: { ... } }

    Note over Ext,Tab: 2. SESSION MUTEX (TAB LOCK)
    Ext->>Tab: runWithTabLock(101, "click")
    Tab->>Content: chrome.tabs.sendMessage("SET_BUSY", { busy: true, action: "AI Click" })
    Content->>DOM: Render neon border & action pill (Subtle indicator, pointer-events: none)

    Note over Ext,Content: 3. VIRTUAL CURSOR & DOM INTERACTION
    Ext->>Content: chrome.tabs.sendMessage("simulate_click", { selector: "#submit-btn" })
    Content->>DOM: querySelector("#submit-btn") & getBoundingClientRect()
    Content->>DOM: Move virtual neon cursor smoothly (Cubic Ease-Out)
    Content->>DOM: Emit click-ripple animation & (X, Y) coordinate badge
    Content->>DOM: Dispatch DOM event cascade: pointerdown -> mousedown -> pointerup -> mouseup -> click
    DOM-->>Content: Click event successfully handled
    Content-->>Ext: { success: true, clicked: true, point: { x: 350, y: 220 } }

    Note over Ext,Tab: 4. RELEASE LOCK & SANITIZE SENSITIVE DATA
    Tab->>Content: chrome.tabs.sendMessage("SET_BUSY", { busy: false })
    Content->>DOM: Hide neon border & action indicator pill
    Ext->>Ext: sanitizeData(result) -> Scan 12 secret & private key patterns
    Ext-->>Server: WebSocket Response: { id: 42, result: { ... }, secretFilterEnabled: true }
    Server->>Server: sanitizeServerData(result) (Second security defense layer)
    Server-->>Agent: MCP Tool Response: { success: true, clicked: true }
```

---

## 3. 🎨 3-Channel Visual Feedback Architecture

The system provides 3 bidirectional communication channels between human developers/QA testers and AI agents:

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Human Tester / Dev
    participant HUD as ✏️ Feedback Studio (In-Page HUD)
    participant Ext as 🧩 Extension Background
    participant Server as 🌉 Bridge Server (58765)
    participant Inbox as 💾 Local Inbox (~/.agent-pilot)
    actor Agent as 🤖 AI Agent (Antigravity)

    alt CHANNEL A: Reactive Long-Polling (Live Agent Push)
        Agent->>Server: browser_wait_for_feedback({ timeout: 120 })
        Server-->>Server: Hold pending waiter (pendingFeedbackWaiters)
        User->>HUD: Select element / Pin region & Click "🚀 Send to Agent"
        HUD->>Ext: chrome.runtime.sendMessage("FEEDBACK_PUSH_AGENT", payload)
        Ext->>Server: POST /api/feedback/wait (resolve pending waiter)
        Server->>Inbox: Save session.json + item_*.png
        Server-->>Agent: Immediate return (Component source, line, selector, note, images)
        Agent->>Agent: Automatically patch code at specified file & line
    else CHANNEL B: Persistent Shared Inbox
        User->>HUD: Select multiple regions / components & Click "💾 Save to Inbox"
        HUD->>Server: POST /api/feedback/save (session payload)
        Server->>Inbox: Write session.json, clean prompt.md (no base64), PNG files
        Note over Agent,Inbox: Agent checks feedback when idle or prompted
        Agent->>Server: browser_get_pending_feedback({ limit: 5 })
        Server->>Inbox: Read latest timestamped session directories
        Server-->>Agent: Return session list with Markdown prompt & image file paths
    else CHANNEL C: 1-Click Clipboard Prompt
        User->>HUD: Select region & Click "📋 Copy Prompt"
        HUD->>User: Write standardized Markdown format to System Clipboard
        User->>Agent: Paste (Ctrl+V) into any AI chat window
    end
```

---

## 4. 🛡️ Security Mechanisms & Defense-in-Depth

1. **WebSocket Origin Guard (`verifyClient`)**:
   - Parses incoming request origins via standard URL parsing (`new URL(origin).hostname`).
   - Strictly allowlists: `chrome-extension://`, `127.0.0.1`, and `localhost`.
   - Completely prevents Cross-Site WebSocket Hijacking (CSWSH) from malicious websites the user might browse.
2. **Dual-Layer Secret Redaction**:
   - Automatically detects and masks with asterisks `*` across 12 credential types (OpenAI, Anthropic, Gemini, AWS, Stripe, GitHub, Slack, JWT, Bearer tokens, RSA/SSH/PGP private keys, URL parameters, and sensitive JSON keys).
   - Defends against infinite recursion using a `WeakSet` (`[Circular]`).
   - Redacts at the Service Worker level before network transmission and redundantly at the Go server level before returning payloads to LLMs.
3. **Strict Isolation Between Main World & Content Script**:
   - `main-world-bridge.js` runs in the webpage context (`world: "MAIN"`), exposing `window.__AGENT_PILOT__` without any `chrome.*` privilege.
   - Communicates with the extension strictly via custom DOM events (`__AGENT_PILOT_REQ__` and `__AGENT_PILOT_RES__`).
4. **Tab-Level Mutex Lock**:
   - `runWithTabLock` serializes concurrent operations, preventing race conditions between parallel agent commands and user input on the same tab.
5. **Bridge Trust Model**:
   - The Bridge binds strictly to `127.0.0.1:58765`. Its origin allowlist permits `localhost`, `127.0.0.1`, and `chrome-extension://`. However, it does not require an authentication token; any local process on the machine can connect. Run only trusted local software and never expose this port to an external network.
