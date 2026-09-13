# Agent Pilot - Windows Background Service Setup via Task Scheduler
# Chay script nay bang PowerShell (Khong can Administrator)

$binaryPath = (Get-Command agent-pilot.exe -ErrorAction SilentlyContinue).Source
if (-not $binaryPath) {
    $binaryPath = "$env:LOCALAPPDATA\Programs\agent-pilot\agent-pilot.exe"
}

Write-Host "Installing Agent Pilot Background Bridge Service..." -ForegroundColor Cyan
$action = New-ScheduledTaskAction -Execute $binaryPath -Argument "server"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName "AgentPilotBridge" -Action $action -Trigger $trigger -Settings $settings -Description "Agent Pilot Universal AI Agent Browser Bridge" -Force

Write-Host "Starting Agent Pilot Bridge Service..." -ForegroundColor Green
Start-ScheduledTask -TaskName "AgentPilotBridge"
Write-Host "Done! Agent Pilot Bridge is now running in background on port 58765." -ForegroundColor Green
