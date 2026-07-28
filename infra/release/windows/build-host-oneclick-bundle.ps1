param(
  [string]$Version = "0.1.2",
  [string]$OutputRoot = "artifacts/releases",
  [string]$NodeExe = "C:\Program Files\nodejs\node.exe"
)

# ---------------------------------------------------------------------------
# Arma el bundle "Host de 1 clic": carpeta con node.exe incluido, el agente
# compilado y los .bat/.ps1 de instalacion. Sin instalador .exe (evita el
# bloqueo de SmartScreen / Smart App Control), sin necesidad de Node en destino.
# Salida: artifacts/releases/host/windows/RemoteSupportPro-Host-OneClick-v<version>.zip
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$hostRoot = Join-Path $repoRoot "apps/host-agent"
$hostOut  = Join-Path $repoRoot (Join-Path $OutputRoot "host/windows")
$oneclick = Join-Path $PSScriptRoot "oneclick"
$npm      = "C:\Program Files\nodejs\npm.cmd"

if (-not (Test-Path $NodeExe)) { throw "node.exe no encontrado en '$NodeExe'. Pasa -NodeExe con la ruta correcta." }

Write-Host "[oneclick] Compilando host-agent..."
& $npm --prefix $hostRoot run build
if ($LASTEXITCODE -ne 0) { throw "host-agent build fallo" }

# Carpeta de trabajo del bundle
$stage = Join-Path $PSScriptRoot "stage-oneclick"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
$bundleName = "RemoteSupportPro-Host-OneClick-v$Version"
$bundleDir = Join-Path $stage $bundleName
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

# app/ = agente compilado + node_modules de produccion + package.json
$appDir = Join-Path $bundleDir "app"
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item -Recurse -Force (Join-Path $hostRoot "dist") (Join-Path $appDir "dist")
Copy-Item -Force (Join-Path $hostRoot "package.json") (Join-Path $appDir "package.json")

Write-Host "[oneclick] Copiando node_modules de produccion..."
Copy-Item -Recurse -Force (Join-Path $hostRoot "node_modules") (Join-Path $appDir "node_modules")
& $npm --prefix $appDir prune --omit=dev 2>&1 | Out-Null

# node/ = runtime portatil (node.exe firmado por Microsoft/OpenJS)
$nodeDir = Join-Path $bundleDir "node"
New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
Copy-Item -Force $NodeExe (Join-Path $nodeDir "node.exe")

# Scripts de 1 clic + config + LEEME
foreach ($f in @("Install-Host.bat", "Uninstall-Host.bat", "_install.ps1", "_uninstall.ps1", "config.txt", "LEEME.txt")) {
  Copy-Item -Force (Join-Path $oneclick $f) (Join-Path $bundleDir $f)
}

# Empaquetar ZIP
New-Item -ItemType Directory -Path $hostOut -Force | Out-Null
$zipPath = Join-Path $hostOut "$bundleName.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Write-Host "[oneclick] Comprimiendo..."
Compress-Archive -Path $bundleDir -DestinationPath $zipPath -Force

Remove-Item -Recurse -Force $stage

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "[oneclick] Creado: $zipPath ($sizeMb MB)"
