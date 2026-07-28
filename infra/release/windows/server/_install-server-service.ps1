<#
  Instala el servidor (control-plane) como servicio de Windows (arranca solo).
  Lo invoca Install-Server-Service.bat (ya elevado).
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$nodeExe = Join-Path $root "node\node.exe"
if (-not (Test-Path $nodeExe)) {
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys) { $nodeExe = $sys.Source } else { throw "No se encontro node.exe." }
}
$appDir  = Join-Path $root "app"
$serverJs = Join-Path $appDir "dist\server.js"
if (-not (Test-Path $serverJs)) { throw "No se encontro '$serverJs'. Bundle incompleto." }

# Wrapper ESM que fija HOST/PORT y arranca el server (para el servicio).
$entry = Join-Path $appDir "dist\service-entry.mjs"
@"
process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.PORT = process.env.PORT || '3000';
await import('./server.js');
"@ | Set-Content -Path $entry -Encoding UTF8

$serviceName = "RemoteSupportProControlPlane"
$displayName = "RemoteSupportPro Control Plane"

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Servicio existente: se reinstala." -ForegroundColor Yellow
  & sc.exe stop $serviceName | Out-Null
  Start-Sleep -Seconds 1
  & sc.exe delete $serviceName | Out-Null
  Start-Sleep -Seconds 1
}

$binPath = '"' + $nodeExe + '" "' + $entry + '"'
& sc.exe create $serviceName binPath= $binPath start= auto obj= "LocalSystem" DisplayName= $displayName | Out-Null
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& sc.exe description $serviceName "RemoteSupportPro control-plane (backend)" | Out-Null
& sc.exe start $serviceName | Out-Null

Start-Sleep -Seconds 1
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
  Write-Host "`nLISTO: servidor instalado como servicio y en ejecucion (puerto 3000)." -ForegroundColor Green
  Write-Host "Ahora ejecuta Start-Server.bat una vez SOLO para ver la URL, o revisa la IP en Tailscale." -ForegroundColor Cyan
} else {
  Write-Host "`nServicio creado. Estado: $($svc.Status)." -ForegroundColor Yellow
}
