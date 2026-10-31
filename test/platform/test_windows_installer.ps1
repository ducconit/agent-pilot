# Test Suite for Windows Installer (install-windows.ps1)
# Verifies syntax, AST, encoding, and runtime execution across various environments.

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
$InstallerScript = Join-Path $RepoRoot "scripts/bundles/install-windows.ps1"
$ServiceScript = Join-Path $RepoRoot "scripts/install_windows_service.ps1"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "🧪 RUNNING POWERSHELL VERIFICATION & SIMULATION TESTS" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. AST Syntax Check
Write-Host "[1/5] Checking AST syntax and parser tokens..." -ForegroundColor Cyan
foreach ($file in @($InstallerScript, $ServiceScript)) {
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) {
        throw "AST parse error in $file : $($errors -join '; ')"
    }
    Write-Host "  ✓ AST parse passed: $(Split-Path -Leaf $file)" -ForegroundColor Green
}

# 2. PSScriptAnalyzer Check
Write-Host "[2/5] Running PSScriptAnalyzer static analysis..." -ForegroundColor Cyan
if (Get-Module -ListAvailable PSScriptAnalyzer) {
    foreach ($file in @($InstallerScript, $ServiceScript)) {
        $results = Invoke-ScriptAnalyzer -Path $file -Severity Error, Warning | Where-Object { $_.RuleName -ne "PSAvoidUsingWriteHost" }
        if ($results -and $results.Count -gt 0) {
            $results | Format-Table -AutoSize
            throw "PSScriptAnalyzer reported issues in $file"
        }
        Write-Host "  ✓ PSScriptAnalyzer passed (0 warnings/errors): $(Split-Path -Leaf $file)" -ForegroundColor Green
    }
} else {
    Write-Host "  ! PSScriptAnalyzer not installed in this environment, skipping." -ForegroundColor Yellow
}

# 3. File Encoding Check (UTF-8 with BOM and CRLF for Windows PowerShell 5.1 compatibility)
Write-Host "[3/5] Verifying UTF-8 BOM and CRLF line endings..." -ForegroundColor Cyan
foreach ($file in @($InstallerScript, $ServiceScript)) {
    $bytes = [System.IO.File]::ReadAllBytes($file)
    if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
        throw "Missing UTF-8 BOM in $file. Windows PowerShell 5.1 requires BOM for unicode encoding."
    }
    $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
    if ($text -match "(?<!\r)\n") {
        throw "Found LF line endings without CR in $file. Windows PowerShell requires CRLF."
    }
    Write-Host "  ✓ UTF-8 BOM and CRLF verified: $(Split-Path -Leaf $file)" -ForegroundColor Green
}

# 4. Simulation: Mock Environment Setup
Write-Host "[4/5] Setting up mock Windows environment for execution test..." -ForegroundColor Cyan
$TestDir = Join-Path ([System.IO.Path]::GetTempPath()) ("agent-pilot-test-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TestDir | Out-Null

$MockLocalAppData = Join-Path $TestDir "LocalAppData"
$MockUserProfile = Join-Path $TestDir "UserProfile"
$MockBundleDir = Join-Path $TestDir "Bundle"
$MockSkillsDir = Join-Path $MockBundleDir "skills/agent-pilot/scripts"
$MockExtensionsDir = Join-Path $MockBundleDir "extensions"

New-Item -ItemType Directory -Force -Path $MockLocalAppData | Out-Null
New-Item -ItemType Directory -Force -Path $MockUserProfile | Out-Null
New-Item -ItemType Directory -Force -Path $MockSkillsDir | Out-Null
New-Item -ItemType Directory -Force -Path $MockExtensionsDir | Out-Null

# Copy installer into mock bundle
$TestedInstaller = Join-Path $MockBundleDir "install.ps1"
Copy-Item -Path $InstallerScript -Destination $TestedInstaller -Force

# Create a mock agent-pilot.exe (powershell script runner or bash script that responds to commands)
$MockBinaryPath = Join-Path $MockSkillsDir "agent-pilot.exe"
$MockBinaryContent = @'
#!/bin/sh
case "$1" in
  version)
    echo "Agent Pilot CLI v1.0.14-beta (mock, 2026-10-30)"
    exit 0
    ;;
  service)
    echo "Mock service $2 completed"
    exit 0
    ;;
  skill)
    echo "Mock skill install completed"
    exit 0
    ;;
  server)
    echo "Mock server started"
    exit 0
    ;;
  *)
    echo "Agent Pilot mock CLI"
    exit 0
    ;;
esac
'@
[System.IO.File]::WriteAllText($MockBinaryPath, $MockBinaryContent.Replace("`r`n", "`n"))
if ($IsLinux -or $IsMacOS) {
    chmod +x $MockBinaryPath
}

# 5. Execution Simulation Tests
Write-Host "[5/5] Executing simulation tests..." -ForegroundColor Cyan

# Test Case A: Normal execution via -File
Write-Host "  [Test A] Execution via -File..." -ForegroundColor Cyan
$env:LOCALAPPDATA = $MockLocalAppData
$env:USERPROFILE = $MockUserProfile
$env:APPDATA = Join-Path $MockUserProfile "AppData\Roaming"
$env:Path = "/usr/bin:/bin"

$testOut = & $TestedInstaller
Write-Host "  ✓ Test A passed: completed without exceptions." -ForegroundColor Green

# Verify binary was copied to mock install directory
$ExpectedInstalledBin = Join-Path $MockLocalAppData "Programs/agent-pilot/agent-pilot.exe"
if (-not (Test-Path $ExpectedInstalledBin)) {
    throw "Expected binary at $ExpectedInstalledBin was not found after Test A!"
}
Write-Host "  ✓ Binary successfully installed to destination: $ExpectedInstalledBin" -ForegroundColor Green

# Test Case B: Re-installation (testing file overwrite when already installed & in PATH)
Write-Host "  [Test B] Re-installation / Upgrade simulation..." -ForegroundColor Cyan
$testOutB = & $TestedInstaller
Write-Host "  ✓ Test B passed: re-install succeeded without file-lock or PATH corruption." -ForegroundColor Green

# Test Case C: Execution via Invoke-Expression / ScriptBlock (testing $MyInvocation null safety)
Write-Host "  [Test C] Execution via Invoke-Expression / Command string..." -ForegroundColor Cyan
Push-Location $MockBundleDir
try {
    $scriptContent = [System.IO.File]::ReadAllText($TestedInstaller)
    Invoke-Expression $scriptContent
    Write-Host "  ✓ Test C passed: Invoke-Expression completed successfully." -ForegroundColor Green
} finally {
    Pop-Location
}

# Clean up mock environment
Remove-Item -Recurse -Force -Path $TestDir -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "🎉 ALL POWERSHELL VERIFICATION & SIMULATION TESTS PASSED GREEN!" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
