param(
  [string]$Version = "0.1.0",
  [string]$OutputRoot = "artifacts/releases",
  [switch]$SplitByProfile
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

if ($SplitByProfile) {
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

  Write-Host "[release] Host Windows profile-split bundles generated in $hostOut"
  return
}

$stage = Join-Path $hostOut "stage-unified"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Copy-Item -Recurse -Force (Join-Path $hostRoot "dist") (Join-Path $stage "dist")
Copy-Item -Recurse -Force (Join-Path $hostRoot "scripts") (Join-Path $stage "scripts")
Copy-Item -Force (Join-Path $hostRoot "package.json") (Join-Path $stage "package.json")

@"
param(
  [Parameter(Mandatory = `$true)]
  [string]`$ControlPlaneUrl,

  [Parameter(Mandatory = `$true)]
  [string]`$TenantId,

  [Parameter(Mandatory = `$true)]
  [string]`$EndpointId,

  [string]`$ServiceName,
  [string]`$DisplayName,
  [int]`$MaxConcurrent = 3,
  [int]`$TimeoutMs = 30000,
  [ValidateSet("remote_only", "support_limited_no_folders", "support_full")]
  [string]`$InstallProfile
)

`$ErrorActionPreference = "Stop"

if (-not `$InstallProfile) {
  Write-Host "Select Host support profile:" -ForegroundColor Cyan
  Write-Host "  1) remote_only"
  Write-Host "  2) support_limited_no_folders"
  Write-Host "  3) support_full"
  `$choice = Read-Host "Enter option (1-3)"
  switch (`$choice) {
    "1" { `$InstallProfile = "remote_only" }
    "2" { `$InstallProfile = "support_limited_no_folders" }
    "3" { `$InstallProfile = "support_full" }
    default { throw "Invalid option. Use 1, 2 or 3." }
  }
}

@{
  installProfile = `$InstallProfile
  supportCommandsAllowed = `$InstallProfile -ne "remote_only"
  folderActionsAllowed = `$InstallProfile -eq "support_full"
} | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 (Join-Path `$PSScriptRoot "install-profile.json")

Write-Host "Using profile: `$InstallProfile" -ForegroundColor Green

& (Join-Path `$PSScriptRoot "scripts/install-windows-service.ps1") `
  -ControlPlaneUrl `$ControlPlaneUrl `
  -TenantId `$TenantId `
  -EndpointId `$EndpointId `
  -ServiceName `$ServiceName `
  -DisplayName `$DisplayName `
  -MaxConcurrent `$MaxConcurrent `
  -TimeoutMs `$TimeoutMs

Write-Host "Host installed with profile `$InstallProfile" -ForegroundColor Green
"@ | Set-Content -Encoding UTF8 (Join-Path $stage "install-host.ps1")

@"
RemoteSupportPro Host Bundle (Windows)
Version: $Version

This is a single host package with install-time profile selection.

Install steps:
1) Extract this bundle.
2) Ensure Node.js is installed on endpoint.
3) Run:
   powershell -ExecutionPolicy Bypass -File .\install-host.ps1 -ControlPlaneUrl <url> -TenantId <tenant> -EndpointId <endpoint>
4) Choose profile at prompt:
   - remote_only
   - support_limited_no_folders
   - support_full

Notes:
- Selected profile is stored in install-profile.json in this folder.
- Control-plane must enforce effective capabilities using endpoint registry/policy.
"@ | Set-Content -Encoding UTF8 (Join-Path $stage "README_RELEASE.txt")

$zipPath = Join-Path $hostOut "RemoteSupportPro-Host-Windows-v$Version.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

Remove-Item -Recurse -Force $stage
Write-Host "[release] Created $zipPath"
Write-Host "[release] Host Windows unified package generated in $hostOut"
