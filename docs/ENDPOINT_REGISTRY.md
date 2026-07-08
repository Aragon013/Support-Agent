## RemoteSupportPro - Backend Enhancements (2026-07-07)

### ✅ Cambios Implementados

#### 1. **Endpoint Registry con Persistencia**
- **Archivo**: `apps/control-plane/src/domain/endpoint-registry.ts`
- **Función**: Mantiene un registro persistente (JSON en dev, DB en prod) de endpoints con sus políticas de seguridad
- **Mejora**: Endpoints ahora se persisten entre reinicios del servidor (en dev)

#### 2. **Nuevas Rutas API**

##### POST /api/v1/endpoints - Registrar Endpoint
```bash
curl -X POST http://localhost:3000/api/v1/endpoints \
  -H "Content-Type: application/json" \
  -d '{
    "endpointId": "laptop-001",
    "installProfile": "support_full",
    "licenseStatus": "active",
    "unattendedEnabled": true,
    "maxActiveControlSessions": 1
  }'

# Response:
# {
#   "endpointId": "laptop-001",
#   "installProfile": "support_full",
#   "message": "Endpoint registered successfully"
# }
```

##### GET /api/v1/endpoints - Listar Todos los Endpoints
```bash
curl http://localhost:3000/api/v1/endpoints
# Response: { "items": [...], "count": 2 }
```

##### GET /api/v1/endpoints/:id/session-policy - Obtener Política
```bash
curl http://localhost:3000/api/v1/endpoints/laptop-001/session-policy
# Ahora lee del registry primero (autoridad)
# En dev, headers como backup para testing
```

#### 3. **Validación con Zod**
- **Archivo**: `apps/control-plane/src/domain/schemas.ts`
- **Ventaja**: Schemas reutilizables en frontend/backend
- Tipos TypeScript automáticamente generados desde schemas

#### 4. **Error Messages Amigables**
- **Archivo**: `apps/controller-electron/src/panels/error-messages.ts`
- **Cambio**: `policy_http_403` → "Access denied. Check your role or license status."
- **Soporte**: 15+ mensajes de error mapeados a etiquetas legibles

#### 5. **Audit Logging Mejorado**
- Registry ahora registra:
  - `endpoint.registered` - Cuando se registra un endpoint
  - `endpoint.policy.header_override` - Cuando se usa header en dev (no registry)
  - `endpoint.policy.not_found` - Fallback en prod

#### 6. **SupportPanel Mejorado**
- Usa `mapErrorMessage()` para mensajes claros
- Mensajes de policy error más detallados
- Hints sobre cómo registrar endpoints

---

### 📋 **InstallProfile Levels**

| Profile | Commands | Folders | Casos de Uso |
|---------|----------|---------|---|
| **support_full** | ✅ All | ✅ Yes | Desktop/workstation de confianza |
| **support_limited** | ✅ System info + restart | ❌ No | Servidor productivo |
| **remote_only** | ❌ None | ❌ No | Endpoint restrictivo (solo view session) |

---

### 🚀 **Cómo Usar en Dev**

#### 1. Registrar un Endpoint (recomendado)
```bash
curl -X POST http://localhost:3000/api/v1/endpoints \
  -H "Content-Type: application/json" \
  -d '{
    "endpointId": "test-machine",
    "installProfile": "support_full"
  }'
```

#### 2. O usar Headers en SupportPanel (legacy, dev-only)
- En `SupportPanel.tsx`, los headers aún funcionan si el endpoint no está registrado
- Audita el uso con código `endpoint.policy.header_override`

#### 3. Verificar Registro
```bash
curl http://localhost:3000/api/v1/endpoints
# Verifica que "test-machine" esté en la lista
```

---

### 🔒 **Cambios en Seguridad**

#### Antes:
- Registry vacío → headers determinaban el perfil
- Técnico podía "mentir" sobre installProfile

#### Ahora:
- Registry es la autoridad (authoritative)
- Headers son hints solo en dev (logged)
- Prod falla seguro (`remote_only` para desconocidos)

---

### 📁 **Persistencia (Dev)**

El archivo `.endpoints-registry.json` se crea automáticamente:
```json
{
  "laptop-001": {
    "endpointId": "laptop-001",
    "installProfile": "support_full",
    "licenseStatus": "active",
    "...": "..."
  }
}
```

Ubicación: Raíz del proyecto (`process.cwd()`)

---

### 🧪 **Testing**

```bash
# 1. Iniciar servidor
cd apps/control-plane
npm run dev

# 2. En otra terminal, registrar endpoint
curl -X POST http://localhost:3000/api/v1/endpoints \
  -H "Content-Type: application/json" \
  -d '{"endpointId": "test-1", "installProfile": "support_full"}'

# 3. Verificar en SupportPanel
# Usa "test-1" como target
# debe cargar policy desde registry (source: "registry")
```

---

### 🔮 **Próximos Pasos (Sugeridos)**

- [ ] Migrar Registry a PostgreSQL
- [ ] POST /api/v1/endpoints con autenticación
- [ ] Audit retention por tenantId
- [ ] WebSocket para sesiones (en vez de polling)
- [ ] Tests E2E para endpoint registration

---

### 📊 **Auditing**

Verifica audits registrados:
```bash
curl "http://localhost:3000/api/v1/audit?tenantId=system"
# Ver: endpoint.registered, endpoint.policy.header_override, etc.
```

---

**Última actualización**: 2026-07-07
