# RemoteSupportPro v0.1.1

## Highlights

- Windows packaging aligned to requested model:
  - 1 unified Host package with install-time profile selection
  - 1 Controller/Client package
- macOS packaging added for Host with separate profile-specific bundles:
  - remote_only
  - support_limited_no_folders
  - support_full
- Cybersecurity UX centralized in one intuitive section with subtabs:
  - SecAudit, Compliance, Exceptions, Alerts, Resilience, Audit Log
- Added full operations guide (MD/HTML/PDF)

## Release Assets

### Windows (EXE installers)

- RemoteSupportPro-Host-Setup-v0.1.1.exe
  - Single Host installer with install-time profile selection page
    (remote_only | support_limited_no_folders | support_full).
  - Collects control-plane URL / tenant / endpoint, writes install-profile.json,
    installs and starts the Windows service. Bundles Node runtime deps.
  - Built via: infra/release/windows/build-host-windows-installer.ps1 (NSIS).
- RemoteSupportPro-Controller-Setup-0.1.1.exe
  - Assisted NSIS installer (per-user/per-machine choice + directory selection).
  - Built via: infra/release/windows/build-controller-windows-installer.ps1
    (electron-builder).

### Windows (legacy ZIP bundles, npm-based)

- RemoteSupportPro-Host-Windows-v0.1.1.zip
- RemoteSupportPro-Controller-Windows-v0.1.1.zip

### macOS

- RemoteSupportPro-Host-macOS-remote_only-v0.1.1.zip
- RemoteSupportPro-Host-macOS-support_limited_no_folders-v0.1.1.zip
- RemoteSupportPro-Host-macOS-support_full-v0.1.1.zip

### Integrity

- SHA256SUMS-v0.1.1.txt

## Notes

- Host permissions are still enforced by control-plane policy and endpoint registry.
- macOS controller DMG/PKG is not generated in this Windows environment; host bundles are included per agreed model.
