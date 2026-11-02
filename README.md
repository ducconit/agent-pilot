<div align="center">

![Agent Pilot Banner](assets/banner.svg)

# 🚀 Agent Pilot
### Universal AI Agent Browser Controller • Skills + CLI & MCP

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
  <b>Agent Pilot</b> is a lightweight, zero-dependency browser controller built for any <b>AI Coding Agent or Automation Tool</b> supporting <b>Agent Skills + Command Line (CLI)</b> or <b>Model Context Protocol (MCP)</b> (Claude Code, Cursor, Windsurf, Google Antigravity, Cline, OpenCode, Codex, Aider).
</p>

</div>

> [!WARNING]
> ### ⚠️ 100% Vibe Coding Notice & Legal Disclaimer
>
> **Agent Pilot is an experimental open-source project created 100% via "vibe coding" using Google Antigravity.**
>
> - **AI-Authored Codebase**: Every single component (Go CLI binary, Manifest V3 Chrome extension, MCP protocol server, and automated tests) was generated, iterated, and refactored autonomously by AI agents driven by prompt engineering.
> - **Exercise Caution**: While the repository includes automated test suites, linting, and a dual-layer secret sanitization engine (13 regex patterns and 23 sensitive property keys), AI-generated code may contain unexpected edge cases or behavioral quirks. **Always test in sandboxed, isolated browser profiles or non-production environments** before granting autonomous control over sensitive web accounts or production infrastructure.
> - **Disclaimer of Liability**: This software is provided **"AS IS"**, without warranty of any kind, express or implied. In no event shall the authors, contributors, or maintainers be liable for any claims, damages, data loss, browser corruption, financial loss, or unauthorized actions performed by autonomous AI agents through this controller. Use entirely at your own risk.

---

## 🎯 Project Origin & Core Capabilities

**Agent Pilot** was originally created for personal use to **replace the default Chrome MCP on Google Antigravity** and eliminate the need for **AI agents to generate ad-hoc Python scripts just to manipulate the browser or draw text/annotations onto screenshots** during web testing.

It provides **effortless, token-efficient browser control**, empowering AI coding agents and QA engineers with a complete native **Web Testing, QA/QC, and Web Debugging** toolkit:

- **Ultra-Low Token Footprint (>50% Savings)**: Compact interactive DOM snapshots (`@1`, `@2`) and single-roundtrip Batch Execution minimize context token consumption across both **Skills + CLI** and **MCP** modes.
- **Annotated Screenshots & Visual QA**: Capture viewport, full-page, or element screenshots with automatic bounding-box highlights, custom QA title banners, and Set-of-Marks interactive badges (@1, @2) with zero DOM mutations.
- **Workflow Video Recording**: Record smooth `.mp4` screencasts of automated browser runs and bug reproductions (including virtual neon cursor trajectories and click ripples).
- **Action Recorder, Replay & Playwright Export**: Record live user or AI interactions, replay test flows deterministically, and export directly to production-ready **Playwright** test code.
- **Performance & Lighthouse Auditing**: Run native Lighthouse audits, measure Core Web Vitals (LCP, CLS, INP), and analyze performance traces.
- **Memory Leak Detection (V8 Heap Diff)**: Capture and diff V8 Heap snapshots before/after user flows to pinpoint memory leaks and detached DOM nodes.
- **Deep Web Debugging & Secret Protection**: Monitor real-time Console errors, inspect failed HTTP 4xx/5xx requests, extract computed CSS, and automatically mask sensitive information (13 regex patterns and 23 sensitive property keys).
- **In-Page Feedback Studio & Background Isolation**: Pin visual bug annotations directly on the webpage, sample pixel colors, and orchestrate multiple concurrent agents in background tab groups (`🤖 Agent Pilot`) without stealing user focus.

### ⚖️ Key Differences: Agent Pilot vs. Standard Chrome MCP

| Capability | Standard Chrome MCP | 🚀 Agent Pilot |
| :--- | :--- | :--- |
| **Connection Modes & Token Cost** | MCP-only; verbose JSON-RPC schemas & raw DOM dumps consume large amounts of context tokens. | Supports both **Skills + CLI** (>50% token savings) and **MCP Server**, with compact `@1, @2` snapshots & Batch Execution. |
| **Visual QA & Image Annotation** | Plain screenshots only; AI agents frequently generate ad-hoc Python scripts (`Pillow`/`OpenCV`) to draw text or highlight boxes on images. | **Native Annotated Screenshots** (viewport, full-page, element) with automatic bounding-box highlights and QA title banners—zero Python scripts required. |
| **Browser Session & Focus Isolation** | Often launches a separate browser profile or steals active window/cursor focus while you work. | Operates inside your existing Chrome browser inside isolated background tab groups (`🤖 Agent Pilot`) without stealing user focus. |
| **Video, Replay & Playwright Export** | One-off command execution with no recording, replay, or test generation. | Built-in `.mp4` workflow video capture, deterministic **Action Replay**, and direct **Playwright** test code export. |
| **Performance, Memory Leak & Security** | Basic DOM interaction and raw console/network inspection. | Native **Lighthouse** audits, Core Web Vitals, **V8 Heap Snapshot Diff** for memory leaks, **Feedback Studio**, and **dual-layer secret redaction (13 regex patterns + 23 sensitive keys)**. |

### 🧭 Future Direction

> **Stability First**: Because Agent Pilot already provides a complete toolkit for Web Testing, QA/QC, and Debugging, **our future goal is strictly focused on ensuring the stability, reliability, and compatibility of existing features** rather than developing new features.

---

## 🚀 Quick Start & Installation

Agent Pilot offers three installation methods:

1. **🌟 OS-Specific Release Bundle (Recommended)**: Download the trimmed bundle for your OS with 1-step installer script (`./install.sh` or `.\install.ps1`). Sets up PATH and background service (`systemd` / `launchd` / Windows service) automatically.
2. **⚡ Quick Install for AI Agents (`npx skills add`)**: Single terminal command to equip your AI coding assistant (Claude Code, Cursor, Windsurf, Antigravity, OpenCode, Codex). *Note:* This cross-platform skill package bundles pre-compiled binaries for **all 3 operating systems** (Linux, macOS, Windows) in `skills/agent-pilot/scripts/`.
3. **🛠️ Build from Source Code**: For developers who want to modify Go backend code or Chrome extension scripts.

---

### Step 1: Install via OS Release Bundle (Recommended)

Download the pre-compiled bundle for your operating system:

| Operating System | Release Bundle | 1-Step Installer | Guide |
| :--- | :--- | :--- | :--- |
| 🐧 **Ubuntu / Linux** | `agent-pilot-*-linux.zip` | `./install.sh` | [README.ubuntu.md](docs/bundles/README.ubuntu.md) |
| 🍎 **macOS** | `agent-pilot-*-macos.zip` | `./install.sh` | [README.macos.md](docs/bundles/README.macos.md) |
| 🪟 **Windows** | `agent-pilot-*-windows.zip` | `powershell -ExecutionPolicy Bypass -File .\install.ps1` | [README.windows.md](docs/bundles/README.windows.md) |

The installer configures user `PATH` and starts the background daemon:
```bash
agent-pilot service status
```

### Step 2: Load the Chrome Extension
1. Download or extract the `extensions/` directory from your release package.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked**, select the `extensions/` directory, and pin the **Agent Pilot (📌)** icon.

### Step 3: Connect to Your AI Agent

#### Option A: Quick Install via Agent Skills ([skills.sh](https://skills.sh/))
```bash
npx skills add https://github.com/ducconit/agent-pilot -g --all
```
*(Multi-platform package containing binaries for Linux, macOS, and Windows).*

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

#### Option C: Build from Source Code (Developers)
```bash
git clone https://github.com/ducconit/agent-pilot.git
cd agent-pilot
go build -o bin/agent-pilot ./cli/cmd/agent-pilot
./bin/agent-pilot service install
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
