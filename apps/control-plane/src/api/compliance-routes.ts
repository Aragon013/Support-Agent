import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  COMPLIANCE_PACKS,
  evaluateCompliancePack,
  getPackById,
} from "../domain/compliance-packs.js";
import { InMemorySecAuditPlanStore } from "../domain/secaudit-plan-store.js";

type IdParams = { id: string };
type PackParams = { packId: string };
type PlanPackParams = { id: string; packId: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function registerComplianceRoutes(app: FastifyInstance): void {
  registerComplianceRoutesWithDeps(app, {});
}

export function registerComplianceRoutesWithDeps(
  app: FastifyInstance,
  deps: { planStore?: InMemorySecAuditPlanStore },
): void {
  const planStore = deps.planStore ?? new InMemorySecAuditPlanStore();

  /**
   * GET /api/v1/compliance/packs
   * List all available compliance packs (id, name, shortName, version, control count).
   */
  app.get("/api/v1/compliance/packs", async (_req, reply) => {
    const items = COMPLIANCE_PACKS.map((p) => ({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      version: p.version,
      controlCount: p.controls.length,
    }));
    return reply.code(200).send({ items, count: items.length });
  });

  /**
   * GET /api/v1/compliance/packs/:packId
   * Full pack definition including all controls.
   */
  app.get<{ Params: PackParams }>(
    "/api/v1/compliance/packs/:packId",
    async (req, reply) => {
      const pack = getPackById(req.params.packId);
      if (!pack) {
        return reply.code(404).send({ code: "not_found", message: "compliance pack not found" });
      }
      return reply.code(200).send(pack);
    },
  );

  /**
   * GET /api/v1/compliance/plans/:id/evaluate/:packId
   * Evaluate a SecAudit plan result set against a compliance pack.
   * Returns per-control status, score, evidence and an aggregate score.
   */
  app.get<{ Params: PlanPackParams }>(
    "/api/v1/compliance/plans/:id/evaluate/:packId",
    async (req: FastifyRequest<{ Params: PlanPackParams }>, reply: FastifyReply) => {
      const plan = planStore.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      const pack = getPackById(req.params.packId);
      if (!pack) {
        return reply.code(404).send({ code: "not_found", message: "compliance pack not found" });
      }

      const moduleResults = new Map(
        plan.results.map((r) => [
          r.moduleId,
          {
            status: r.status,
            findings: r.findings ?? undefined,
            evidence: r.evidence ?? undefined,
          } as { status: "pending" | "running" | "completed" | "failed" | "client_required"; findings?: Record<string, unknown>; evidence?: string[] },
        ]),
      );

      const report = evaluateCompliancePack(pack, moduleResults);
      return reply.code(200).send(report);
    },
  );

  /**
   * GET /api/v1/compliance/plans/:id/evaluate
   * Evaluate a plan against ALL packs and return a summary per pack.
   */
  app.get<{ Params: IdParams }>(
    "/api/v1/compliance/plans/:id/evaluate",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const plan = planStore.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      if (!isNonEmptyString(req.params.id)) {
        return reply.code(422).send({ code: "validation_error", message: "plan id is required" });
      }

      const moduleResults = new Map(
        plan.results.map((r) => [
          r.moduleId,
          {
            status: r.status,
            findings: r.findings ?? undefined,
            evidence: r.evidence ?? undefined,
          } as { status: "pending" | "running" | "completed" | "failed" | "client_required"; findings?: Record<string, unknown>; evidence?: string[] },
        ]),
      );

      const reports = COMPLIANCE_PACKS.map((pack) => evaluateCompliancePack(pack, moduleResults));
      return reply.code(200).send({ planId: plan.id, reports });
    },
  );
}
