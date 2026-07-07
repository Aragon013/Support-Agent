param(
  [Parameter(Mandatory = $true)]
  [string]$ServiceName
)

$ErrorActionPreference = "Stop"

& sc.exe stop $ServiceName | Out-Null
Write-Host "Stopped service '$ServiceName'."
