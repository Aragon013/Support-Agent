# RemoteSupportPro — Windows EXE Installers

Two Windows `.exe` installers, matching the agreed model:

1. **Host Agent** — single installer with an install-type (support profile) selector.
2. **Controller (operator client)** — assisted installer for the desktop app.

## Build

Run from the repo root (PowerShell). Node.js and npm must be available.

### Host installer (NSIS)

```powershell
powershell -ExecutionPolicy Bypass -File infra\release\windows\build-host-windows-installer.ps1 -Version 0.1.1
```

- Compiles `apps/host-agent`, stages `dist/ scripts/ package.json` + production `node_modules`.
- Compiles `host-installer.nsi` with `makensis`.
- makensis is auto-resolved from: PATH → common NSIS dirs → the NSIS that
  electron-builder already caches → (optional) portable download with `-AllowDownloadNsis`.
- Output: `artifacts/releases/host/windows/RemoteSupportPro-Host-Setup-v<version>.exe`

Installer flow on the endpoint:
1. Welcome
2. Connection settings (Control-plane URL, Tenant ID, Endpoint ID)
3. **Installation type** — support profile:
   - `remote_only` — remote session only, no file support actions
   - `support_limited_no_folders` — diagnostics/commands, no filesystem access
   - `support_full` — full support per tenant policy, incl. file capabilities
4. Install directory
5. Install → writes `install-profile.json`, installs + starts the Windows service
   with the chosen profile (service will not run with an absent/ambiguous profile).

Requires Node.js (LTS) on the endpoint (the installer verifies `node --version`).

### Controller installer (electron-builder / NSIS)

```powershell
powershell -ExecutionPolicy Bypass -File infra\release\windows\build-controller-windows-installer.ps1 -Version 0.1.1
```

- Runs `npm run dist:win` in `apps/controller-electron` (electron-builder).
- Assisted installer: per-user/per-machine choice + changeable install directory.
- Output: `artifacts/releases/controller/windows/installer/RemoteSupportPro-Controller-Setup-<version>.exe`

## Notes

- Host permissions remain enforced by control-plane policy and the endpoint registry;
  the selected profile is the local capability baseline (upper bound).
- To brand the controller, drop a 256x256 `icon.ico` in
  `apps/controller-electron/build/` and set `win.icon` in `electron-builder.yml`.
- First electron-builder run downloads Electron + toolchain over HTTPS. On machines
  without admin/Developer Mode, the `winCodeSign` archive contains macOS symlinks that
  fail to extract; pre-extract it once (ignoring those 2 symlink errors) into
  `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\` and re-run.
- The older `build-*-windows-bundle(s).ps1` scripts still produce the legacy
  ZIP + `npm install` bundles if needed.
