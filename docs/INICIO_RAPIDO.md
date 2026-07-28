# RemoteSupportPro — Inicio rápido (gratis, sin VPS)

3 pasos. Usa Tailscale (gratis) para que funcione desde cualquier red, sin abrir puertos ni pagar.

## Paso 1 — Montar el "servidor" (en una PC tuya)

- Descarga y descomprime **RemoteSupportPro-Server-OneClick.zip**.
- Instala Tailscale y entra con tu cuenta: https://tailscale.com/download
- Doble clic en **Start-Server.bat**. Te mostrará la URL a usar, por ejemplo http://100.x.x.x:3000
- Deja esa ventana abierta (o usa Install-Server-Service.bat para que arranque solo).

Ahí sale la IP/URL: no la buscas, la pantalla te la da.

## Paso 2 — Instalar en cada PC a soportar (host)

- Descarga y descomprime **RemoteSupportPro-Host-OneClick.zip**.
- Abre config.txt y pega esa URL en ControlPlaneUrl (una vez para todas las PC). Deja EndpointId vacío.
- Instala Tailscale (misma cuenta) y doble clic en **Install-Host.bat**. Acepta el permiso de administrador.

Listo: el servicio queda instalado y arranca solo con Windows.

## Paso 3 — Operar desde el Controller (tú)

- Instala Tailscale en tu PC de operador.
- Abre el Controller, pon la misma URL del servidor y ya puedes remotear y auditar.

## Datos que se repiten

- Cliente (tenant): tenant-1 (o el que tú definas, igual en servidor y host).
- Perfil del host: support_full (o remote_only / support_limited_no_folders).
- EndpointId: se pone solo con el nombre de cada PC.

## Si algo falla

- "Error de fetch": el servidor no está encendido. Abre Start-Server.bat.
- La PC no aparece: revisa que use la misma URL y el mismo tenant, y que Tailscale esté activo.
- Todo es gratis: no necesitas VPS ni comprar servidor. El servidor es una PC tuya + Tailscale.
