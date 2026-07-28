<#
  Motor del instalador de 1 clic. Lo invoca Install-Host.bat (ya elevado).
  - Lee config.txt (misma carpeta).
  - EndpointId vacio => usa el nombre del equipo (unico por PC, sin escribir nada).
  - Usa el node.exe incluido en .\node (no requiere Node instalado).
  - Registra e inicia el servicio de Windows del host-agent.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Read-ConfigFile([string]$path) {
  $cfg = @{}
  if (-not (Test-Path $path)) { return $cfg }
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $idx = $t.IndexOf("=")
    if ($idx -lt 1) { continue }
    $key = $t.Substring(0, $idx).Trim()
    $val = $t.Substring($idx + 1).Trim()
    $cfg[$key] = $val
  }
  return $cfg
}

Write-Host "== RemoteSupportPro - Instalacion del Host ==" -ForegroundColor Cyan

$cfg = Read-ConfigFile (Join-Path $root "config.txt")

$controlPlaneUrl = $cfg["ControlPlaneUrl"]
$tenantId        = $cfg["TenantId"]
$installProfile  = $cfg["InstallProfile"]
$endpointId      = $cfg["EndpointId"]

if ([string]::IsNullOrWhiteSpace($endpointId)) { $endpointId = $env:COMPUTERNAME }
if ([string]::IsNullOrWhiteSpace($installProfile)) { $installProfile = "support_full" }

$validProfiles = @("remote_only", "support_limited_no_folders", "support_full")
if ($validProfiles -notcontains $installProfile) {
  throw "InstallProfile invalido en config.txt: '$installProfile'. Usa: $($validProfiles -join ', ')"
}
if ([string]::IsNullOrWhiteSpace($controlPlaneUrl) -or $controlPlaneUrl -like "*TU-SERVIDOR*") {
  throw "Falta configurar ControlPlaneUrl en config.txt (aun tiene el valor de ejemplo)."
}
if ([string]::IsNullOrWhiteSpace($tenantId)) {
  throw "Falta configurar TenantId en config.txt."
}

# node incluido en el bundle; si no esta, usar el del sistema como respaldo.
$nodeExe = Join-Path $root "node\node.exe"
if (-not (Test-Path $nodeExe)) {
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys) { $nodeExe = $sys.Source } else { throw "No se encontro node.exe (ni incluido ni en el sistema)." }
}

$agentJs = Join-Path $root "app\dist\agent.js"
if (-not (Test-Path $agentJs)) { throw "No se encontro el agente en '$agentJs'. Bundle incompleto." }

$safeEndpoint = ($endpointId -replace "[^A-Za-z0-9_-]", "-")
$serviceName  = "RemoteSupportProHostAgent-$safeEndpoint"
$displayName  = "RemoteSupportPro Host Agent ($endpointId)"

Write-Host "Servidor : $controlPlaneUrl"
Write-Host "Cliente  : $tenantId"
Write-Host "PC       : $endpointId"
Write-Host "Perfil   : $installProfile"
Write-Host "Servicio : $serviceName"
Write-Host ""

# Escribir configuracion en ProgramData
$configDir = Join-Path $env:ProgramData "RemoteSupportPro\host-agent"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$configPath = Join-Path $configDir "$serviceName.json"

[ordered]@{
  controlPlaneUrl        = $controlPlaneUrl
  tenantId               = $tenantId
  endpointId             = $endpointId
  maxConcurrent          = 3
  timeoutMs              = 30000
  installProfile         = $installProfile
  supportCommandsAllowed = $installProfile -ne "remote_only"
  folderActionsAllowed   = $installProfile -eq "support_full"
} | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8

# Perfil local junto al agente
[ordered]@{
  installProfile         = $installProfile
  supportCommandsAllowed = $installProfile -ne "remote_only"
  folderActionsAllowed   = $installProfile -eq "support_full"
} | ConvertTo-Json | Set-Content -Path (Join-Path $root "app\install-profile.json") -Encoding UTF8

# Si ya existe el servicio, reinstalar limpio
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "El servicio ya existe: se reinstala." -ForegroundColor Yellow
  & sc.exe stop $serviceName | Out-Null
  Start-Sleep -Seconds 1
  & sc.exe delete $serviceName | Out-Null
  Start-Sleep -Seconds 1
}

$binPath = '"' + $nodeExe + '" "' + $agentJs + '" --config "' + $configPath + '"'

& sc.exe create $serviceName binPath= $binPath start= auto obj= "NT AUTHORITY\LocalService" DisplayName= $displayName | Out-Null
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& sc.exe description $serviceName "RemoteSupportPro host agent service" | Out-Null
& sc.exe start $serviceName | Out-Null

Start-Sleep -Seconds 1
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
  Write-Host "`nLISTO: servicio instalado y en ejecucion." -ForegroundColor Green
} else {
  Write-Host "`nServicio creado. Estado actual: $($svc.Status). Revisa el Visor de eventos si no arranca." -ForegroundColor Yellow
}
Write-Host "Config: $configPath"
