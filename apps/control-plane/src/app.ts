import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";

import { registerCommandRoutesWithDeps } from "./api/command-routes.js";
import { registerSessionRoutesWithDeps } from "./api/session-routes.js";
import { InMemoryAuditLogStore } from "./domain/audit-log-store.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  const auditStore = new InMemoryAuditLogStore();

  app.register(websocket);
  app.after(() => {
    registerCommandRoutesWithDeps(app, { auditStore });
    registerSessionRoutesWithDeps(app, { auditStore });
  });

  app.get("/health", async () => {
    return { ok: true, service: "control-plane" };
  });

  return app;
}
