# Agent Pilot — Windows One-Step Installer (PowerShell)
# Cai dat agent-pilot.exe vao %LOCALAPPDATA%\Programs\agent-pilot, them vao User PATH,
# dang ky dich vu chay ngam (Windows Task Scheduler / Startup) va cai dat Agent Skill.

$ErrorActionPreference = "Stop"

# Dam bao ma hoa UTF-8 cho console tren Windows PowerShell 5.1 & PowerShell 7
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
    $null = $_
}

# Xac dinh thu muc chua script an toan cho moi cach chay (File, Command, Invoke-Expression)
$ScriptDir = $null
$CurrentDir = (Get-Location).Path

$PSScriptRootCandidate = if ($PSScriptRoot) {
    [System.IO.Path]::Combine([string[]]@($PSScriptRoot, "skills", "agent-pilot", "scripts", "agent-pilot.exe"))
} else { $null }

if ($PSScriptRoot -and (Test-Path $PSScriptRootCandidate)) {
    $ScriptDir = $PSScriptRoot
} elseif ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "agent-pilot.exe"))) {
    $ScriptDir = $PSScriptRoot
} elseif ($MyInvocation.MyCommand.Path -and (Test-Path $MyInvocation.MyCommand.Path)) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
} elseif ($MyInvocation.MyCommand.Definition -and (Test-Path $MyInvocation.MyCommand.Definition)) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
} else {
    $ScriptDir = $CurrentDir
}

# Neu thu muc tinh theo script khong chua binary nhung thu muc lam viec hien tai co chua
$ScriptBinaryCheck = [System.IO.Path]::Combine([string[]]@($ScriptDir, "skills", "agent-pilot", "scripts", "agent-pilot.exe"))
$CurrentBinaryCheck = [System.IO.Path]::Combine([string[]]@($CurrentDir, "skills", "agent-pilot", "scripts", "agent-pilot.exe"))
if (-not (Test-Path $ScriptBinaryCheck) -and -not (Test-Path (Join-Path $ScriptDir "agent-pilot.exe"))) {
    if ((Test-Path $CurrentBinaryCheck) -or (Test-Path (Join-Path $CurrentDir "agent-pilot.exe"))) {
        $ScriptDir = $CurrentDir
    }
}

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "🪟 AGENT PILOT — CAI DAT CHO WINDOWS" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# Tim kiem tep thuc thi agent-pilot.exe tu cac vi tri nguon kha di
$CandidateSources = @(
    ([System.IO.Path]::Combine([string[]]@($ScriptDir, "skills", "agent-pilot", "scripts", "agent-pilot.exe"))),
    (Join-Path $ScriptDir "agent-pilot.exe"),
    ([System.IO.Path]::Combine([string[]]@($CurrentDir, "skills", "agent-pilot", "scripts", "agent-pilot.exe"))),
    (Join-Path $CurrentDir "agent-pilot.exe"),
    (Join-Path $ScriptDir "cli\agent-pilot.exe"),
    ([System.IO.Path]::Combine([string[]]@($ScriptDir, "..", "skills", "agent-pilot", "scripts", "agent-pilot.exe")))
)
$BinarySrc = $null
foreach ($cand in $CandidateSources) {
    if ($cand -and (Test-Path -Path $cand -PathType Leaf)) {
        $BinarySrc = (Resolve-Path $cand).Path
        break
    }
}

if (-not $BinarySrc) {
    Write-Host "❌ Khong tim thay tep thuc thi 'agent-pilot.exe'!" -ForegroundColor Red
    Write-Host "   Vui long dam bao tep 'agent-pilot.exe' ton tai tai:" -ForegroundColor Yellow
    Write-Host "   - $([System.IO.Path]::Combine([string[]]@($ScriptDir, 'skills', 'agent-pilot', 'scripts', 'agent-pilot.exe'))) hoac" -ForegroundColor Yellow
    Write-Host "   - $(Join-Path $ScriptDir 'agent-pilot.exe')" -ForegroundColor Yellow
    exit 1
}

# Go bo danh dau Blocked cua Windows SmartScreen (Zone.Identifier)
if ($env:OS -eq "Windows_NT" -or (Get-Variable IsWindows -ErrorAction SilentlyContinue -ValueOnly)) {
    try { Unblock-File -Path $BinarySrc -ErrorAction SilentlyContinue } catch { $null = $_ }
}

# Xac dinh thu muc cai dat (%LOCALAPPDATA%\Programs\agent-pilot)
$LocalAppData = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
    $LocalAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
}
if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
    $LocalAppData = Join-Path $env:USERPROFILE "AppData\Local"
}
$InstallDir = Join-Path $LocalAppData "Programs\agent-pilot"
$BinaryDst = Join-Path $InstallDir "agent-pilot.exe"

# Tao thu muc cai dat neu chua co
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

# Dung tien trinh cu neu dang chay de tranh loi khoa file (File Lock) khi ghi de
Get-Process -Name "agent-pilot" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
try { Stop-ScheduledTask -TaskName "AgentPilotBridge" -ErrorAction SilentlyContinue } catch { $null = $_ }
Start-Sleep -Milliseconds 300

# Chep binary vao thu muc cai dat (retry 3 lan neu can)
for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
        Copy-Item -Path $BinarySrc -Destination $BinaryDst -Force -ErrorAction Stop
        break
    } catch {
        if ($attempt -lt 3) {
            Get-Process -Name "agent-pilot" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 700
        } else {
            Write-Host "❌ Khong the ghi de tep binary tai: $BinaryDst" -ForegroundColor Red
            Write-Host "   Chi tiet loi: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "   Vui long dong cac ung dung dang dung agent-pilot roi thu lai." -ForegroundColor Yellow
            exit 1
        }
    }
}

if ($env:OS -eq "Windows_NT" -or (Get-Variable IsWindows -ErrorAction SilentlyContinue -ValueOnly)) {
    try { Unblock-File -Path $BinaryDst -ErrorAction SilentlyContinue } catch { $null = $_ }
}
Write-Host "✅ Da cai dat binary vao: $BinaryDst" -ForegroundColor Green

# Them vao User PATH an toan (tranh trung lap va giu nguyen PATH hien tai)
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ([string]::IsNullOrWhiteSpace($UserPath)) { $UserPath = "" }
$NormalizedInstallDir = $InstallDir.Trim().TrimEnd('\', '/')

$ExistingPaths = $UserPath -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$AlreadyInUserPath = $false
foreach ($p in $ExistingPaths) {
    if ($p.Trim().TrimEnd('\', '/') -ieq $NormalizedInstallDir) {
        $AlreadyInUserPath = $true
        break
    }
}

if (-not $AlreadyInUserPath) {
    $NewUserPath = if ($UserPath.EndsWith(";") -or $UserPath -eq "") { "$UserPath$InstallDir" } else { "$UserPath;$InstallDir" }
    [Environment]::SetEnvironmentVariable("Path", $NewUserPath, "User")
    Write-Host "✅ Da them '$InstallDir' vao User PATH." -ForegroundColor Green
}

# Cap nhat PATH cho phien lam viec hien tai
$CurrentSessionPaths = $env:Path -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$AlreadyInSessionPath = $false
foreach ($p in $CurrentSessionPaths) {
    if ($p.Trim().TrimEnd('\', '/') -ieq $NormalizedInstallDir) {
        $AlreadyInSessionPath = $true
        break
    }
}
if (-not $AlreadyInSessionPath) {
    $env:Path = "$env:Path;$InstallDir"
}

# Dang ky va khoi dong dich vu chay ngam
Write-Host "→ Dang dang ky va kich hoat dich vu chay ngam..." -ForegroundColor Cyan
$serviceInstalled = $false

# 1. Thu dang ky qua CLI service install (Task Scheduler)
try {
    $null = & $BinaryDst service install 2>&1
    if ($LASTEXITCODE -eq 0) {
        $serviceInstalled = $true
    }
} catch {
    $null = $_
}

# 2. Neu Task Scheduler chua khoi dong duoc (do chinh sach khong cho hoac quyen han che),
# dung fallback thu muc Startup cua nguoi dung
if (-not $serviceInstalled) {
    try {
        $StartupFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
        if (-not [string]::IsNullOrWhiteSpace($StartupFolder) -and (Test-Path $StartupFolder)) {
            $VbsLauncherPath = Join-Path $StartupFolder "AgentPilotBridge.vbs"
            $VbsScript = "CreateObject(`"Wscript.Shell`").Run `"`"`"$BinaryDst`"`" server`", 0, False"
            [System.IO.File]::WriteAllText($VbsLauncherPath, $VbsScript, [System.Text.Encoding]::ASCII)
            Write-Host "✅ Da dang ky tu khoi dong qua thu muc Startup: $VbsLauncherPath" -ForegroundColor Green
            $serviceInstalled = $true
        }
    } catch {
        Write-Warning "Khong the dang ky tu khoi dong vao thu muc Startup: $_"
    }
}

# 3. Kiem tra va khoi dong tien trinh bridge server ngay neu chua chay
$bridgeRunning = $false
try {
    $testReq = Invoke-WebRequest -Uri "http://127.0.0.1:58765/api/ping" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($testReq -and $testReq.StatusCode -eq 200) {
        $bridgeRunning = $true
    }
} catch {
    $null = $_
}

if (-not $bridgeRunning) {
    try {
        Start-Process -FilePath $BinaryDst -ArgumentList "server" -WindowStyle Hidden
        Start-Sleep -Seconds 1
        Write-Host "✅ Da khoi chay Agent Pilot Bridge chay ngam tren cong 58765." -ForegroundColor Green
    } catch {
        Write-Warning "Khong the khoi chay bridge server tu dong. Ban co the chay thu cong: agent-pilot server"
    }
} else {
    Write-Host "✅ Agent Pilot Bridge dang hoat dong tren cong 58765." -ForegroundColor Green
}

# Cai dat Agent Skill cho AI Agent
Write-Host "→ Dang cai dat Agent Skill..." -ForegroundColor Cyan
try { & $BinaryDst skill install --force } catch { Write-Warning "Cai dat skill mac dinh: $_" }
try { & $BinaryDst skill install --agy --force } catch { Write-Warning "Cai dat skill cho Antigravity: $_" }

$EscapedBinaryDst = $BinaryDst.Replace("\", "\\")
$ExtensionsDir = [System.IO.Path]::Combine([string[]]@($ScriptDir, "extensions"))

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "🎉 HOAN TAT CAI DAT AGENT PILOT TREN WINDOWS!" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "1. Mo Google Chrome -> chrome://extensions -> bat Developer mode"
Write-Host "   -> bam 'Load unpacked' va chon thu muc:"
Write-Host "   $ExtensionsDir" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. Them cau hinh MCP Server sau vao AI Agent cua ban:"
$AppData = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE "AppData\Roaming" }
$UserProfile = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
Write-Host "   - Antigravity: $(Join-Path $UserProfile '.gemini\config\mcp_config.json')"
Write-Host "   - Claude Desktop: $(Join-Path $AppData 'Claude\claude_desktop_config.json')"
Write-Host "   - Cursor: $(Join-Path $UserProfile '.cursor\mcp.json')"
Write-Host ""
Write-Host "{"
Write-Host '  "mcpServers": {'
Write-Host '    "agent-pilot": {'
Write-Host "      `"command`": `"$EscapedBinaryDst`","
Write-Host '      "args": ["mcp"]'
Write-Host '    }'
Write-Host '  }'
Write-Host "}"
Write-Host "==================================================================" -ForegroundColor Cyan
