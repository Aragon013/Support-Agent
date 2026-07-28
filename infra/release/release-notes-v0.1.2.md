# RemoteSupportPro v0.1.2

Fecha: 2026-07-27

## Novedades

- **Tema oscuro** en el Controller (Configuración → Apariencia): Claro / Oscuro / Sistema, con persistencia entre sesiones.
- **Panel de Configuración real** (antes era un placeholder): selector de tema + información de conexión al backend.
- **Panel de Soporte más intuitivo**:
  - Campos con valores por defecto (`tenant-1`, `op-1`) → se acaban los errores de "tenant".
  - Selector desplegable de PCs registradas (endpoints) con autocompletado y botón "Refrescar".
  - Texto de ayuda bajo cada campo explicando qué poner y de dónde sale.
- **Guía de uso completa** añadida: `docs/USER_GUIDE.md`.

Sin cambios en el Host Agent respecto a v0.1.1 (los binarios de Host siguen siendo los de esa versión).

## Assets

### Windows (instalador EXE)

- `RemoteSupportPro-Controller-Setup-0.1.2.exe`
  - Instalador asistido NSIS (elección por-usuario / por-máquina + selección de carpeta).
  - Construido con: `infra/release/windows/build-controller-windows-installer.ps1 -Version 0.1.2`
    (electron-builder).

### Host (sin cambios)

- Usar los assets de Host de v0.1.1.

## Verificación de integridad

Ver `artifacts/releases/SHA256SUMS-v0.1.2.txt`.
