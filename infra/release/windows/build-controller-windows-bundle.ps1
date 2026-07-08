param(
  [string]$Version = "0.1.0",
  [string]$OutputRoot = "artifacts/releases"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$controllerRoot = Join-Path $repoRoot "apps/controller-electron"
$outRoot = Join-Path $repoRoot $OutputRoot
$controllerOut = Join-Path $outRoot "controller/windows"

Write-Host "[release] Building controller-electron..."
& "C:\Program Files\nodejs\npm.cmd" --prefix $controllerRoot run build
if ($LASTEXITCODE -ne 0) { throw "controller build failed" }

$stage = Join-Path $controllerOut "stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Copy-Item -Recurse -Force (Join-Path $controllerRoot "dist-electron") (Join-Path $stage "dist-electron")
Copy-Item -Recurse -Force (Join-Path $controllerRoot "dist-renderer") (Join-Path $stage "dist-renderer")
Copy-Item -Force (Join-Path $controllerRoot "package.json") (Join-Path $stage "package.json")

@"
RemoteSupportPro Controller Bundle (Windows)
Version: $Version

Run instructions:
1) Extract this bundle
2) Install dependencies once:
   npm install
3) Start desktop app:
   npm run start:desktop

Note:
- This is a release bundle for internal distribution.
- If you need EXE installer packaging, add electron-builder/forge publish step in CI.
"@ | Set-Content -Encoding UTF8 (Join-Path $stage "README_RELEASE.txt")

New-Item -ItemType Directory -Path $controllerOut -Force | Out-Null
$zipPath = Join-Path $controllerOut "RemoteSupportPro-Controller-Windows-v$Version.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

Remove-Item -Recurse -Force $stage
Write-Host "[release] Created $zipPath"
