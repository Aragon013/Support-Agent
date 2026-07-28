param(
  [string]$Version = "0.1.1",
  [string]$OutputRoot = "artifacts/releases",
  [string]$MakensisPath,
  [switch]$AllowDownloadNsis
)

# ---------------------------------------------------------------------------
# Builds the RemoteSupportPro Host Agent .exe installer (NSIS).
# - Compiles host-agent (npm run build)
# - Stages dist/ scripts/ package.json into a temp payload
# - Invokes makensis on host-installer.nsi
# Output: artifacts/releases/host/windows/RemoteSupportPro-Host-Setup-v<version>.exe
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$hostRoot = Join-Path $repoRoot "apps/host-agent"
$hostOut = Join-Path $repoRoot (Join-Path $OutputRoot "host/windows")
$nsi = Join-Path $PSScriptRoot "host-installer.nsi"

function Resolve-Makensis {
  param([string]$Explicit, [bool]$AllowDownload)

  if ($Explicit -and (Test-Path $Explicit)) { return (Resolve-Path $Explicit).Path }

  $cmd = Get-Command makensis -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    "$env:ProgramFiles\NSIS\makensis.exe",
    "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
    "$env:LOCALAPPDATA\RemoteSupportPro\nsis\makensis.exe"
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }

  # Reuse the full NSIS that electron-builder already caches (has MUI2, nsDialogs,
  # nsExec and the modern icons) — avoids a separate NSIS install/download.
  $ebNsis = Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\nsis" -Directory -ErrorAction SilentlyContinue |
    Where-Object Name -like 'nsis-3*' |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if ($ebNsis) {
    $ebMakensis = Join-Path $ebNsis.FullName "makensis.exe"
    if (Test-Path $ebMakensis) { return $ebMakensis }
  }

  if (-not $AllowDownload) {
    throw "makensis.exe not found. Install NSIS, pass -MakensisPath, or re-run with -AllowDownloadNsis to fetch a portable copy."
  }

  # Portable NSIS download (no admin) into local cache.
  $nsisVer = "3.10"
  $cacheDir = Join-Path $env:LOCALAPPDATA "RemoteSupportPro\nsis"
  New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
  $zip = Join-Path $cacheDir "nsis-$nsisVer.zip"
  $url = "https://sourceforge.net/projects/nsis/files/NSIS%203/$nsisVer/nsis-$nsisVer.zip/download"
  Write-Host "[release] Downloading portable NSIS $nsisVer..."
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -MaximumRedirection 10 -Headers @{ 'User-Agent' = 'Mozilla/5.0' }
  Expand-Archive -Path $zip -DestinationPath $cacheDir -Force
  $found = Get-ChildItem -Path $cacheDir -Recurse -Filter makensis.exe | Select-Object -First 1
  if (-not $found) { throw "Failed to locate makensis.exe after download." }
  Copy-Item $found.FullName (Join-Path $cacheDir "makensis.exe") -Force
  return (Join-Path $cacheDir "makensis.exe")
}

Write-Host "[release] Building host-agent..."
& "C:\Program Files\nodejs\npm.cmd" --prefix $hostRoot run build
if ($LASTEXITCODE -ne 0) { throw "host-agent build failed" }

$makensis = Resolve-Makensis -Explicit $MakensisPath -AllowDownload:$AllowDownloadNsis.IsPresent
Write-Host "[release] Using makensis: $makensis"

# Stage payload
$stage = Join-Path $PSScriptRoot "stage-installer"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -Recurse -Force (Join-Path $hostRoot "dist") (Join-Path $stage "dist")
Copy-Item -Recurse -Force (Join-Path $hostRoot "scripts") (Join-Path $stage "scripts")
Copy-Item -Force (Join-Path $hostRoot "package.json") (Join-Path $stage "package.json")

# Bundle production node_modules so the endpoint does not need `npm install`.
# Copy the already-built modules (keeps prebuilt native bindings) then prune devDeps.
Write-Host "[release] Staging production node_modules..."
Copy-Item -Recurse -Force (Join-Path $hostRoot "node_modules") (Join-Path $stage "node_modules")
& "C:\Program Files\nodejs\npm.cmd" --prefix $stage prune --omit=dev 2>&1 | Out-Null

New-Item -ItemType Directory -Path $hostOut -Force | Out-Null
$outFile = "RemoteSupportPro-Host-Setup-v$Version.exe"

Push-Location $PSScriptRoot
try {
  & $makensis "/DVERSION=$Version" "/DPAYLOAD=stage-installer" "/DOUTFILE=$outFile" "host-installer.nsi"
  if ($LASTEXITCODE -ne 0) { throw "makensis failed with exit $LASTEXITCODE" }
} finally {
  Pop-Location
}

$built = Join-Path $PSScriptRoot $outFile
Move-Item -Force $built (Join-Path $hostOut $outFile)
Remove-Item -Recurse -Force $stage

# Firma de código (Authenticode). Solo firma si hay certificado configurado;
# de lo contrario avisa y sigue. Ver README_SIGNING.md.
& (Join-Path $PSScriptRoot "sign-artifact.ps1") -Path (Join-Path $hostOut $outFile)

Write-Host "[release] Created $(Join-Path $hostOut $outFile)"
