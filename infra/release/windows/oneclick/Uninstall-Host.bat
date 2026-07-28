@echo off
REM ============================================================================
REM  RemoteSupportPro - Desinstalador de 1 clic del Host
REM  Doble clic para quitar el servicio. Pedira permiso de administrador.
REM ============================================================================
setlocal

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_uninstall.ps1"

echo.
pause
