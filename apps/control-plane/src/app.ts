import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import { join } from "node:path";

import { registerCommandRoutesWithDeps } from "./api/command-routes.js";
import { registerSessionRoutesWithDeps } from "./api/session-routes.js";
import { registerSecAuditRoutesWithDeps } from "./api/secaudit-routes.js";
import { registerComplianceRoutesWithDeps } from "./api/compliance-routes.js";
import { registerExceptionRoutesWithDeps } from "./api/exception-routes.js";
import { registerAlertRoutesWithDeps } from "./api/alert-routes.js";
import { InMemoryAlertStore } from "./domain/alert-store.js";
import { InMemoryExceptionStore } from "./domain/exception-store.js";
import { InMemoryAuditLogStore } from "./domain/audit-log-store.js";
import { InMemorySecAuditPlanStore } from "./domain/secaudit-plan-store.js";
import { AlertDispatcher } from "./services/alert-dispatcher.js";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "dev-insecure-key-change-in-prod";

/** Verifica x-api-key para rutas de administración. */
function requireAdminKey(req: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const key = req.headers["x-api-key"];
  if (key !== ADMIN_API_KEY) {
    reply.code(401).send({ code: "unauthorized", message: "Invalid or missing x-api-key header." });
    return;
  }
  done();
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });
  const auditStore = new InMemoryAuditLogStore();
  const persistencePath = process.env.NODE_ENV === "test"
    ? undefined
    : (process.env.SECAUDIT_STORE_FILE ?? join(process.cwd(), ".data", "secaudit-plans.json"));
  const planStore = new InMemorySecAuditPlanStore(
    persistencePath,
  );
  const exceptionStore = new InMemoryExceptionStore();
  const alertStore = new InMemoryAlertStore();
  const alertDispatcher = new AlertDispatcher(alertStore);

  void app.register(rateLimit, {
    global: false, // aplica solo en rutas que lo declaren explícitamente
  });

  app.register(websocket);
  app.after(() => {
    registerCommandRoutesWithDeps(app, { auditStore, requireAdminKey });
    registerSessionRoutesWithDeps(app, { auditStore, requireAdminKey });
    registerSecAuditRoutesWithDeps(app, {
      auditStore,
      requireAdminKey,
      planStore,
      onCriticalDrift: async ({ planId, tenantId, endpointId, scoreDelta, severityDelta, baselinePlanId }) => {
        await alertDispatcher.dispatch({
          category: "drift",
          severity: "critical",
          title: `Critical drift detected for ${planId}`,
          message: `Score delta ${scoreDelta ?? 0}; critical +${severityDelta.critical}, high +${severityDelta.high}`,
          context: {
            planId,
            tenantId,
            endpointId,
            baselinePlanId,
            scoreDelta,
            severityDelta,
          },
        });
      },
    });
    registerComplianceRoutesWithDeps(app, { planStore });
    registerExceptionRoutesWithDeps(app, { store: exceptionStore });
    registerAlertRoutesWithDeps(app, { store: alertStore, dispatcher: alertDispatcher });
  });

  app.get("/health", async () => {
    return {
      ok: true,
      service: "control-plane",
      uptime: Math.floor(process.uptime()),
      node: process.version,
    };
  });

  return app;
}
