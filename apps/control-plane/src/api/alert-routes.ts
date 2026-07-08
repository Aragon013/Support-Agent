import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { InMemoryAlertStore, type AlertChannelType } from "../domain/alert-store.js";
import { AlertDispatcher } from "../services/alert-dispatcher.js";

type CreateChannelBody = {
  name: string;
  type: AlertChannelType;
  target: string;
  enabled?: boolean;
};

type UpdateChannelBody = {
  name?: string;
  target?: string;
  enabled?: boolean;
};

type IdParams = { id: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isChannelType(v: unknown): v is AlertChannelType {
  return v === "slack" || v === "teams" || v === "webhook" || v === "email";
}

export function registerAlertRoutes(app: FastifyInstance): void {
  registerAlertRoutesWithDeps(app, {});
}

export function registerAlertRoutesWithDeps(
  app: FastifyInstance,
  deps: { store?: InMemoryAlertStore; dispatcher?: AlertDispatcher },
): void {
  const store = deps.store ?? new InMemoryAlertStore();
  const dispatcher = deps.dispatcher ?? new AlertDispatcher(store);

  app.post<{ Body: CreateChannelBody }>("/api/v1/alerts/channels", async (req, reply) => {
    const b = req.body;
    if (!b || !isNonEmptyString(b.name) || !isChannelType(b.type) || !isNonEmptyString(b.target)) {
      return reply.code(422).send({ code: "validation_error", message: "name, type and target are required" });
    }
    const created = store.createChannel({
      name: b.name,
      type: b.type,
      target: b.target,
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
    });
    return reply.code(201).send(created);
  });

  app.get("/api/v1/alerts/channels", async (_req, reply) => {
    const items = store.listChannels();
    return reply.code(200).send({ items, count: items.length });
  });

  app.patch<{ Params: IdParams; Body: UpdateChannelBody }>("/api/v1/alerts/channels/:id", async (req, reply) => {
    const found = store.getChannelById(req.params.id);
    if (!found) {
      return reply.code(404).send({ code: "not_found", message: "alert channel not found" });
    }

    const b = req.body ?? {};
    const updated = store.updateChannel(req.params.id, {
      ...(isNonEmptyString(b.name) ? { name: b.name } : {}),
      ...(isNonEmptyString(b.target) ? { target: b.target } : {}),
      ...(typeof b.enabled === "boolean" ? { enabled: b.enabled } : {}),
    });

    return reply.code(200).send(updated);
  });

  app.post("/api/v1/alerts/test", async (_req: FastifyRequest, reply: FastifyReply) => {
    const event = await dispatcher.dispatch({
      category: "test",
      severity: "info",
      title: "SecAudit test alert",
      message: "Manual test alert from control-plane",
      context: { source: "manual_test" },
    });
    return reply.code(200).send(event);
  });

  app.get("/api/v1/alerts/events", async (_req, reply) => {
    const items = store.listEvents();
    return reply.code(200).send({ items, count: items.length });
  });
}
