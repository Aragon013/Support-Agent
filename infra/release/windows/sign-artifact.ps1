<#
.SYNOPSIS
  Firma un ejecutable/instalador con Authenticode (signtool), si hay
  configuración de firma disponible. Si no la hay, avisa y NO falla el build.

.DESCRIPTION
  La firma de código es la ÚNICA forma de evitar el bloqueo de SmartScreen y
  "Control inteligente de aplicaciones" (Smart App Control) sin excepciones por PC.

  Métodos soportados (en orden de preferencia), por variables de entorno:

  1) Azure Trusted Signing (recomendado, CA de Microsoft, ~10 USD/mes):
       CODESIGN_METHOD       = azure
       AZURE_METADATA_JSON   = ruta a metadata.json de Trusted Signing
       (requiere el dlib Azure.CodeSigning.Dlib instalado; ver README_SIGNING.md)

  2) Certificado PFX (OV/EV en archivo):
       CODESIGN_PFX          = C:\ruta\cert.pfx
       CODESIGN_PASSWORD     = contraseña del pfx

  3) Certificado por huella en el almacén de Windows (EV en token/HSM):
       CODESIGN_THUMBPRINT   = huella SHA1 del certificado

  Opcional:
       CODESIGN_TIMESTAMP_URL (default: http://timestamp.digicert.com)

.PARAMETER Path
  Ruta del archivo a firmar (uno o varios, separados por coma).
#>
param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path
)

$ErrorActionPreference = "Stop"

function Resolve-Signtool {
  $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  # Buscar en Windows SDK (elige la versión más reciente x64).
  $roots = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
    "$env:ProgramFiles\Windows Kits\10\bin"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $found = Get-ChildItem -Path $root -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

$method = $env:CODESIGN_METHOD
$hasPfx = [bool]$env:CODESIGN_PFX
$hasThumb = [bool]$env:CODESIGN_THUMBPRINT
$hasAzure = ($method -eq "azure") -and [bool]$env:AZURE_METADATA_JSON

if (-not ($hasPfx -or $hasThumb -or $hasAzure)) {
  Write-Warning "[sign] No hay configuración de firma (CODESIGN_PFX / CODESIGN_THUMBPRINT / Azure)."
  Write-Warning "[sign] El instalador quedará SIN FIRMAR y Windows lo bloqueará. Ver infra/release/windows/README_SIGNING.md"
  return
}

$signtool = Resolve-Signtool
if (-not $signtool) {
  throw "[sign] signtool.exe no encontrado. Instala el Windows SDK (App Certification Kit)."
}

$timestamp = if ($env:CODESIGN_TIMESTAMP_URL) { $env:CODESIGN_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }

foreach ($file in $Path) {
  if (-not (Test-Path $file)) { throw "[sign] Archivo no encontrado: $file" }
  Write-Host "[sign] Firmando: $file"

  if ($hasAzure) {
    # Azure Trusted Signing usa el proveedor dlib de signtool.
    & $signtool sign /v /fd SHA256 /tr $timestamp /td SHA256 `
      /dlib "Azure.CodeSigning.Dlib.dll" /dmdf "$env:AZURE_METADATA_JSON" "$file"
  }
  elseif ($hasPfx) {
    & $signtool sign /v /fd SHA256 /tr $timestamp /td SHA256 `
      /f "$env:CODESIGN_PFX" /p "$env:CODESIGN_PASSWORD" "$file"
  }
  else {
    & $signtool sign /v /fd SHA256 /tr $timestamp /td SHA256 `
      /sha1 "$env:CODESIGN_THUMBPRINT" "$file"
  }

  if ($LASTEXITCODE -ne 0) { throw "[sign] signtool falló ($LASTEXITCODE) al firmar $file" }

  # Verificar la firma.
  & $signtool verify /pa "$file" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "[sign] Verificación de firma falló para $file" }
  Write-Host "[sign] OK firmado y verificado: $file"
}
