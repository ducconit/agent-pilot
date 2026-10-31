# 🚀 Agent Pilot — Operating System Bundles Guide

Each official release of **Agent Pilot** is packaged specifically for target platforms with **statically linked binaries (`CGO_ENABLED=0`)**, **1-step automated installers**, and **platform-specific MCP / Background Service setup guides**:

## 📚 Platform-Specific Guides

| Operating System | Architecture | Installation Guide | Included Installer | Background Daemon |
| :--- | :--- | :--- | :--- | :--- |
| 🐧 **Ubuntu / Linux** | `linux-amd64` | [**Ubuntu / Linux Guide**](bundles/README.ubuntu) | `install.sh` | `systemd --user` (`~/.config/systemd/user/agent-pilot.service`) |
| 🍎 **macOS** | `darwin-arm64` (Apple Silicon M1-M4) | [**macOS Guide**](bundles/README.macos) | `install.sh` | `launchd` (`~/Library/LaunchAgents/com.agentpilot.bridge.plist`) |
| 🪟 **Windows** | `windows-amd64` | [**Windows Guide**](bundles/README.windows) | `install.ps1` | `Task Scheduler` (`AgentPilotBridge`) |

---

## 📦 Bundle Directory Structure

Running `npm run pack:bundle` produces standalone release `.zip` archives under `dist/bundles/`:

```text
agent-pilot-{{VERSION}}-{{PLATFORM}}/
├── extensions/            Chrome Extension (Manifest V3) — loaded unpacked in Chrome
├── install.sh / .ps1      1-step platform installer script
├── skills/agent-pilot/    Agent Skill + scripts/{{BINARY_NAME}} native CLI/MCP
└── README.md              OS-specific guide compiled for {{PLATFORM}}
```

---

## 🛠️ Build Bundles from Source

```bash
# Package all platforms (Linux, macOS, Windows):
npm run pack:bundle

# Or package individual platforms:
npm run pack:bundle:ubuntu    # Ubuntu / Linux (linux-amd64)
npm run pack:bundle:macos     # macOS Apple Silicon (darwin-arm64)
npm run pack:bundle:windows   # Windows (windows-amd64)
```

---
MIT License · Maintained by **DNT** ([@ducconit](https://github.com/ducconit)) · https://github.com/ducconit/agent-pilot
