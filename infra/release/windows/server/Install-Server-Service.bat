@echo off
REM ============================================================================
REM  RemoteSupportPro - Instalar el Servidor como servicio (arranca solo)
REM  Doble clic. Pedira permiso de administrador.
REM ============================================================================
setlocal
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_install-server-service.ps1"
echo.
pause
