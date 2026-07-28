# Firma de código (evitar el bloqueo de SmartScreen / Smart App Control)

Windows bloquea los instaladores **sin firma** de un editor no verificado
("Control inteligente de aplicaciones bloqueó una aplicación..."). La única
forma de evitarlo **en todas las PC sin excepciones manuales** es **firmar los
instaladores con un certificado de firma de código** de una CA de confianza.

No hay truco de código: se necesita un certificado real. El build ya quedó
**listo para firmar**; solo falta el certificado y configurar variables.

## Paso 1 — Conseguir un certificado

Opciones (de mejor a peor para desbloquear rápido):

| Opción | Costo aprox. | Desbloquea SmartScreen | Desbloquea Smart App Control |
|---|---|---|---|
| **Azure Trusted Signing** (recomendado) | ~10 USD/mes | Sí, inmediato | Sí (respaldo CA de Microsoft) |
| Certificado **EV** (DigiCert, Sectigo…) | ~250–600 USD/año | Sí, inmediato | Sí |
| Certificado **OV** (archivo .pfx) | ~100–300 USD/año | Gana reputación con el tiempo | Puede seguir bloqueando al inicio |

Para flota corporativa, **Azure Trusted Signing** es lo más barato y efectivo.
Requiere: cuenta Azure, verificación de identidad de la organización y el
paquete `Microsoft.Trusted.Signing.Client` (aporta `Azure.CodeSigning.Dlib.dll`).

## Paso 2 — Configurar variables de entorno antes de compilar

### Azure Trusted Signing
```powershell
$env:CODESIGN_METHOD     = "azure"
$env:AZURE_METADATA_JSON = "C:\ruta\trusted-signing-metadata.json"
```

### Certificado PFX (OV/EV en archivo)
```powershell
$env:CODESIGN_PFX      = "C:\ruta\cert.pfx"
$env:CODESIGN_PASSWORD = "la-contraseña"
```
Para el Controller (electron-builder) el PFX también se toma automáticamente si
usas las variables estándar `CSC_LINK` (ruta al .pfx) y `CSC_KEY_PASSWORD`.

### Certificado EV en token/HSM (por huella del almacén de Windows)
```powershell
$env:CODESIGN_THUMBPRINT = "HUELLA_SHA1_DEL_CERT"
```

Opcional: `$env:CODESIGN_TIMESTAMP_URL` (por defecto http://timestamp.digicert.com).

## Paso 3 — Compilar (firma automática)

- Host:
  ```powershell
  infra/release/windows/build-host-windows-installer.ps1 -Version 0.1.2
  ```
- Controller:
  ```powershell
  npm --prefix apps/controller-electron run dist:win
  ```

Si NO hay certificado configurado, el build sigue funcionando pero deja el
instalador **sin firmar** (y Windows lo bloqueará). El firmador avisa en consola.

## Requisitos

- `signtool.exe` (viene con el Windows SDK / App Certification Kit).
- Conexión para el sellado de tiempo (timestamp) durante la firma.

## Verificar la firma de un .exe

```powershell
signtool verify /pa /v "RemoteSupportPro-Host-Setup-v0.1.2.exe"
```
