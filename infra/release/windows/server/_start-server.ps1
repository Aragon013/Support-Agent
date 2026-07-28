<#
  Motor del servidor de 1 clic. Lo invoca Start-Server.bat.
  - Arranca el control-plane (backend) accesible en la red (0.0.0.0:3000).
  - Antes de arrancar, MUESTRA las URLs que debes poner en el host (config.txt):
      * IP de Tailscale (100.x) si esta instalado  -> funciona desde cualquier red
      * IP local (192.168.x / 10.x) -> funciona en la misma red
  Usa el node.exe incluido en .\node (no requiere Node instalado).
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$nodeExe = Join-Path $root "node\node.exe"
if (-not (Test-Path $nodeExe)) {
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys) { $nodeExe = $sys.Source } else { throw "No se encontro node.exe (ni incluido ni en el sistema)." }
}
$serverJs = Join-Path $root "app\dist\server.js"
if (-not (Test-Path $serverJs)) { throw "No se encontro el backend en '$serverJs'. Bundle incompleto." }

$port = 3000

# Recolectar IPs utiles
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress

$tailscale = $ips | Where-Object { $_ -like '100.*' }
$lan = $ips | Where-Object { $_ -like '192.168.*' -or $_ -like '10.*' -or $_ -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.' }

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  URL para poner en el host (config.txt -> ControlPlaneUrl)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
if ($tailscale) {
  Write-Host "  DESDE CUALQUIER RED (Tailscale, recomendado):" -ForegroundColor Green
  foreach ($ip in $tailscale) { Write-Host ("     http://{0}:{1}" -f $ip, $port) -ForegroundColor Green }
} else {
  Write-Host "  (Tailscale no detectado. Para soportar PCs en otras redes," -ForegroundColor Yellow
  Write-Host "   instala Tailscale y usa la IP 100.x que aparezca aqui.)" -ForegroundColor Yellow
}
if ($lan) {
  Write-Host "  EN LA MISMA RED (LAN):" -ForegroundColor White
  foreach ($ip in $lan) { Write-Host ("     http://{0}:{1}" -f $ip, $port) -ForegroundColor White }
}
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Servidor arrancando... deja esta ventana ABIERTA mientras des soporte." -ForegroundColor Cyan
Write-Host "(Ctrl+C para detener)" -ForegroundColor DarkGray
Write-Host ""

# Accesible en toda la red, no solo localhost
$env:HOST = "0.0.0.0"
$env:PORT = "$port"
& $nodeExe $serverJs
