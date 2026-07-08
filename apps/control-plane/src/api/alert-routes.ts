import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { InMemoryAlertStore, type AlertChannelType } from "../domain/alert-store.js";
import { InMemoryAuditLogStore, type AuditEventCode } from "../domain/audit-log-store.js";
import { AlertDispatcher } from "../services/alert-dispatcher.js";

type CreateChannelBody = {
  name: string;
  type: AlertChannelType;
  target: string;
  authHeaderName?: string;
  authToken?: string;
  enabled?: boolean;
};

type UpdateChannelBody = {
  name?: string;
  target?: string;
  authHeaderName?: string;
  authToken?: string;
  clearAuth?: boolean;
  enabled?: boolean;
};

type IdParams = { id: string };

type RotateTokenBody = {
  authToken: string;
  authHeaderName?: string;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isChannelType(v: unknown): v is AlertChannelType {
  return v === "slack" || v === "teams" || v === "webhook" || v === "email";
}

function maskSecret(secret: string): string {
  if (secret.length <= 6) return "******";
  return `${secret.slice(0, 2)}***${secret.slice(-2)}`;
}

function sanitizeChannel(ch: {
  id: string;
  name: string;
  type: AlertChannelType;
  target: string;
  auth?: { headerName: string; token: string };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: ch.id,
    name: ch.name,
    type: ch.type,
    target: ch.target,
    enabled: ch.enabled,
    createdAt: ch.createdAt,
    updatedAt: ch.updatedAt,
    ...(ch.auth !== undefined
      ? {
        auth: {
          headerName: ch.auth.headerName,
          tokenMasked: maskSecret(ch.auth.token),
        },
      }
      : {}),
  };
}

export function registerAlertRoutes(app: FastifyInstance): void {
  registerAlertRoutesWithDeps(app, {});
}

export function registerAlertRoutesWithDeps(
  app: FastifyInstance,
  deps: { store?: InMemoryAlertStore; dispatcher?: AlertDispatcher; auditStore?: InMemoryAuditLogStore },
): void {
  const store = deps.store ?? new InMemoryAlertStore();
  const dispatcher = deps.dispatcher ?? new AlertDispatcher(store);
  const auditStore = deps.auditStore ?? new InMemoryAuditLogStore();

  const actorFromReq = (req: FastifyRequest) => {
    const tenantRaw = req.headers["x-tenant-id"];
    const operatorRaw = req.headers["x-operator-id"];
    const tenantId = typeof tenantRaw === "string" && tenantRaw.trim().length > 0 ? tenantRaw.trim() : "system";
    const operatorId = typeof operatorRaw === "string" && operatorRaw.trim().length > 0 ? operatorRaw.trim() : "system";
    return { tenantId, operatorId };
  };

  const appendAlertAudit = (req: FastifyRequest, code: AuditEventCode, details: Record<string, unknown>) => {
    const actor = actorFromReq(req);
    auditStore.append({
      tenantId: actor.tenantId,
      operatorId: actor.operatorId,
      code,
      details,
    });
  };

  app.post<{ Body: CreateChannelBody }>("/api/v1/alerts/channels", async (req, reply) => {
    const b = req.body;
    if (!b || !isNonEmptyString(b.name) || !isChannelType(b.type) || !isNonEmptyString(b.target)) {
      return reply.code(422).send({ code: "validation_error", message: "name, type and target are required" });
    }

    if ((b.authHeaderName !== undefined && !isNonEmptyString(b.authHeaderName)) || (b.authToken !== undefined && !isNonEmptyString(b.authToken))) {
      return reply.code(422).send({ code: "validation_error", message: "authHeaderName and authToken must be non-empty when provided" });
    }

    if ((b.authHeaderName !== undefined && b.authToken === undefined) || (b.authHeaderName === undefined && b.authToken !== undefined)) {
      return reply.code(422).send({ code: "validation_error", message: "authHeaderName and authToken must be provided together" });
    }

    const created = store.createChannel({
      name: b.name,
      type: b.type,
      target: b.target,
      ...(b.authHeaderName !== undefined && b.authToken !== undefined
        ? {
          auth: {
            headerName: b.authHeaderName,
            token: b.authToken,
          },
        }
        : {}),
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
    });
    appendAlertAudit(req, "alerts.channel.created", {
      scope: "alerts",
      channelId: created.id,
      type: created.type,
      hasAuth: created.auth !== undefined,
      enabled: created.enabled,
    });
    return reply.code(201).send(sanitizeChannel(created));
  });

  app.get("/api/v1/alerts/channels", async (_req, reply) => {
    const items = store.listChannels().map(sanitizeChannel);
    return reply.code(200).send({ items, count: items.length });
  });

  app.patch<{ Params: IdParams; Body: UpdateChannelBody }>("/api/v1/alerts/channels/:id", async (req, reply) => {
    const found = store.getChannelById(req.params.id);
    if (!found) {
      return reply.code(404).send({ code: "not_found", message: "alert channel not found" });
    }

    const b = req.body ?? {};
    if ((b.authHeaderName !== undefined && !isNonEmptyString(b.authHeaderName)) || (b.authToken !== undefined && !isNonEmptyString(b.authToken))) {
      return reply.code(422).send({ code: "validation_error", message: "authHeaderName and authToken must be non-empty when provided" });
    }
    if ((b.authHeaderName !== undefined && b.authToken === undefined) || (b.authHeaderName === undefined && b.authToken !== undefined)) {
      return reply.code(422).send({ code: "validation_error", message: "authHeaderName and authToken must be provided together" });
    }

    const updated = store.updateChannel(req.params.id, {
      ...(isNonEmptyString(b.name) ? { name: b.name } : {}),
      ...(isNonEmptyString(b.target) ? { target: b.target } : {}),
      ...(b.clearAuth === true
        ? { auth: null }
        : (b.authHeaderName !== undefined && b.authToken !== undefined)
          ? {
            auth: {
              headerName: b.authHeaderName,
              token: b.authToken,
            },
          }
          : {}),
      ...(typeof b.enabled === "boolean" ? { enabled: b.enabled } : {}),
    });

    if (updated) {
      const code: AuditEventCode = b.clearAuth === true
        ? "alerts.channel.auth_cleared"
        : (b.authHeaderName !== undefined && b.authToken !== undefined)
          ? "alerts.channel.auth_updated"
          : "alerts.channel.updated";
      appendAlertAudit(req, code, {
        scope: "alerts",
        channelId: updated.id,
        type: updated.type,
        hasAuth: updated.auth !== undefined,
        enabled: updated.enabled,
      });
    }

    return reply.code(200).send(updated ? sanitizeChannel(updated) : updated);
  });

  app.post<{ Params: IdParams; Body: RotateTokenBody }>("/api/v1/alerts/channels/:id/rotate-token", async (req, reply) => {
    const found = store.getChannelById(req.params.id);
    if (!found) {
      return reply.code(404).send({ code: "not_found", message: "alert channel not found" });
    }

    if (found.type === "email") {
      return reply.code(422).send({ code: "validation_error", message: "email channels do not support auth token rotation" });
    }

    const b = req.body;
    if (!b || !isNonEmptyString(b.authToken)) {
      return reply.code(422).send({ code: "validation_error", message: "authToken is required" });
    }
    if (b.authHeaderName !== undefined && !isNonEmptyString(b.authHeaderName)) {
      return reply.code(422).send({ code: "validation_error", message: "authHeaderName must be non-empty when provided" });
    }

    const nextHeader = b.authHeaderName ?? found.auth?.headerName ?? "Authorization";
    const updated = store.updateChannel(req.params.id, {
      auth: {
        headerName: nextHeader,
        token: b.authToken,
      },
    });

    if (!updated) {
      return reply.code(404).send({ code: "not_found", message: "alert channel not found" });
    }

    appendAlertAudit(req, "alerts.channel.token_rotated", {
      scope: "alerts",
      channelId: updated.id,
      type: updated.type,
      authHeaderName: nextHeader,
    });

    return reply.code(200).send(sanitizeChannel(updated));
  });

  app.post("/api/v1/alerts/test", async (_req: FastifyRequest, reply: FastifyReply) => {
    const event = await dispatcher.dispatch({
      category: "test",
      severity: "info",
      title: "SecAudit test alert",
      message: "Manual test alert from control-plane",
      context: { source: "manual_test" },
    });
    appendAlertAudit(_req, "alerts.test.dispatched", {
      scope: "alerts",
      category: "test",
      deliveries: event.deliveries.length,
    });
    return reply.code(200).send(event);
  });

  app.get("/api/v1/alerts/events", async (_req, reply) => {
    const items = store.listEvents();
    return reply.code(200).send({ items, count: items.length });
  });
}
