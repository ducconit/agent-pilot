# Backward compatibility forwarding stub.
# Target: ../test/platform/test_windows_installer.ps1
$Canonical = Join-Path $PSScriptRoot "../test/platform/test_windows_installer.ps1"
& $Canonical @args
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
