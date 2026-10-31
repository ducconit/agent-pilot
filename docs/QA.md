# ❓ Questions & Answers (Q&A)

This document answers the most frequently asked questions regarding **Agent Pilot**, covering general architecture, AI assistant integration, and practical Web QA testing workflows.

::: info Stability First Notice
Agent Pilot is fully feature-complete for end-to-end browser automation, visual QA/QC, and deep web debugging. Future development focuses on stability and compatibility rather than adding new features.
:::

---

## 1. General & Architecture Questions

### Q1: What makes Agent Pilot different from standard Chrome MCP?

Standard Chrome MCP servers typically run in a standalone browser window, steal your active mouse/keyboard focus, produce verbose DOM trees that consume massive context tokens, and require AI agents to generate ad-hoc Python scripts (`Pillow`/`OpenCV`) to draw boxes on screenshots.

**Agent Pilot** solves these challenges by:
1. **Zero Focus Stealing**: Operates inside your existing Chrome browser in an isolated background tab group (`🤖 Agent Pilot`), preserving your active profile and login sessions.
2. **Token Efficiency**: Replaces heavy DOM trees with compact interactive references (`@1`, `@2`...), supporting inline wait flags (`--wait-for`, `--include-snapshot`) and batch execution.
3. **Built-in Visual QA**: Directly produces annotated screenshots with red highlight boxes and title banners without writing temporary Python scripts.
4. **Deep Web Diagnostics**: Native Lighthouse audits, V8 Heap Snapshot memory leak analysis, MP4 workflow video recording, and 1-click Playwright test export.

---

### Q2: Does Agent Pilot require paid subscriptions or separate API keys?

**No.** Agent Pilot is 100% free and open-source under the MIT License. The local Go CLI binary and Chrome extension run entirely on your local machine with zero telemetry or cloud subscription fees.

---

### Q3: Which browsers are supported?

Agent Pilot supports Google Chrome (Manifest V3) as its primary target. It is also fully compatible with Chromium-based browsers that support the Chrome Side Panel API and Manifest V3 extensions, including:
- **Google Chrome** (v116+)
- **Brave Browser**
- **Microsoft Edge**

---

### Q4: How does Agent Pilot achieve >50% context token reduction?

Token reduction is achieved through three key architectural decisions:
1. **Interactive Snapshot References**: Instead of sending thousands of lines of raw HTML, the DOM is pruned into an accessibility-focused tree with short numeric references (`@1` for search box, `@2` for submit button).
2. **Inline Wait & Snapshot Flags**: Interaction commands (`click`, `type`, `navigate`) accept `--wait-for <selector>` and `--include-snapshot`. This collapses three round-trips into a single atomic call.
3. **Dual Interface Routing**: The standalone CLI outputs concise JSON (`--format json`), avoiding verbose JSON-RPC schema overhead inherent to standard MCP servers.

---

### Q5: Can Agent Pilot test pages requiring login credentials or 2FA?

**Yes.** Because Agent Pilot operates directly inside your active Chrome browser profile, it inherits all existing cookies, session storage, and authenticated logins. Your AI agent can test authenticated dashboards without needing raw passwords or 2FA codes passed in prompts.

---

## 2. AI Assistant Integration Questions

### Q6: When should I choose the OS Release Bundle vs `npx skills add`?

- **OS Release Bundle (Recommended)**: Best for permanent daily workstation setup. It contains only the native binary for your operating system (minimal disk usage), an automated 1-step installer script (`./install.sh` or `.\install.ps1`), and auto-configures your background daemon (`systemd` / `launchd` / Windows service).
- **`npx skills add`**: Best for rapid bootstrapping across AI coding agents (Claude Code, Cursor, Windsurf, Antigravity, OpenCode, Codex). It installs in one command, but because it is multi-platform, it includes pre-compiled binaries for **all 3 operating systems** inside `skills/agent-pilot/scripts/`.

---

### Q7: When should I use `--via cdp` instead of default synthetic events?

By default, Agent Pilot uses fast synthetic DOM events (with neon cursor overlays). You should specify `--via cdp` when:
1. Interacting with cross-origin `<iframe>` elements.
2. Clicking or dragging inside HTML5 `<canvas>` elements, WebGL scenes, or Unity games.
3. Requiring trusted hardware-level input events.

*(Tip: Use `--via auto` to attempt CDP first and automatically fall back to synthetic events if a debugger cannot attach).*

---

### Q8: How does Agent Pilot handle multiple AI agents operating concurrently?

Agent Pilot isolates tabs by a numeric `tabId`. When an agent opens a tab via `agent-pilot open` or `browser_open_tab`, it receives a unique `tabId`. By passing this `tabId` to subsequent calls, multiple agents (or multiple subagent threads) can operate concurrently in separate tabs without cross-tab interference.

---

## 3. Web QA & Testing Workflows

### Q9: How do I capture an annotated screenshot for a bug report?

You can capture a screenshot with an element highlighted and a title banner in a single command:

```bash
# Highlight element @1 with a red bounding box and add a title banner
agent-pilot screenshot -o bug-report.png --highlight "@1" --title "Issue #402: Checkout Button Overlap" --tab 12345
```

Or via MCP:
```json
{
  "tool": "page_screenshot",
  "arguments": {
    "tabId": 12345,
    "highlightSelector": "#checkout-btn",
    "title": "Issue #402: Checkout Button Overlap",
    "mode": "visible"
  }
}
```

---

### Q10: How do I export an interaction session to Playwright TypeScript?

After recording an interaction flow or performing actions, export the recorded session:

- **Via MCP**:
  ```json
  { "tool": "browser_recorder_export", "arguments": {} }
  ```
  This returns clean, ready-to-run Playwright TypeScript code with auto-waiting assertions.
- **Via CLI**:
  ```bash
  agent-pilot recorder export > flow.spec.ts
  ```

---

### Q11: How do I diagnose Memory Leaks using V8 Heap Snapshots?

Agent Pilot can capture baseline and post-interaction V8 Heap Snapshots, computing a diff to identify uncollected objects:

```bash
# 1. Take baseline snapshot before user interaction
agent-pilot devtools heap-snapshot baseline.heapsnapshot --tab 12345

# 2. Perform repetitive interaction (e.g. open/close modal 10 times)
agent-pilot batch test-modal-cycle.json

# 3. Take second snapshot and inspect heap diff
agent-pilot devtools heap-snapshot post-cycle.heapsnapshot --tab 12345
```

---

### Q12: How do I record an MP4 workflow video with a virtual cursor?

To record a visual demonstration with neon cursor motion and click ripples:

```bash
# Start recording
agent-pilot video start --tab 12345

# Perform workflow actions
agent-pilot click "@1" --tab 12345
agent-pilot type "@2" "test message" --enter --tab 12345

# Stop recording and save MP4 file
agent-pilot video stop -o test-flow.mp4 --tab 12345
```
