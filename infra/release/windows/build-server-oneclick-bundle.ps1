param(
  [string]$Version = "0.1.2",
  [string]$OutputRoot = "artifacts/releases",
  [string]$NodeExe = "C:\Program Files\nodejs\node.exe"
)

# ---------------------------------------------------------------------------
# Arma el bundle "Servidor de 1 clic" (control-plane): carpeta con node.exe
# incluido, el backend compilado y Start-Server.bat / Install-Server-Service.bat.
# Salida: artifacts/releases/server/windows/RemoteSupportPro-Server-OneClick-v<version>.zip
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$cpRoot   = Join-Path $repoRoot "apps/control-plane"
$serverOut = Join-Path $repoRoot (Join-Path $OutputRoot "server/windows")
$tpl      = Join-Path $PSScriptRoot "server"
$npm      = "C:\Program Files\nodejs\npm.cmd"

if (-not (Test-Path $NodeExe)) { throw "node.exe no encontrado en '$NodeExe'." }

Write-Host "[server] Compilando control-plane..."
& $npm --prefix $cpRoot run build
if ($LASTEXITCODE -ne 0) { throw "control-plane build fallo" }

$stage = Join-Path $PSScriptRoot "stage-server"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
$bundleName = "RemoteSupportPro-Server-OneClick-v$Version"
$bundleDir = Join-Path $stage $bundleName
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

# app/ = backend compilado + node_modules de produccion + package.json
$appDir = Join-Path $bundleDir "app"
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item -Recurse -Force (Join-Path $cpRoot "dist") (Join-Path $appDir "dist")
Copy-Item -Force (Join-Path $cpRoot "package.json") (Join-Path $appDir "package.json")

Write-Host "[server] Copiando node_modules de produccion..."
Copy-Item -Recurse -Force (Join-Path $cpRoot "node_modules") (Join-Path $appDir "node_modules")
& $npm --prefix $appDir prune --omit=dev 2>&1 | Out-Null

# node/ portatil
$nodeDir = Join-Path $bundleDir "node"
New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
Copy-Item -Force $NodeExe (Join-Path $nodeDir "node.exe")

foreach ($f in @("Start-Server.bat", "_start-server.ps1", "Install-Server-Service.bat", "_install-server-service.ps1", "LEEME.txt")) {
  Copy-Item -Force (Join-Path $tpl $f) (Join-Path $bundleDir $f)
}

New-Item -ItemType Directory -Path $serverOut -Force | Out-Null
$zipPath = Join-Path $serverOut "$bundleName.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Write-Host "[server] Comprimiendo..."
Compress-Archive -Path $bundleDir -DestinationPath $zipPath -Force

Remove-Item -Recurse -Force $stage
$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "[server] Creado: $zipPath ($sizeMb MB)"
