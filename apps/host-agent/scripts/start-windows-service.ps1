param(
  [Parameter(Mandatory = $true)]
  [string]$ServiceName
)

$ErrorActionPreference = "Stop"

& sc.exe start $ServiceName | Out-Null
Write-Host "Started service '$ServiceName'."
