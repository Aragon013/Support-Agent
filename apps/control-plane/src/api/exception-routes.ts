import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { InMemoryExceptionStore } from "../domain/exception-store.js";

type IdParams = { id: string };
type TenantQuery = { tenantId?: string };
type PlanQuery = { planId?: string };

type CreateBody = {
  tenantId: string;
  planId: string;
  moduleId: string;
  controlId?: string;
  justification: string;
  requestedBy: string;
  expiresAt: string;
};

type ReviewBody = {
  status: "approved" | "rejected";
  approvedBy: string;
  notes?: string;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidIso(v: unknown): v is string {
  if (!isNonEmptyString(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d > new Date();
}

export function registerExceptionRoutes(app: FastifyInstance): void {
  registerExceptionRoutesWithDeps(app, {});
}

export function registerExceptionRoutesWithDeps(
  app: FastifyInstance,
  deps: { store?: InMemoryExceptionStore },
): void {
  const store = deps.store ?? new InMemoryExceptionStore();

  // Expire overdue exceptions every 5 minutes
  const expiryTimer = setInterval(() => { store.expireOverdue(); }, 5 * 60_000);
  app.addHook("onClose", (_inst, done) => { clearInterval(expiryTimer); done(); });

  /**
   * POST /api/v1/exceptions
   * Request a new exception for a plan+module (or plan+module+control).
   */
  app.post<{ Body: CreateBody }>(
    "/api/v1/exceptions",
    async (req, reply) => {
      const b = req.body;
      if (
        !b ||
        !isNonEmptyString(b.tenantId) ||
        !isNonEmptyString(b.planId) ||
        !isNonEmptyString(b.moduleId) ||
        !isNonEmptyString(b.justification) ||
        !isNonEmptyString(b.requestedBy) ||
        !isValidIso(b.expiresAt)
      ) {
        return reply.code(422).send({
          code: "validation_error",
          message: "tenantId, planId, moduleId, justification, requestedBy and a future expiresAt are required",
        });
      }

      const record = store.create({
        tenantId: b.tenantId,
        planId: b.planId,
        moduleId: b.moduleId,
        justification: b.justification,
        requestedBy: b.requestedBy,
        expiresAt: b.expiresAt,
        ...(isNonEmptyString(b.controlId) ? { controlId: b.controlId } : {}),
      });

      return reply.code(201).send(record);
    },
  );

  /**
   * GET /api/v1/exceptions
   * List exceptions — filtered by tenantId or planId query param.
   */
  app.get(
    "/api/v1/exceptions",
    async (req: FastifyRequest<{ Querystring: TenantQuery & PlanQuery }>, reply: FastifyReply) => {
      const { tenantId, planId } = req.query;

      let items;
      if (isNonEmptyString(planId)) {
        items = store.listByPlan(planId);
      } else if (isNonEmptyString(tenantId)) {
        items = store.listByTenant(tenantId);
      } else {
        return reply.code(422).send({ code: "validation_error", message: "tenantId or planId query is required" });
      }

      return reply.code(200).send({ items, count: items.length });
    },
  );

  /**
   * GET /api/v1/exceptions/:id
   */
  app.get<{ Params: IdParams }>(
    "/api/v1/exceptions/:id",
    async (req, reply) => {
      const record = store.getById(req.params.id);
      if (!record) return reply.code(404).send({ code: "not_found", message: "exception not found" });
      return reply.code(200).send(record);
    },
  );

  /**
   * POST /api/v1/exceptions/:id/review
   * Approve or reject a pending exception.
   */
  app.post<{ Params: IdParams; Body: ReviewBody }>(
    "/api/v1/exceptions/:id/review",
    async (req, reply) => {
      const found = store.getById(req.params.id);
      if (!found) return reply.code(404).send({ code: "not_found", message: "exception not found" });
      if (found.status !== "pending") {
        return reply.code(409).send({ code: "invalid_state", message: `exception is already ${found.status}` });
      }

      const b = req.body;
      if (b?.status !== "approved" && b?.status !== "rejected") {
        return reply.code(422).send({ code: "validation_error", message: "status must be approved | rejected" });
      }
      if (!isNonEmptyString(b.approvedBy)) {
        return reply.code(422).send({ code: "validation_error", message: "approvedBy is required" });
      }

      const updated = store.update(req.params.id, {
        status: b.status,
        approvedBy: b.approvedBy,
        ...(isNonEmptyString(b.notes) ? { notes: b.notes } : {}),
      });

      return reply.code(200).send(updated);
    },
  );

  /**
   * GET /api/v1/exceptions/check
   * Quick check: does an active approved exception exist for a plan+module?
   * Query: planId, moduleId, [controlId]
   */
  app.get(
    "/api/v1/exceptions/check",
    async (
      req: FastifyRequest<{ Querystring: { planId?: string; moduleId?: string; controlId?: string } }>,
      reply: FastifyReply,
    ) => {
      const { planId, moduleId, controlId } = req.query;
      if (!isNonEmptyString(planId) || !isNonEmptyString(moduleId)) {
        return reply.code(422).send({ code: "validation_error", message: "planId and moduleId are required" });
      }
      const active = store.hasActiveException(planId, moduleId, isNonEmptyString(controlId) ? controlId : undefined);
      return reply.code(200).send({ planId, moduleId, controlId: controlId ?? null, hasActiveException: active });
    },
  );
}
