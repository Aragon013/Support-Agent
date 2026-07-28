@echo off
REM ============================================================================
REM  RemoteSupportPro - Instalador de 1 clic del Host (sin comandos)
REM  Doble clic para instalar. Pedira permiso de administrador (di "Si").
REM ============================================================================
setlocal

REM --- Autoelevacion a administrador ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_install.ps1"

echo.
echo ================================================
echo   Proceso finalizado. Puedes cerrar esta ventana.
echo ================================================
pause
