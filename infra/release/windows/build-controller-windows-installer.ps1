param(
  [string]$Version = "0.1.1",
  [string]$OutputRoot = "artifacts/releases"
)

# ---------------------------------------------------------------------------
# Builds the RemoteSupportPro Controller .exe installer via electron-builder.
# Output: artifacts/releases/controller/windows/installer/
#         RemoteSupportPro-Controller-Setup-<version>.exe
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$controllerRoot = Join-Path $repoRoot "apps/controller-electron"
$npm = "C:\Program Files\nodejs\npm.cmd"

# Keep electron-builder version in sync with package.json.
Write-Host "[release] Installing controller dependencies (incl. electron-builder)..."
& $npm --prefix $controllerRoot install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "[release] Building controller installer (NSIS)..."
& $npm --prefix $controllerRoot run dist:win
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

$installerDir = Join-Path $repoRoot (Join-Path $OutputRoot "controller/windows/installer")
Write-Host "[release] Controller installer output in: $installerDir"
Get-ChildItem -Path $installerDir -Filter *.exe -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host "  -> $($_.Name)" }
