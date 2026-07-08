RemoteSupportPro macOS release strategy

Agreed model:
- Build and publish 3 separate Host installers (one per profile):
  1) RemoteSupportPro-Host-macOS-remote_only.pkg
  2) RemoteSupportPro-Host-macOS-support_limited_no_folders.pkg
  3) RemoteSupportPro-Host-macOS-support_full.pkg

Controller:
- Publish one controller installer/package for operators:
  - RemoteSupportPro-Controller-macOS.dmg (or .pkg)

Why separate host installers on macOS:
- Simplifies profile enforcement and reduces install-time complexity.
- Aligns with security posture and permissions requirements on macOS.

Recommended CI release outputs:
- host/macos/*.pkg (3 files)
- controller/macos/*.dmg or *.pkg (1 file)
- checksums (sha256)
- signed metadata + release notes
