# Agent Pilot — Windows One-Step Installer (PowerShell)
# Cài đặt agent-pilot.exe vào %LOCALAPPDATA%\Programs\agent-pilot, thêm vào User PATH,
# đăng ký Windows Task Scheduler (AgentPilotBridge) và cài đặt Agent Skill.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinarySrc = Join-Path $ScriptDir "agent-pilot.exe"
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\agent-pilot"
$BinaryDst = Join-Path $InstallDir "agent-pilot.exe"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "🪟 AGENT PILOT — CAI DAT CHO WINDOWS" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

if (-not (Test-Path $BinarySrc)) {
    Write-Error "Khong tim thay tep thuc thi: $BinarySrc"
    exit 1
}

# Gỡ khóa SmartScreen (Zone.Identifier) nếu tải từ trình duyệt
Unblock-File -Path $BinarySrc -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path $BinarySrc -Destination $BinaryDst -Force
Unblock-File -Path $BinaryDst -ErrorAction SilentlyContinue
Write-Host "✅ Da cai dat binary vao: $BinaryDst" -ForegroundColor Green

# Thêm vào User PATH nếu chưa có
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $UserPath) { $UserPath = "" }
$PathParts = $UserPath -split ";" | Where-Object { $_ -ne "" }
if ($PathParts -notcontains $InstallDir) {
    $NewUserPath = if ($UserPath.EndsWith(";") -or $UserPath -eq "") { "$UserPath$InstallDir" } else { "$UserPath;$InstallDir" }
    [Environment]::SetEnvironmentVariable("Path", $NewUserPath, "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "✅ Da them '$InstallDir' vao User PATH." -ForegroundColor Green
}

# Đăng ký dịch vụ chạy ngầm qua Windows Task Scheduler
Write-Host "→ Dang dang ky dich vu chay ngam (Windows Task Scheduler)..." -ForegroundColor Cyan
try {
    & $BinaryDst service install
} catch {
    Write-Warning "Khong the dang ky Task Scheduler tu dong: $_"
}

# Cài đặt Agent Skill
Write-Host "→ Dang cai dat Agent Skill..." -ForegroundColor Cyan
try { & $BinaryDst skill install --force } catch {}
try { & $BinaryDst skill install --agy --force } catch {}

$EscapedBinaryDst = $BinaryDst.Replace("\", "\\")

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "🎉 HOAN TAT CAI DAT AGENT PILOT TREN WINDOWS!" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "1. Mo Google Chrome -> chrome://extensions -> bat Developer mode"
Write-Host "   -> bam 'Load unpacked' va chon thu muc: $(Join-Path $ScriptDir 'extensions')"
Write-Host ""
Write-Host "2. Them cau hinh MCP Server sau vao AI Agent cua ban:"
Write-Host "   - Antigravity: $env:USERPROFILE\.gemini\config\mcp_config.json"
Write-Host "   - Claude Desktop: $env:APPDATA\Claude\claude_desktop_config.json"
Write-Host "   - Cursor: $env:USERPROFILE\.cursor\mcp.json"
Write-Host ""
Write-Host @"
{
  "mcpServers": {
    "agent-pilot": {
      "command": "$EscapedBinaryDst",
      "args": ["mcp"]
    }
  }
}
"@
Write-Host "==================================================================" -ForegroundColor Cyan
