param(
  [Parameter(Mandatory = $true)]
  [string]$ControlPlaneUrl,

  [Parameter(Mandatory = $true)]
  [string]$TenantId,

  [Parameter(Mandatory = $true)]
  [string]$EndpointId,

  [string]$ServiceName,
  [string]$DisplayName,
  [int]$MaxConcurrent = 3,
  [int]$TimeoutMs = 30000,
  [ValidateSet("remote_only", "support_limited_no_folders", "support_full")]
  [string]$InstallProfile
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "This script only supports Windows."
}

if (-not $InstallProfile) {
  Write-Host "Select Host support profile:" -ForegroundColor Cyan
  Write-Host "  1) remote_only"
  Write-Host "  2) support_limited_no_folders"
  Write-Host "  3) support_full"
  $choice = Read-Host "Enter option (1-3)"
  switch ($choice) {
    "1" { $InstallProfile = "remote_only" }
    "2" { $InstallProfile = "support_limited_no_folders" }
    "3" { $InstallProfile = "support_full" }
    default { throw "Invalid option. Use 1, 2 or 3." }
  }
}

$agentRoot = Split-Path -Parent $PSScriptRoot
$agentJs = Join-Path $agentRoot "dist\agent.js"
if (-not (Test-Path $agentJs)) {
  throw "Build output not found at '$agentJs'. Run npm run build first."
}

$nodeExe = (Get-Command node -ErrorAction Stop).Source

if (-not $ServiceName) {
  $safeEndpoint = ($EndpointId -replace "[^A-Za-z0-9_-]", "-")
  $ServiceName = "RemoteSupportProHostAgent-$safeEndpoint"
}

if (-not $DisplayName) {
  $DisplayName = "RemoteSupportPro Host Agent ($EndpointId)"
}

$configDir = Join-Path $env:ProgramData "RemoteSupportPro\host-agent"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null

$configPath = Join-Path $configDir "$($ServiceName).json"
$configJson = [ordered]@{
  controlPlaneUrl = $ControlPlaneUrl
  tenantId = $TenantId
  endpointId = $EndpointId
  maxConcurrent = $MaxConcurrent
  timeoutMs = $TimeoutMs
  installProfile = $InstallProfile
  supportCommandsAllowed = $InstallProfile -ne "remote_only"
  folderActionsAllowed = $InstallProfile -eq "support_full"
} | ConvertTo-Json

Set-Content -Path $configPath -Value $configJson -Encoding UTF8

# Persist the selected profile next to the agent as the local capability baseline.
$profilePath = Join-Path $agentRoot "install-profile.json"
[ordered]@{
  installProfile = $InstallProfile
  supportCommandsAllowed = $InstallProfile -ne "remote_only"
  folderActionsAllowed = $InstallProfile -eq "support_full"
} | ConvertTo-Json -Depth 3 | Set-Content -Path $profilePath -Encoding UTF8

$serviceExists = $false
try {
  $null = Get-Service -Name $ServiceName -ErrorAction Stop
  $serviceExists = $true
} catch {
  $serviceExists = $false
}

if ($serviceExists) {
  throw "Service '$ServiceName' already exists. Use uninstall script first or choose another name."
}

$binPath = '"' + $nodeExe + '" "' + $agentJs + '" --config "' + $configPath + '"'

& sc.exe create $ServiceName binPath= $binPath start= auto obj= "NT AUTHORITY\LocalService" DisplayName= $DisplayName | Out-Null
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& sc.exe description $ServiceName "RemoteSupportPro host agent service" | Out-Null
& sc.exe start $ServiceName | Out-Null

Write-Host "Installed and started service '$ServiceName'."
Write-Host "Config: $configPath"
