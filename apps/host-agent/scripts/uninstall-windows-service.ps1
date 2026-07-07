param(
  [Parameter(Mandatory = $true)]
  [string]$ServiceName,
  [switch]$DeleteConfig
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "This script only supports Windows."
}

try {
  $service = Get-Service -Name $ServiceName -ErrorAction Stop
  if ($service.Status -ne "Stopped") {
    & sc.exe stop $ServiceName | Out-Null
    Start-Sleep -Seconds 2
  }

  & sc.exe delete $ServiceName | Out-Null
  Write-Host "Deleted service '$ServiceName'."
} catch {
  throw "Service '$ServiceName' was not found."
}

if ($DeleteConfig) {
  $configPath = Join-Path $env:ProgramData "RemoteSupportPro\host-agent\$($ServiceName).json"
  if (Test-Path $configPath) {
    Remove-Item -Path $configPath -Force
    Write-Host "Deleted config '$configPath'."
  }
}
