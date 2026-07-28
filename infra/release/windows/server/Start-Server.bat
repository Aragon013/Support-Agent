@echo off
REM ============================================================================
REM  RemoteSupportPro - Servidor de 1 clic (control-plane)
REM  Doble clic para arrancar el servidor. Muestra la URL que va en el host.
REM  Deja esta ventana abierta mientras das soporte.
REM ============================================================================
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_start-server.ps1"
echo.
echo El servidor se detuvo. Pulsa una tecla para cerrar.
pause >nul
