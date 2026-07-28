<#
  Desinstalador de 1 clic. Lo invoca Uninstall-Host.bat (ya elevado).
  Detiene y elimina el servicio del host-agent de esta PC.
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
    $cfg[$t.Substring(0, $idx).Trim()] = $t.Substring($idx + 1).Trim()
  }
  return $cfg
}

$cfg = Read-ConfigFile (Join-Path $root "config.txt")
$endpointId = $cfg["EndpointId"]
if ([string]::IsNullOrWhiteSpace($endpointId)) { $endpointId = $env:COMPUTERNAME }
$safeEndpoint = ($endpointId -replace "[^A-Za-z0-9_-]", "-")
$serviceName  = "RemoteSupportProHostAgent-$safeEndpoint"

$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $svc) {
  Write-Host "No hay servicio '$serviceName' instalado en esta PC." -ForegroundColor Yellow
  return
}

Write-Host "Deteniendo y eliminando '$serviceName'..." -ForegroundColor Cyan
& sc.exe stop $serviceName | Out-Null
Start-Sleep -Seconds 1
& sc.exe delete $serviceName | Out-Null

$configPath = Join-Path (Join-Path $env:ProgramData "RemoteSupportPro\host-agent") "$serviceName.json"
if (Test-Path $configPath) { Remove-Item $configPath -Force -ErrorAction SilentlyContinue }

Write-Host "LISTO: servicio desinstalado." -ForegroundColor Green
