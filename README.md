<div align="center">

![Agent Pilot Banner](assets/banner.svg)

# 🚀 Agent Pilot
### Universal AI Agent Browser Controller • Antigravity-First

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue?style=flat-square&logo=googlechrome)](extensions/manifest.json)
[![Documentation](https://img.shields.io/badge/Docs-VitePress-06b6d4?style=flat-square&logo=vitepress)](https://ducconit.github.io/agent-pilot/)
[![Status: Public Beta](https://img.shields.io/badge/Status-Public%20Beta-amber?style=flat-square&logo=statuspage)](#)
[![CDP Protocol](https://img.shields.io/badge/Engine-Chrome%20DevTools%20Protocol-06b6d4?style=flat-square)](docs/CDP_GUIDE.md)
[![Cross-Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blueviolet?style=flat-square)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![100% Vibe Coded](https://img.shields.io/badge/100%25-Vibe%20Coded-purple?style=flat-square&logo=visualstudiocode)](#-disclaimer--vibe-coding-notice)
[![Built with Antigravity](https://img.shields.io/badge/Built%20with-Google%20Antigravity-4285F4?style=flat-square&logo=google)](#-disclaimer--vibe-coding-notice)

[English](README.md) • [Tiếng Việt](README.vi.md) • [Documentation](https://ducconit.github.io/agent-pilot/) • [Contributing](CONTRIBUTING.md)

<p align="center">
  <b>Agent Pilot</b> is a lightweight, zero-dependency browser controller built for <b>AI Coding Agents</b> (Google Antigravity, Claude Code, Cursor, Codex). It bridges Chrome via a <b>Manifest V3 Extension</b>, a <b>Standalone Go CLI</b>, and a <b>Model Context Protocol (MCP) Server</b>.
</p>

</div>

> [!WARNING]
> ### ⚠️ 100% Vibe Coding Notice & Legal Disclaimer
>
> **Agent Pilot is an experimental open-source project created 100% via "vibe coding" using Google Antigravity.**
>
> - **AI-Authored Codebase**: Every single component (Go CLI binary, Manifest V3 Chrome extension, MCP protocol server, and automated tests) was generated, iterated, and refactored autonomously by AI agents driven by prompt engineering.
> - **Exercise Caution**: While the repository includes automated test suites, linting, and a 29-rule secret sanitization layer, AI-generated code may contain unexpected edge cases or behavioral quirks. **Always test in sandboxed, isolated browser profiles or non-production environments** before granting autonomous control over sensitive web accounts or production infrastructure.
> - **Disclaimer of Liability**: This software is provided **"AS IS"**, without warranty of any kind, express or implied. In no event shall the authors, contributors, or maintainers be liable for any claims, damages, data loss, browser corruption, financial loss, or unauthorized actions performed by autonomous AI agents through this controller. Use entirely at your own risk.

---

## 🌟 Key Capabilities

- **Human-Like Browser Simulation**: Virtual neon cursor with click-ripple animation, real-time typing, drag-and-drop, and automated form filling.
- **Dual Execution Engine (DOM + Trusted CDP)**: Blazing-fast synthetic DOM manipulation by default; seamlessly escalates to Chrome DevTools Protocol (`--via cdp`) for cross-origin iframes, Canvas, and WebGL applications.
- **Zero Runtime Dependencies**: The single Go binary embeds the MCP server, WebSocket/REST bridge, and an embedded DevTools runtime (Lighthouse, heap profiler, tracing). No Node.js or FFmpeg required on the client machine.
- **Background Multi-Agent Isolation**: Automates tabs inside a dedicated tab group (`🤖 Agent Pilot`) without hijacking user focus. Supports multiple concurrent agents via `--tab <id>` and `--port <port>`.
- **In-Page Feedback Studio**: An interactive side panel that allows developers and QA testers to inspect DOM, pick pixel-accurate colors, annotate UI bugs, and push feedback directly to AI agents.

---

## 🚀 Quick Start (3 Steps)

```mermaid
flowchart LR
    A["<b>1. Load Extension</b><br/>Unpack extensions/ in Chrome"] --> B["<b>2. Install CLI / Service</b><br/>Download binary & start service"]
    B --> C["<b>3. Connect AI Agent</b><br/>Configure MCP or npx skills add"]
```

### Step 1: Load the Chrome Extension
1. Download the latest release from [GitHub Releases](https://github.com/ducconit/agent-pilot/releases).
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked**, select the `extensions/` directory, and pin the **Agent Pilot (📌)** icon.

### Step 2: Install the CLI & Service

Download the pre-compiled bundle for your operating system:

| Operating System | Release Bundle | 1-Step Installer | Guide |
| :--- | :--- | :--- | :--- |
| 🐧 **Ubuntu / Linux** | `agent-pilot-*-linux.zip` | `./install.sh` | [README.ubuntu.md](docs/bundles/README.ubuntu.md) |
| 🍎 **macOS** | `agent-pilot-*-macos.zip` | `./install.sh` | [README.macos.md](docs/bundles/README.macos.md) |
| 🪟 **Windows** | `agent-pilot-*-windows.zip` | `powershell -ExecutionPolicy Bypass -File .\install.ps1` | [README.windows.md](docs/bundles/README.windows.md) |

Register the background service to start automatically on login:
```bash
agent-pilot service install
agent-pilot service status
```

### Step 3: Connect to Your AI Agent

#### Option A: Agent Skills Ecosystem ([skills.sh](https://skills.sh/))
```bash
npx skills add https://github.com/ducconit/agent-pilot -g --all
```

#### Option B: MCP Server (`stdio`)
Add Agent Pilot to your MCP configuration (`claude_desktop_config.json`, `~/.gemini/antigravity/mcp/`, or Cursor Settings):
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

---

## 💻 CLI Cheat Sheet

```bash
# Open tab in background (no focus stealing)
agent-pilot open "http://localhost:3000" --format json

# Extract interactive DOM snapshot (@1, @2...)
agent-pilot snapshot --tab 12345

# Virtual click & keyboard typing
agent-pilot click "@1" --tab 12345
agent-pilot type "@2" "test@example.com" --enter --tab 12345

# Annotated screenshot with banner & element highlight
agent-pilot screenshot -o login.png --highlight "@1" --title "Login Screen"

# Low-level CDP inspection (Console logs & Page errors)
agent-pilot console errors --tab 12345

# Close tab and free memory
agent-pilot close --tab 12345
```

---

## 📚 Technical Documentation

- 🏛️ **[System Architecture (ARCHITECTURE.md)](docs/ARCHITECTURE.md)**: Deep dive into Manifest V3, IPC Bridge, and process isolation.
- 🤖 **[Antigravity & MCP Integration](docs/ANTIGRAVITY_INTEGRATION.md)**: Comprehensive guide for connecting AI coding assistants.
- ⚡ **[CDP Protocol Guide](docs/CDP_GUIDE.md)**: Low-level Chrome DevTools Protocol, Network, Console, and Trusted Input.
- 🔬 **[Advanced DevTools Features](docs/DEVTOOLS.md)**: Real Lighthouse audits, V8 heap snapshot diffing, performance tracing.
- 📖 **[Full Usage Guide (USAGE_GUIDE.md)](docs/USAGE_GUIDE.md)**: Feature walkthrough for human users and QA engineers.
- 📊 **[Performance Benchmarks](docs/BENCHMARKS.md)**: Empirical comparison of MCP vs CLI latency, tokens, and payload volume.
- 📦 **[OS Bundle Guides (BUNDLE_README.md)](docs/BUNDLE_README.md)**: Native installation guides for Linux, macOS, and Windows.

---

## 🤝 Contributing

Contributions are warmly welcome! Please check out our community guides:
- 🛠️ [Contributing Guide (CONTRIBUTING.md)](CONTRIBUTING.md)
- 📜 [Code of Conduct (CODE_OF_CONDUCT.md)](CODE_OF_CONDUCT.md)
- 🛡️ [Security Policy (SECURITY.md)](SECURITY.md)

---

## ⚠️ Disclaimer & Vibe Coding Notice

**Agent Pilot is 100% vibe-coded with Google Antigravity.**
- **No Human-Written Logic**: All code, architecture decisions, CLI commands, and extension scripts were generated autonomously through natural language prompts.
- **Sandboxed Execution Recommended**: Autonomous agentic actions can navigate websites, trigger state mutations, submit forms, or download files. Always run tests using isolated user profiles (`--user-data-dir`).
- **No Liability**: The maintainers and contributors assume no liability for unintended purchases, data modification, account actions, or system damages resulting from using Agent Pilot with LLM agents.

---

## 📄 License

Agent Pilot is open-source software licensed under the [MIT License](LICENSE).
Copyright (c) 2026 **DNT** ([@ducconit](https://github.com/ducconit)) & Agent Pilot Contributors.
