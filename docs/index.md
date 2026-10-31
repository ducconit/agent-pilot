---
layout: home

hero:
  name: "Agent Pilot"
  text: "Token-Efficient Browser Control, Web Testing & Debugging for AI"
  tagline: "Low Token Footprint • Skills+CLI & MCP • Annotated Screenshots • Video Recording • Action Replay & Playwright Export • Performance & Memory Leak Detection"
  image:
    src: /logo.svg
    alt: Agent Pilot Logo
  actions:
    - theme: brand
      text: Get Started 🚀
      link: /USAGE_GUIDE
    - theme: alt
      text: Prompt Recipes 💡
      link: /PROMPT_RECIPES
    - theme: alt
      text: Developer Guide 🛠️
      link: /DEVELOPER_GUIDE

---

<BrowserShowcase />

<div class="ap-vibe-disclaimer">
  <div class="ap-vibe-header">
    <span>⚠️ 100% Vibe Coding Project Notice</span>
    <span class="ap-vibe-badge">🤖 GOOGLE ANTIGRAVITY</span>
  </div>
  <div class="ap-vibe-body">
    <strong>Agent Pilot was built entirely via "vibe coding" using Google Antigravity.</strong> Every component—from the Go CLI architecture and Manifest V3 Chrome extension to the MCP protocol server and documentation—was authored, refactored, and iterated autonomously by AI agents driven by prompt engineering.
    <ul>
      <li><strong>Pre-use Caution:</strong> While extensive unit, integration, and secret sanitization tests have been implemented, AI-generated code may contain unexpected edge cases or behavioral quirks. <strong>Always test in isolated browser profiles or non-production environments</strong> before granting autonomous control over sensitive web accounts.</li>
      <li><strong>Disclaimer of Liability:</strong> Provided "AS IS" without warranty of any kind. Authors and contributors assume no liability for any data loss, browser corruption, financial loss, or unauthorized actions performed by autonomous AI agents through this controller.</li>
    </ul>
  </div>
</div>

## 🎯 Core Purpose & Web Testing, QA/QC, Debugging Toolkit

**Agent Pilot** was originally built as a personal project to **replace the default Chrome MCP on Google Antigravity** and eliminate the frustrating workflow where **AI agents had to generate ad-hoc Python scripts just to interact with the browser or draw text/annotations onto images** during web testing.

Today, it solves the fundamental bottleneck of AI browser automation across any AI coding assistant: **effortless browser control with minimal token consumption**, paired with a complete suite of native tools for **automated web testing, QA/QC verification, and deep web debugging**.

<div class="ap-feature-grid">
  <div class="ap-feature-card">
    <div class="ap-feature-badge">01 // TOKEN EFFICIENCY</div>
    <div class="ap-feature-title">Effortless & Low-Token Control</div>
    <div class="ap-feature-desc">
      Compact interactive DOM snapshots (<code>@1</code>, <code>@2</code>) and single-roundtrip Batch Execution cut context token consumption by over 50% across both Skills+CLI and MCP modes.
    </div>
  </div>

  <div class="ap-feature-card">
    <div class="ap-feature-badge">02 // VISUAL QA PROOF</div>
    <div class="ap-feature-title">Annotated Screenshots</div>
    <div class="ap-feature-desc">
      Capture visible viewports, full-page scrolls, or specific DOM elements with automatic bounding-box highlights and custom report title banners for QA documentation.
    </div>
  </div>

  <div class="ap-feature-card">
    <div class="ap-feature-badge">03 // VIDEO RECORDING</div>
    <div class="ap-feature-title">Workflow Video Capture</div>
    <div class="ap-feature-desc">
      Record smooth screencast videos of automated test runs and bug reproductions (complete with virtual neon cursor trajectories and click ripples) for visual QA sign-off.
    </div>
  </div>

  <div class="ap-feature-card">
    <div class="ap-feature-badge">04 // PLAYWRIGHT & REPLAY</div>
    <div class="ap-feature-title">Record, Replay & Export Playwright</div>
    <div class="ap-feature-desc">
      Record live user or AI interaction sequences, replay multi-step flows deterministically on demand, and export recorded journeys directly into production-ready Playwright test code.
    </div>
  </div>

  <div class="ap-feature-card">
    <div class="ap-feature-badge">05 // PERFORMANCE</div>
    <div class="ap-feature-title">Performance & Lighthouse Audits</div>
    <div class="ap-feature-desc">
      Execute native Lighthouse audits, measure Core Web Vitals (LCP, CLS, INP), capture performance timelines, and diagnose slow resource waterfalls.
    </div>
  </div>

  <div class="ap-feature-card">
    <div class="ap-feature-badge">06 // MEMORY DIAGNOSTICS</div>
    <div class="ap-feature-title">Memory Leak Detection (Heap Diff)</div>
    <div class="ap-feature-desc">
      Capture and diff V8 Heap snapshots before and after user flows to pinpoint memory leaks, detached DOM trees, and growing closure retainers.
    </div>
  </div>

  <div class="ap-feature-card">
    <div class="ap-feature-badge">07 // WEB DEBUGGING</div>
    <div class="ap-feature-title">Console, Network & DOM Debugging</div>
    <div class="ap-feature-desc">
      Monitor real-time Console errors, inspect failed HTTP 4xx/5xx network payloads, extract computed CSS styles, and automatically redact sensitive information (13 regex patterns & 23 sensitive keys).
    </div>
  </div>

  <div class="ap-feature-card">
    <div class="ap-feature-badge">08 // INTERACTIVE QA</div>
    <div class="ap-feature-title">Feedback Studio & Tab Isolation</div>
    <div class="ap-feature-desc">
      Pin visual bug annotations directly on the webpage, sample pixel-accurate colors, and run multiple AI agents concurrently in background tab groups without stealing focus.
    </div>
  </div>
</div>

---

## ⚖️ Key Differences: Agent Pilot vs. Standard Chrome MCP

Why use **Agent Pilot** instead of the default Chrome MCP in Antigravity or generic browser MCP servers?

| Capability | Standard Chrome MCP | 🚀 Agent Pilot |
| :--- | :--- | :--- |
| **Connection Modes & Token Cost** | MCP-only (`stdio`/SSE); large JSON-RPC schemas & verbose DOM trees consume heavy context tokens. | Supports both **Skills + CLI** (>50% token savings) and **MCP Server**, plus compact `@1, @2` snapshots & Batch Execution. |
| **Visual QA & Annotated Screenshots** | Captures plain screenshots; AI often has to write ad-hoc Python scripts (`Pillow`/`OpenCV`) to draw boxes or text labels. | **Built-in Annotated Screenshots** (viewport, full-page, element) with automatic bounding-box highlights and QA report title banners—zero Python scripts needed. |
| **Browser Session & Focus Isolation** | Typically spawns a separate browser window or steals active window/mouse focus while you work. | Runs directly inside your active Chrome profile (preserving login sessions) inside isolated background tab groups (`🤖 Agent Pilot`) without stealing focus. |
| **Video Recording, Replay & Playwright** | Executes one-off commands with no built-in recording, action replay, or test code generation. | Native `.mp4` workflow video capture (with virtual neon cursor), deterministic **Action Replay**, and 1-click **Playwright** test code export. |
| **Deep Web Debugging & Security** | Basic DOM interaction and raw console/network inspection. | Native **Lighthouse** audits, Core Web Vitals, **V8 Heap Snapshot Diff** for memory leaks, **In-Page Feedback Studio**, and dual-layer masking of **sensitive secrets (13 regex patterns + 23 property keys)**. |

---

## 🧭 Future Direction & Roadmap

::: info STABILITY FIRST — NO NEW FEATURE EXPANSION PLANNED
Because **Agent Pilot** already covers the complete end-to-end workflow for personal and team Web Testing, QA/QC, and Debugging, **the primary goal for the future is to ensure rock-solid stability, reliability, and compatibility of the existing feature set** across browser and OS updates. There are currently **no plans to develop new features**.
:::

---

## 📦 Installation & Setup

Choose the installation method suited to your environment:

| Method | Recommended For | Details & Characteristics |
| :--- | :--- | :--- |
| 🌟 **Method 1: OS-Specific Release Bundle (Recommended)** | End users, QA engineers, daily workstations | **Optimized for your operating system.** Each bundle contains only the native binary for your OS, an automated 1-step installer script (`install.sh` / `install.ps1`), and the unpacked Chrome extension. Automatically sets up `PATH` and registers the background daemon (`systemd` / `launchd` / Windows service). |
| ⚡ **Method 2: Quick Install for AI Agents (`npx skills add`)** | Fast bootstrapping for AI coding assistants | **Single-command agent setup.** Installs the Agent Pilot skill directly into your AI assistant. *Note:* Because this package is designed for cross-platform agent bootstrapping, it bundles pre-compiled binaries for **all 3 operating systems** (Linux, macOS, Windows) inside `skills/agent-pilot/scripts/`, resulting in a larger package download. |
| 🛠️ **Method 3: Build & Install from Source Code** | Developers, contributors, custom fork maintainers | Full source code checkout. Build the standalone Go CLI binary with `go build` and load `extensions/` directly in Chrome. |

---

### Method 1: OS-Specific Release Bundle (Recommended)

This is the **recommended installation method** because each release bundle is specifically packaged and trimmed for your operating system, ensuring optimal disk footprint and native service integration.

#### Step 1: Download & Run the 1-Step Installer

| Platform | Package Bundle | Automated Command | Detailed Guide |
| :--- | :--- | :--- | :--- |
| 🐧 **Linux / Ubuntu** | `agent-pilot-*-linux.zip` | `./install.sh` | [Linux Guide](/bundles/README.ubuntu) |
| 🍎 **macOS** | `agent-pilot-*-macos.zip` | `./install.sh` | [macOS Guide](/bundles/README.macos) |
| 🪟 **Windows** | `agent-pilot-*-windows.zip` | `powershell -ExecutionPolicy Bypass -File .\install.ps1` | [Windows Guide](/bundles/README.windows) |

The installer automatically installs the standalone CLI to your user PATH (`~/.local/bin` or `$env:LOCALAPPDATA\Programs\agent-pilot`), registers the auto-starting background service, and extracts the Chrome extension folder.

Verify the background service:
```bash
agent-pilot service status
```

#### Step 2: Load the Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked** in the top-left and select the unpacked `extensions/` directory.
4. Pin the **Agent Pilot (📌)** icon to your Chrome toolbar.

---

### Method 2: Quick Install for AI Agents (`npx skills add`)

If you want to rapidly equip your AI assistant without downloading release archives manually, use the [skills.sh](https://skills.sh/) ecosystem command:

```bash
npx skills add https://github.com/ducconit/agent-pilot -g --all
```

> 💡 **Quick Install Note**: This method is intended for **fast AI agent bootstrapping** across any host environment. Because it is multi-platform, the installed skill package contains pre-compiled binaries for **all 3 operating systems** (Linux `agent-pilot`, macOS `agent-pilot`, Windows `agent-pilot.exe`) in `skills/agent-pilot/scripts/`. For a lightweight, OS-tailored setup with automated system daemon registration, prefer **Method 1 (OS-Specific Release Bundle)**.

To load the extension into Chrome, open the cloned skill directory or download `extensions/` and load it via `chrome://extensions` (Load unpacked).

---

### Method 3: Build & Install from Source Code

For developers who want to modify Go backend code, develop Chrome extension features, or run local tests:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ducconit/agent-pilot.git
   cd agent-pilot
   ```

2. **Build the Go CLI binary**:
   ```bash
   go build -o bin/agent-pilot ./cli/cmd/agent-pilot
   ```

3. **Install the CLI and background service**:
   ```bash
   ./bin/agent-pilot service install
   ./bin/agent-pilot service status
   ```

4. **Load the extension**:
   Open Chrome → `chrome://extensions` → Enable **Developer mode** → Click **Load unpacked** → Select the `extensions/` directory in the repository.

---

## 🤖 Connecting to Any AI Assistant or Client

Once installed, Agent Pilot works universally with any AI coding assistant or automation tool via **Agent Skills + Command Line (CLI)** or **Model Context Protocol (MCP)**:

#### Option A: Agent Skills + Command Line (CLI)
Works out-of-the-box with **Claude Code**, **Cursor**, **Windsurf**, **Google Antigravity**, **Cline / Roo Code**, **OpenCode**, **Codex**, **Aider**, and any agent capable of running shell commands:
```bash
# Install via skills.sh ecosystem
npx skills add https://github.com/ducconit/agent-pilot -g --all

# Or install directly via the standalone CLI
agent-pilot install-skill --all
```

#### Option B: Model Context Protocol (MCP) Server (`mcp.json`)
Works with any MCP-compatible client (**Claude Desktop**, **Claude Code**, **Cursor**, **Windsurf**, **Google Antigravity**, **Zed**, **Continue**, etc.):
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

## ⚠️ Disclaimer & Vibe Coding Statement

::: warning IMPORTANT CAUTION BEFORE RUNNING IN PRODUCTION
This project is an experimental tool created **100% via vibe coding with Google Antigravity**.

* **No Human Handcrafted Code**: All logic, tests, and configurations were synthesized by AI agents through natural language interaction.
* **Sandbox Verification Recommended**: Run inside isolated Chrome instances (`--user-data-dir`) or non-logged-in sessions when experimenting with autonomous agents.
* **Limitation of Liability**: In no event shall the authors, maintainers, or Google be held liable for any direct, indirect, incidental, or consequential damages (including loss of data, unauthorized purchases, account lockouts, or financial losses) resulting from the execution of AI actions via Agent Pilot.
:::

---

<div style="text-align: center; margin: 3rem 0; color: var(--ap-text-muted); font-size: 0.85rem;">
  Engineered with Google Antigravity • MIT License • Use at your own risk
</div>
