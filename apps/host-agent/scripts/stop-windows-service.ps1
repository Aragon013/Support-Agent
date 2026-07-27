param(
  [string]$ServiceName,
  [string]$EndpointId
)

$ErrorActionPreference = "Stop"

if (-not $ServiceName) {
  if (-not $EndpointId) {
    throw "Provide -ServiceName or -EndpointId."
  }
  $safeEndpoint = ($EndpointId -replace "[^A-Za-z0-9_-]", "-")
  $ServiceName = "RemoteSupportProHostAgent-$safeEndpoint"
}

& sc.exe stop $ServiceName | Out-Null
Write-Host "Stopped service '$ServiceName'."
