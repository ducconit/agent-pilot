# 🐧 Agent Pilot — Ubuntu / Linux Setup Guide

Dedicated installation bundle for **Ubuntu / Debian / Linux (x86_64 / amd64)**, packaging the Chrome Extension, static MCP Server binary, and Agent Skill:

```text
agent-pilot-v1.4.0-linux/
├── extensions/            Chrome Extension (Manifest V3) — loaded unpacked in Chrome/Chromium
├── install.sh             1-step automated installation script for Ubuntu/Linux
├── skills/agent-pilot/    Agent Skill + scripts/agent-pilot native binary
└── README.md              Documentation for Ubuntu/Linux
```

## System Requirements
- **OS**: Ubuntu 20.04+ / Debian / Linux (amd64) with `systemd`
- **Browser**: Google Chrome 116+, Chromium, Brave, or Microsoft Edge (Side Panel API support)
- **Dependencies**: Zero runtime dependencies (`skills/agent-pilot/scripts/agent-pilot` is statically linked `CGO_ENABLED=0`)

---

## ⚡ 1-Step Quick Install (Recommended)

Open a terminal in the unpacked directory and run:

```bash
chmod +x ./install.sh && ./install.sh
```

The `install.sh` script automatically:
1. Installs `agent-pilot` binary into `~/.local/bin/agent-pilot` (no `sudo` required).
2. Registers and enables `systemd --user` background service (`~/.config/systemd/user/agent-pilot.service`).
3. Installs Agent Skill to `~/.agents/skills/agent-pilot` and `~/.gemini/config/skills/agent-pilot` (Antigravity).
4. Prints the ready-to-use MCP JSON configuration with exact paths.

---

## 🛠️ Manual Step-by-Step Installation

### Step 1: Load Chrome Extension
1. Open Chrome/Chromium and navigate to `chrome://extensions`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked** → select the `extensions/` directory.
4. Pin the **Agent Pilot (📌)** icon to your toolbar.

### Step 2: Install CLI / MCP Server & Service (`systemd --user`)
```bash
# Make binary executable and copy to ~/.local/bin
mkdir -p ~/.local/bin
chmod +x ./skills/agent-pilot/scripts/agent-pilot
cp ./skills/agent-pilot/scripts/agent-pilot ~/.local/bin/agent-pilot

# Ensure ~/.local/bin is in PATH
export PATH="$HOME/.local/bin:$PATH"

# Install and start systemd user service:
agent-pilot service install
agent-pilot service status
```

### Step 3: MCP Configuration for AI Assistants
Add to your AI agent MCP configuration (e.g. `~/.gemini/config/mcp_config.json`):
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

## 🔍 Verification & Troubleshooting

Check running daemon:
```bash
systemctl --user status agent-pilot.service
```

Test CLI directly:
```bash
agent-pilot tabs
agent-pilot open "https://example.com" --active
```
