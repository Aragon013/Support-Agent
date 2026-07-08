# RemoteSupportPro - Guia Total de Operacion

Fecha: 2026-07-08
Version: 1.0

## 1. Que es este sistema

RemoteSupportPro es una plataforma de soporte remoto para MSP con foco en seguridad operativa.
Incluye:

- Host Agent: servicio instalado en cada endpoint.
- Control Plane: API central para sesiones, comandos, auditoria y politicas.
- Controller Electron: cliente del operador para administrar endpoints y ejecutar soporte.

Objetivo principal:

- Resolver incidentes remotos con control de riesgo, trazabilidad y politicas por tenant.

## 2. Para que sirve

Casos de uso principales:

- Soporte remoto diario (visualizacion y control).
- Ejecucion de comandos operativos con control de permisos.
- Trazabilidad completa de acciones.
- Auditoria de ciberseguridad y cumplimiento.
- Gestion de excepciones y alertas de drift.
- Planeacion defensiva de resiliencia.

## 3. Arquitectura general

### 3.1 Componentes

- apps/host-agent
  - Servicio nativo de endpoint.
  - Ejecuta runners permitidos por perfil de instalacion.

- apps/control-plane
  - API backend (Fastify + TS).
  - Coordina autenticacion, sesiones, jobs, auditoria y SecAudit.

- apps/controller-electron
  - Aplicacion de operador.
  - UI unificada para soporte + cybersecurity.

### 3.2 Flujo de alto nivel

1. El operador usa Controller Electron.
2. Controller habla con control-plane.
3. control-plane aplica politicas por tenant, rol y perfil del endpoint.
4. Host Agent ejecuta acciones autorizadas y responde resultados.
5. Auditoria y alertas quedan registradas para evidencia.

## 4. Modelo de liberacion (acordado)

### 4.1 Windows

Se liberan 2 programas separados:

1. Host Service (endpoint)
2. Controller Client (operador)

Host Service en Windows:

- Instalador con selector de perfil de soporte:
  - remote_only
  - support_limited_no_folders
  - support_full

Resultado:

- El perfil elegido define capacidades habilitadas del host.
- control-plane y controller respetan ese perfil para permitir o bloquear funciones.

### 4.2 macOS

Se liberan instaladores separados por perfil (uno por tipo de host):

- Host macOS Remote Only
- Host macOS Support Limited (sin carpetas)
- Host macOS Support Full

Motivo:

- Simplifica restricciones de instalacion y permisos del ecosistema macOS.

### 4.3 Linux

Host con perfil equivalente por paquete/configuracion de despliegue.

### 4.4 Interoperabilidad

El Controller puede administrar endpoints Windows, macOS y Linux que tengan host instalado.
Las acciones se habilitan segun:

- perfil del host
- capacidades de sesion
- politicas del tenant
- permisos del operador

## 5. Seguridad del sistema

- Cifrado E2E obligatorio.
- MFA obligatorio.
- Auditoria de eventos critica.
- Retencion de logs configurable (default 90 dias).
- Aislamiento multi-tenant.
- Politicas de capacidad por install profile.

## 6. Secciones del Controller (uso completo)

## 6.1 Support

Para iniciar soporte operativo rapido.

Funciones:

- crear sesion de soporte
- iniciar control remoto
- iniciar vista remota
- abrir lista de sesiones

Uso recomendado:

1. Define tenant/operator/endpoint.
2. Lanza sesion.
3. Si se requiere, transiciona a Sessions para control avanzado.

## 6.2 Commands

Para ejecutar comandos catalogados de forma controlada.

Funciones:

- seleccion de comando por riesgo
- parametros por comando
- despacho a jobs
- estado de ejecucion

Uso recomendado:

1. Elige comando.
2. Completa parametros.
3. Ejecuta y valida resultado.

## 6.3 Jobs

Para observar ejecuciones en tiempo real.

Funciones:

- suscripcion por WebSocket
- estado de jobs en vivo
- reconexion del stream

Uso recomendado:

- mantener abierto durante operaciones criticas para seguimiento en vivo.

## 6.4 Cybersecurity (seccion unificada)

Esta es la seccion centralizada de auditoria cyber. Contiene subtabs:

1. SecAudit
2. Compliance
3. Exceptions
4. Alerts
5. Resilience
6. Audit Log

Flujo operativo sugerido:

1. SecAudit -> ejecuta plan
2. Compliance -> mide brecha por framework
3. Exceptions -> documenta riesgos aceptados
4. Alerts -> activa notificacion de drift
5. Audit Log -> conserva evidencia

### 6.4.1 SecAudit

Para crear y ejecutar planes de auditoria por paquete o custom.

Capacidades:

- paquetes quick/standard/deep/incident/compliance/custom
- origen host, host network y client network
- comparacion con baseline
- remediaciones priorizadas

### 6.4.2 Compliance

Para mapear resultados contra marcos regulatorios.

Capacidades:

- CIS
- NIST CSF
- ISO 27001
- SOC 2
- PCI DSS

Resultado:

- score por framework
- controles passed/failed/partial/no evaluado

### 6.4.3 Exceptions

Para gestionar excepciones temporales a hallazgos.

Capacidades:

- crear excepcion con justificacion
- aprobar/rechazar
- controlar expiracion

### 6.4.4 Alerts

Para notificar eventos y drift critico.

Capacidades:

- canales: Slack, Teams, Webhook, Email
- prueba de alertas
- rotacion de token por canal

### 6.4.5 Resilience

Para planificar ejercicios defensivos (dry-run).

Capacidades:

- scopes autorizados
- perfiles de intensidad
- planeacion sin generar trafico ofensivo

### 6.4.6 Audit Log

Para evidencia cronologica de acciones de seguridad y operacion.

## 6.5 Monitor

Para observabilidad operativa de estado/salud.

## 6.6 Sessions

Para control y gestion avanzada de sesiones.

Capacidades:

- capacidades solicitadas por sesion
- gating por perfil de instalacion
- flujo basic/advanced

## 6.7 Settings

Configuraciones del cliente operador.

## 7. Instalacion y uso por plataforma

## 7.1 Host Windows

1. Ejecuta instalador host.
2. Selecciona perfil de soporte.
3. Completa registro de endpoint.
4. Verifica heartbeat en control-plane.

## 7.2 Host macOS

1. Elige el instalador correcto por perfil.
2. Instala y concede permisos requeridos.
3. Registra endpoint.
4. Verifica conectividad.

## 7.3 Host Linux

1. Instala paquete host para distro.
2. Configura perfil y registro.
3. Habilita servicio.

## 7.4 Controller (operador)

1. Instala Controller Electron.
2. Configura tenant/operator.
3. Conecta al control-plane.

## 8. Gobierno de permisos y perfiles

Regla base:

- Ninguna accion debe ejecutarse si viola installProfile o politicas de tenant.

Matriz conceptual:

- remote_only: control remoto basico, sin acciones de alto impacto.
- support_limited_no_folders: soporte tecnico limitado, sin operaciones de carpeta.
- support_full: soporte completo segun rol y politicas.

## 9. Runbook operativo recomendado

1. Validar endpoint + perfil
2. Abrir sesion segura
3. Ejecutar comandos minimos necesarios
4. Documentar en auditoria
5. Correr SecAudit si hay incidente o hardening planificado
6. Revisar compliance y excepciones
7. Configurar alertas de drift

## 10. Diagnostico rapido

- UI negra o error de render:
  - revisar ErrorBoundary del controller
  - validar tipado y modulos de panel

- API 401 en alerts/resilience:
  - validar x-api-key y tenant

- comandos bloqueados:
  - revisar installProfile y policy gates

- falta de evidencia:
  - validar flujo Audit Log y eventos en backend

## 11. Mapa de codigo (referencia)

- Controller UI: apps/controller-electron/src
- Control Plane API: apps/control-plane/src
- Host Agent: apps/host-agent/src
- Documentacion de arquitectura: docs

## 12. Roadmap inmediato recomendado

1. Cerrar endpoint registry confiable para installProfile (backend)
2. Endurecer auth de alerts/resilience en todos los entornos
3. Completar empaquetado instaladores por plataforma/perfil
4. Checklist de release y smoke E2E multi-OS

---

Guia pensada para onboarding operativo, soporte diario y auditoria cyber de punta a punta.
