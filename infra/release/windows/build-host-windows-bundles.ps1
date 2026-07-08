param(
  [string]$Version = "0.1.0",
  [string]$OutputRoot = "artifacts/releases"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$hostRoot = Join-Path $repoRoot "apps/host-agent"
$outRoot = Join-Path $repoRoot $OutputRoot
$hostOut = Join-Path $outRoot "host/windows"

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
  Copy-Item -Recurse -Force (Join-Path $hostRoot "scripts") (Join-Path $stage "scripts")
  Copy-Item -Force (Join-Path $hostRoot "package.json") (Join-Path $stage "package.json")

  @{
    installProfile = $profile
    supportCommandsAllowed = $profile -ne "remote_only"
    folderActionsAllowed = $profile -eq "support_full"
  } | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 (Join-Path $stage "install-profile.json")

  @"
RemoteSupportPro Host Bundle
Profile: $profile
Version: $Version

Install steps (Windows):
1) Extract this bundle
2) Ensure Node.js is installed on endpoint
3) From extracted folder run:
   npm run service:install
   npm run service:start

Notes:
- This bundle uses install-profile.json to communicate the intended support profile.
- Control-plane must validate capabilities from endpoint registry/policy.
"@ | Set-Content -Encoding UTF8 (Join-Path $stage "README_RELEASE.txt")

  $zipName = "RemoteSupportPro-Host-Windows-$profile-v$Version.zip"
  $zipPath = Join-Path $hostOut $zipName
  if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
  Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

  Remove-Item -Recurse -Force $stage
  Write-Host "[release] Created $zipPath"
}

Write-Host "[release] Host Windows bundles generated in $hostOut"
