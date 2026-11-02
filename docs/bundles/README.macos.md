# 🍎 Agent Pilot — macOS Setup Guide

Dedicated installation bundle for **macOS (darwin-arm64 — Apple Silicon M1-M4)**, packaging the Chrome Extension, static MCP Server binary, and Agent Skill:

```text
agent-pilot-v1.4.0-macos/
├── extensions/            Chrome Extension (Manifest V3) — loaded unpacked in Chrome/Brave/Arc
├── install.sh             1-step automated installation script for macOS (clears Gatekeeper quarantine)
├── skills/agent-pilot/    Agent Skill + scripts/agent-pilot native binary
└── README.md              Documentation for macOS
```

## System Requirements
- **OS**: macOS 12 Monterey or higher (`darwin-arm64` for M1/M2/M3/M4 or `darwin-amd64` for Intel)
- **Browser**: Google Chrome 116+, Brave, Arc, or Microsoft Edge (Side Panel API support)
- **Dependencies**: Zero runtime dependencies (`skills/agent-pilot/scripts/agent-pilot` is statically linked)

---

## ⚡ 1-Step Quick Install (Recommended)

Open **Terminal** (or iTerm2) in the unpacked directory and run:

```bash
chmod +x ./install.sh && ./install.sh
```

The `install.sh` script automatically:
1. Strips **macOS Gatekeeper quarantine flags** (`xattr -cr`) to prevent macOS from blocking background MCP process spawning.
2. Installs `agent-pilot` binary into `~/.local/bin/agent-pilot`.
3. Registers and starts `launchd` background agent (`~/Library/LaunchAgents/com.agentpilot.bridge.plist`).
4. Installs Agent Skill to `~/.agents/skills/agent-pilot` and `~/.gemini/config/skills/agent-pilot` (Antigravity).
5. Prints the ready-to-use MCP JSON configuration with exact macOS absolute paths.

---

## 🛠️ Manual Step-by-Step Installation

### Step 1: Clear Gatekeeper Quarantine & Install Binary
> ⚠️ **Important on macOS**: Files downloaded via Safari/Chrome are tagged with `com.apple.quarantine`. If not stripped, IDEs (Claude Desktop, Cursor, Antigravity) will be silently blocked from launching `agent-pilot mcp`.

```bash
# 1. Clear macOS Gatekeeper quarantine attribute
xattr -cr .
chmod +x ./skills/agent-pilot/scripts/agent-pilot

# 2. Copy binary to ~/.local/bin
mkdir -p ~/.local/bin
cp ./skills/agent-pilot/scripts/agent-pilot ~/.local/bin/agent-pilot

# 3. Ensure ~/.local/bin is in PATH (add to ~/.zshrc if needed)
export PATH="$HOME/.local/bin:$PATH"

# 4. Install and enable launchd daemon
agent-pilot service install
agent-pilot service status
```

### Step 2: Load Chrome Extension
1. Open Chrome/Brave/Arc, navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** → select `extensions/`.
4. Pin the **Agent Pilot (📌)** icon to your toolbar.

### Step 3: MCP Configuration for macOS Assistants
Add to your AI agent MCP configuration (e.g. `~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "agent-pilot": {
      "command": "/Users/YOUR_USERNAME/.local/bin/agent-pilot",
      "args": ["mcp"]
    }
  }
}
```
*(Replace `YOUR_USERNAME` with your macOS username, or run `which agent-pilot` to get the exact path)*.

---

## 🔍 Verification & Troubleshooting

Check running `launchd` daemon:
```bash
launchctl list | grep agentpilot
```

Test CLI directly:
```bash
agent-pilot tabs
agent-pilot open "https://example.com" --active
```
