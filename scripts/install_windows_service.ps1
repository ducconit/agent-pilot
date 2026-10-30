# Agent Pilot - Windows Background Service Setup via Task Scheduler
# Chay script nay bang PowerShell (Ho tro ca tai khoan tieu chuan va Administrator)

$ErrorActionPreference = "Stop"

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { $null = $_ }

$binaryPath = (Get-Command agent-pilot.exe -ErrorAction SilentlyContinue).Source
if (-not $binaryPath) {
    $LocalAppData = $env:LOCALAPPDATA
    if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
        $LocalAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    }
    if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
        $LocalAppData = Join-Path $env:USERPROFILE "AppData\Local"
    }
    $binaryPath = Join-Path $LocalAppData "Programs\agent-pilot\agent-pilot.exe"
}

if (-not (Test-Path $binaryPath)) {
    Write-Host "❌ Khong tim thay agent-pilot.exe tai: $binaryPath" -ForegroundColor Red
    exit 1
}

Write-Host "Installing Agent Pilot Background Bridge Service..." -ForegroundColor Cyan

# Dung task cu neu dang chay de tranh loi Task Scheduler
try { Stop-ScheduledTask -TaskName "AgentPilotBridge" -ErrorAction SilentlyContinue } catch { $null = $_ }

$action = New-ScheduledTaskAction -Execute $binaryPath -Argument "server"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName "AgentPilotBridge" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Agent Pilot Universal AI Agent Browser Bridge" -Force

Write-Host "Starting Agent Pilot Bridge Service..." -ForegroundColor Green
try {
    Start-ScheduledTask -TaskName "AgentPilotBridge"
} catch {
    Write-Warning "Khong the khoi dong Task Scheduler: $_"
}
Write-Host "Done! Agent Pilot Bridge is now running in background on port 58765." -ForegroundColor Green
