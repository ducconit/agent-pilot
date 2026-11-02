# 🪟 Agent Pilot — Windows Setup Guide

Dedicated installation bundle for **Windows 10 / Windows 11 (x86_64 / amd64)**, packaging the Chrome/Edge Extension, static MCP Server binary, and Agent Skill:

```text
agent-pilot-v1.4.0-windows\
├── extensions\            Chrome Extension (Manifest V3) — loaded unpacked in Chrome/Edge/Brave
├── install.ps1            1-step automated PowerShell installer for Windows
├── skills\agent-pilot\    Agent Skill + scripts\agent-pilot.exe native binary
└── README.md              Documentation for Windows
```

## System Requirements
- **OS**: Windows 10 / Windows 11 (amd64)
- **Browser**: Google Chrome 116+, Microsoft Edge, or Brave (Side Panel API support)
- **Dependencies**: Zero runtime dependencies (`skills\agent-pilot\scripts\agent-pilot.exe` runs standalone without Administrator privileges)

---

## ⚡ 1-Step Quick Install via PowerShell (Recommended)

Open **PowerShell** in the unpacked directory and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The `install.ps1` script automatically:
1. Unblocks SmartScreen flags (`Unblock-File`) for binaries downloaded from the internet.
2. Copies `agent-pilot.exe` to `%LOCALAPPDATA%\Programs\agent-pilot\agent-pilot.exe`.
3. Adds `%LOCALAPPDATA%\Programs\agent-pilot` to User `PATH` (no Admin required).
4. Registers and starts silent background task in **Windows Task Scheduler** (`AgentPilotBridge`).
5. Installs Agent Skill to `%USERPROFILE%\.agents\skills\agent-pilot` and `%USERPROFILE%\.gemini\config\skills\agent-pilot` (Antigravity).
6. Prints the ready-to-use MCP JSON configuration with properly escaped Windows backslashes (`C:\\Users\\...`).

---

## 🛠️ Manual Step-by-Step Installation

### Step 1: Load Chrome / Edge Extension
1. Open Google Chrome at `chrome://extensions` (or Microsoft Edge at `edge://extensions`).
2. Enable **Developer mode** toggle.
3. Click **Load unpacked** → select `extensions\` folder.
4. Pin the **Agent Pilot (📌)** icon to your toolbar.

### Step 2: Install `agent-pilot.exe` & Background Service (Task Scheduler)
```powershell
# Create destination directory
$targetDir = "$env:LOCALAPPDATA\Programs\agent-pilot"
New-Item -ItemType Directory -Force -Path $targetDir

# Unblock and copy binary
Unblock-File -Path ".\skills\agent-pilot\scripts\agent-pilot.exe"
Copy-Item ".\skills\agent-pilot\scripts\agent-pilot.exe" "$targetDir\agent-pilot.exe"

# Add to User PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$targetDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$targetDir;$userPath", "User")
}

# Install and start Windows background task
& "$targetDir\agent-pilot.exe" service install
& "$targetDir\agent-pilot.exe" service status
```

### Step 3: MCP Configuration for Windows Assistants
Add to your AI agent MCP configuration (e.g. `%USERPROFILE%\.gemini\config\mcp_config.json`):
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

Check running Task Scheduler task:
```powershell
Get-ScheduledTask -TaskName "AgentPilotBridge"
```

Test CLI directly in PowerShell:
```powershell
agent-pilot tabs
agent-pilot open "https://example.com" --active
```
