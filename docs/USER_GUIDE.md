# RemoteSupportPro — Guía completa de uso

Versión 0.1.2 · 2026-07-27

Soporte remoto y ciberauditoría para muchas PC desde un solo lugar. Esta guía explica qué es, cómo se instala y para qué sirve cada función.

## 1. Qué es y para qué sirve

RemoteSupportPro es una plataforma tipo TeamViewer orientada a MSP y equipos de TI. Permite:

- Dar soporte remoto (ver y controlar la pantalla de una PC).
- Ejecutar comandos de diagnóstico y mantenimiento con control de permisos.
- Correr auditorías de ciberseguridad y medir cumplimiento.
- Registrar todo (auditoría) y recibir alertas de cambios críticos.

Todo con separación por cliente (multi-tenant), cifrado E2E y MFA obligatorios.

## 2. Cómo está armado

Son tres piezas que se comunican entre sí:

| Pieza | Qué es | Dónde corre |
|---|---|---|
| Controller | La app de operador (esta interfaz) | La PC del técnico |
| Control-Plane | El backend/servidor central | Un servidor o tu PC, puerto 3000 |
| Host-Agent | El servicio instalado en cada PC a soportar | Cada máquina cliente |

Regla de oro: el Controller nunca habla directo con las PC. Todo pasa por el Control-Plane. Si el backend no está encendido, verás error de fetch.

Flujo: Controller a Control-Plane a Host-Agent en cada PC.

## 3. Conceptos clave

- Tenant: tu cliente o empresa (por ejemplo tenant-1). Es una etiqueta que separa datos entre clientes. No se registra en ningún lado: basta con usar el mismo texto en el Controller y en el Host-Agent.
- Endpoint: una PC concreta (por ejemplo pc-juan). Es el identificador que le pones al Host-Agent al instalarlo.
- Operador: tú, el técnico (por ejemplo op-1). Cualquier nombre sirve.
- Perfil de instalación: define qué se permite hacer en esa PC.

Importante: el TENANT_ID del agente y el tenant del Controller deben ser idénticos, o esa PC no aparecerá.

## 4. Instalación

### 4.1 Host-Agent en cada PC (recomendado: instalador gráfico)

Ejecuta RemoteSupportPro-Host-Setup.exe con doble clic. No requiere PowerShell ni Node. El asistente pide:

- URL del control-plane (por ejemplo http://tu-servidor:3000).
- Tenant ID (por ejemplo tenant-1).
- Endpoint ID (único por PC, por ejemplo pc-juan).
- Perfil de instalación (remote_only, support_limited_no_folders o support_full).

Al terminar instala e inicia el servicio de Windows automáticamente, y arranca solo con el sistema.

Método manual (solo desarrollo o despliegue masivo por script):

```
npm run service:install -- -ControlPlaneUrl "http://tu-servidor:3000" -TenantId "tenant-1" -EndpointId "pc-juan"
```

### 4.2 Controller (operador)

Ejecuta RemoteSupportPro-Controller-Setup.exe. Es un asistente que permite instalar por usuario o por máquina y elegir carpeta. Al abrir la app queda listo para conectarse al control-plane.

### 4.3 Control-Plane (backend)

Corre en un servidor accesible por el Controller y los agentes. En desarrollo puede correr en tu misma PC en el puerto 3000.

## 5. Arranque rápido en local (para probar sin instalar agentes)

Abre tres terminales:

```
cd apps\control-plane
$env:COMMAND_LOCAL_RUNNER = "true"; npm run dev
```

```
cd apps\control-plane
npm run seed:endpoints
```

```
cd apps\controller-electron
npm run dev
```

En el panel Support los campos ya vienen con tenant-1 y op-1. Elige endpoint-1 en el desplegable y pulsa Run Probe. Verás datos reales de tu PC.

Nota: el modo local (COMMAND_LOCAL_RUNNER true) ejecuta las pruebas contra la máquina del backend e ignora la PC destino. Es solo para practicar. En producción va apagado.

## 6. Recorrido por cada sección

La barra izquierda tiene: Support, Commands, Jobs, Cyber, Monitor, Sessions y Settings.

### 6.1 Support (punto de entrada)

Es donde empieza casi todo. Funciones:

- Target: eliges la PC (endpoint) desde un desplegable con autocompletado, o escribes IP/hostname. Botón Refrescar para recargar la lista de PC conectadas.
- Cliente (tenant) y Operador: vienen con valores por defecto (tenant-1, op-1).
- Run Probe: diagnostica la PC y muestra sistema operativo, CPU, RAM, tiempo encendida y versión de runtime.
- Acciones sugeridas: según el resultado del probe, la app propone pasos (revisar firewall, reiniciar por uptime alto, liberar memoria, etc.).
- Acciones rápidas: botones directos como revisar firewall o reiniciar un servicio.
- Iniciar sesión: crea una sesión de vista o de control remoto y salta al panel Sessions.

Uso típico: eliges la PC, pulsas Run Probe, revisas el diagnóstico y lanzas la acción o sesión que necesites.

### 6.2 Commands (catálogo de comandos)

Ejecuta comandos catalogados de forma controlada. Cada comando tiene un nivel de riesgo y puede requerir MFA. Catálogo actual:

| Comando | Nombre | Riesgo | Qué hace |
|---|---|---|---|
| diagnostic.system.info | System Info | bajo | Recopila datos básicos de SO y runtime del endpoint. |
| diagnostic.process.enum | Process Enumeration | medio | Enumera procesos y señales de comportamiento. |
| diagnostic.backup-status.check | Backup Status Check | bajo | Lee la postura de respaldo y disposición de restauración. |
| diagnostic.cloud.config | Cloud Configuration Snapshot | bajo | Recoge metadatos de postura de nube y SaaS. |
| maintenance.service.restart | Restart Allowed Service | medio | Reinicia un servicio pre-aprobado por id. |
| maintenance.network.reset | Network Reset | alto | Reinicio controlado de la pila de red. |
| security.firewall.status | Firewall Status | bajo | Lee el estado del firewall del endpoint. |
| security.driver-signing.status | Driver Signing Status | bajo | Inspecciona firma de drivers y confianza del kernel. |
| security.credential-guard.status | Credential Guard Status | bajo | Evalúa aislamiento de credenciales y movimiento lateral. |
| security.audit-logging.status | Audit Logging Status | bajo | Revisa controles de logging y evidencia alineada a marco. |
| security.mfa.status | MFA Posture | bajo | Evalúa MFA en accesos locales y remotos. |
| security.secret-scanning.status | Secrets Exposure Status | medio | Busca credenciales o tokens expuestos. |
| security.remote-access.status | Remote Access Posture | medio | Inspecciona exposición de VPN, RDP y SSH. |
| security.software-integrity.status | Software Integrity Status | medio | Evalúa confianza de publisher, SBOM y cadena de suministro. |
| security.benchmark.status | Security Benchmark Status | bajo | Estado de alineación con benchmarks base (CIS). |

Uso típico: elige el comando, completa parámetros requeridos y ejecuta. Los comandos de alto riesgo pueden pedir MFA. Si el perfil de instalación de la PC no lo permite, el comando aparece bloqueado.

### 6.3 Jobs (historial de ejecuciones)

Muestra cada comando lanzado y su estado en tiempo real: created, policy_check, mfa_pending, queued, dispatched, running, streaming, verifying, completed, failed, blocked o cancelled. Mantenlo abierto durante operaciones críticas para seguir la ejecución en vivo.

### 6.4 Cyber (ciberauditoría unificada)

Reúne seis subpestañas:

- SecAudit: crea y ejecuta planes de auditoría. Paquetes: Quick, Standard, Deep, Incident, Compliance y Custom. Orígenes: host, red desde el host y red desde el cliente. Compara contra una línea base y prioriza remediaciones.
- Compliance: mapea resultados contra marcos como CIS, NIST CSF, ISO 27001, SOC 2 y PCI DSS. Da un score por marco y estado de cada control (passed, failed, partial o no evaluado).
- Exceptions: gestiona excepciones temporales a hallazgos. Crear con justificación, aprobar o rechazar, y controlar expiración.
- Alerts: notifica eventos y drift crítico por canales como Slack, Teams, Webhook o Email. Permite probar alertas y rotar el token por canal.
- Resilience: planifica ejercicios defensivos en modo dry-run, con scopes autorizados y perfiles de intensidad, sin generar tráfico ofensivo.
- Audit Log: evidencia cronológica de todas las acciones de seguridad y operación.

Flujo sugerido: SecAudit ejecuta el plan, Compliance mide la brecha, Exceptions documenta riesgos aceptados, Alerts activa la notificación de drift y Audit Log conserva la evidencia.

### 6.5 Monitor (actividad en vivo)

Muestra los eventos entrando en tiempo real por WebSocket. Indica si está conectado o desconectado y lista los últimos eventos con su secuencia, nombre, job y hora. Útil para ver la operación mientras ocurre.

### 6.6 Sessions (control remoto)

Gestiona las sesiones de pantalla y control tipo TeamViewer. Capacidades:

- Modo vista (solo ver la pantalla) o control (ver más teclado, ratón y portapapeles).
- Estados de sesión: requested, pending_host, pending_approval, signaling, connecting_p2p, connected_p2p, connected_relay, reconnecting, ended o failed.
- Gating por perfil de instalación: las acciones se habilitan según lo que permita la PC.
- Modos básico y avanzado con parámetros de calidad y FPS.

Uso típico: desde Support inicias una sesión de vista o control y aquí la gestionas.

### 6.7 Settings (configuración)

- Apariencia: elige tema Claro, Oscuro o Sistema (sigue a Windows). Se guarda solo y se aplica al instante.
- Conexión: muestra a qué backend apunta la app (variable VITE_BACKEND_URL, por defecto http://localhost:3000).

## 7. Perfiles de instalación

El perfil se elige al instalar el Host y define qué se permite:

| Perfil | Qué permite |
|---|---|
| remote_only | Solo ver y controlar la pantalla. Sin comandos ni acciones de alto impacto. |
| support_limited_no_folders | Comandos de soporte sí, pero sin acciones sobre carpetas. |
| support_full | Soporte completo, según el rol del operador y las políticas del tenant. |

El Control-Plane y el Controller respetan ese perfil: si una acción lo viola, se bloquea.

## 8. Seguridad

- Cifrado E2E obligatorio en las sesiones.
- MFA obligatorio para acciones sensibles.
- Auditoría de eventos críticos con evidencia.
- Retención de logs configurable (por defecto 90 días).
- Aislamiento multi-tenant.
- Políticas de capacidad por perfil de instalación.

## 9. Flujo típico de un caso de soporte

1. En Support eliges la PC y pulsas Run Probe.
2. Revisas las acciones sugeridas según el diagnóstico.
3. Lanzas un comando (por ejemplo revisar firewall o reiniciar un servicio) y lo sigues en Jobs.
4. Si necesitas ver la pantalla, abres una Session de vista o control.
5. Para postura de seguridad, corres una auditoría en Cyber.
6. Todo queda registrado en el Audit Log.

## 10. Solución de problemas

| Síntoma | Causa | Solución |
|---|---|---|
| Error de fetch | El backend no está encendido | Arranca el Control-Plane en el puerto 3000. |
| Error de tenant | Campo tenant vacío | Deja tenant-1 (ya viene por defecto). |
| La PC no aparece en el desplegable | Agente no conectado o tenant distinto | Verifica que el Host-Agent use el mismo TENANT_ID y esté corriendo; pulsa Refrescar. |
| Comando bloqueado | El perfil de instalación lo prohíbe | Esa PC tiene un perfil restringido (por ejemplo remote_only). |
| El Probe no devuelve nada en remoto | Falta el agente en la PC destino | Instala el Host-Agent en esa máquina. |
| Sesión no conecta | Consentimiento pendiente o red | Revisa aprobación en el host y conectividad. |

## 11. Glosario rápido

- Control-Plane: backend central que coordina todo.
- Host-Agent: servicio en la PC a soportar.
- Controller: la app del operador.
- Tenant: cliente o empresa.
- Endpoint: una PC concreta.
- Drift: desviación respecto a una línea base de seguridad.
- Baseline: estado de referencia contra el que se compara una auditoría.
- Job: una ejecución de comando y su ciclo de vida.
