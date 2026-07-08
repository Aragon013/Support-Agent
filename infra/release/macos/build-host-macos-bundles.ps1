param(
  [string]$Version = "0.1.1",
  [string]$OutputRoot = "artifacts/releases"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$hostRoot = Join-Path $repoRoot "apps/host-agent"
$outRoot = Join-Path $repoRoot $OutputRoot
$hostOut = Join-Path $outRoot "host/macos"

Write-Host "[release] Building host-agent..."
& "C:\Program Files\nodejs\npm.cmd" --prefix $hostRoot run build
if ($LASTEXITCODE -ne 0) { throw "host-agent build failed" }

$profiles = @(
  "remote_only",
  "support_limited_no_folders",
  "support_full"
)

New-Item -ItemType Directory -Path $hostOut -Force | Out-Null

foreach ($profile in $profiles) {
  $stage = Join-Path $hostOut ("stage-" + $profile)
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  New-Item -ItemType Directory -Path $stage -Force | Out-Null

  Copy-Item -Recurse -Force (Join-Path $hostRoot "dist") (Join-Path $stage "dist")
  Copy-Item -Force (Join-Path $hostRoot "package.json") (Join-Path $stage "package.json")

  @{
    installProfile = $profile
    supportCommandsAllowed = $profile -ne "remote_only"
    folderActionsAllowed = $profile -eq "support_full"
  } | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 (Join-Path $stage "install-profile.json")

  @'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This installer must run on macOS."
  exit 1
fi

if [[ $# -lt 3 ]]; then
  echo "Usage: ./install-host-macos.sh <controlPlaneUrl> <tenantId> <endpointId>"
  exit 1
fi

CONTROL_PLANE_URL="$1"
TENANT_ID="$2"
ENDPOINT_ID="$3"
PROFILE="__PROFILE__"
SERVICE_NAME="com.remotesupportpro.hostagent.__PROFILE__.${ENDPOINT_ID//[^A-Za-z0-9_-]/-}"

NODE_PATH="$(command -v node || true)"
if [[ -z "$NODE_PATH" ]]; then
  echo "node not found in PATH"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CFG_DIR="/Library/Application Support/RemoteSupportPro/host-agent"
PLIST_PATH="/Library/LaunchDaemons/${SERVICE_NAME}.plist"
CFG_PATH="${CFG_DIR}/${SERVICE_NAME}.json"

sudo mkdir -p "$CFG_DIR"

cat <<JSON | sudo tee "$CFG_PATH" >/dev/null
{
  "controlPlaneUrl": "$CONTROL_PLANE_URL",
  "tenantId": "$TENANT_ID",
  "endpointId": "$ENDPOINT_ID",
  "maxConcurrent": 3,
  "timeoutMs": 30000
}
JSON

cat <<PLIST | sudo tee "$PLIST_PATH" >/dev/null
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${ROOT_DIR}/dist/agent.js</string>
    <string>--config</string>
    <string>${CFG_PATH}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/${SERVICE_NAME}.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/${SERVICE_NAME}.err.log</string>
</dict>
</plist>
PLIST

sudo launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
sudo launchctl load "$PLIST_PATH"

echo "Installed Host Agent with profile: $PROFILE"
'@.Replace("__PROFILE__", $profile) | Set-Content -Encoding UTF8 (Join-Path $stage "install-host-macos.sh")

  @"
RemoteSupportPro Host Bundle (macOS)
Profile: $profile
Version: $Version

Install steps:
1) Extract bundle on macOS endpoint
2) Ensure Node.js is installed
3) Run:
   chmod +x ./install-host-macos.sh
   ./install-host-macos.sh <controlPlaneUrl> <tenantId> <endpointId>

Notes:
- This package is profile-specific for macOS as requested.
- Effective permissions are enforced server-side by control-plane policy.
"@ | Set-Content -Encoding UTF8 (Join-Path $stage "README_RELEASE.txt")

  $zipName = "RemoteSupportPro-Host-macOS-$profile-v$Version.zip"
  $zipPath = Join-Path $hostOut $zipName
  if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
  Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

  Remove-Item -Recurse -Force $stage
  Write-Host "[release] Created $zipPath"
}

Write-Host "[release] Host macOS bundles generated in $hostOut"
