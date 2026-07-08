import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { InMemorySecAuditPlanStore, type SecAuditExecutionLevel, type AuditComparison } from "../domain/secaudit-plan-store.js";
import { InMemoryAuditLogStore } from "../domain/audit-log-store.js";

type CreatePlanBody = {
  tenantId: string;
  endpointId: string;
  operatorId: string;
  packageId: string;
  targetOs: "windows" | "linux" | "macos" | "all";
  executionLevel: SecAuditExecutionLevel;
  modules: string[];
};

type IdParams = { id: string };

type TenantQuery = { tenantId?: string };

type ClientFindingsBody = {
  moduleId: string;
  findings: Record<string, unknown>;
  evidence?: string[];
};

type PreHandlerFn = (req: FastifyRequest, reply: FastifyReply, done: () => void) => void;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toSeverity(moduleId: string): "critical" | "high" | "medium" | "low" {
  if (moduleId.includes("threat") || moduleId.includes("identity")) return "critical";
  if (moduleId.includes("firewall") || moduleId.includes("ransomware")) return "high";
  if (moduleId.includes("net.")) return "medium";
  return "low";
}

function mapModuleToCommand(moduleId: string): { commandId: string; requestedParams: Record<string, unknown> } | null {
  switch (moduleId) {
    case "host.os-posture":
      return { commandId: "diagnostic.system.info", requestedParams: {} };
    case "host.firewall-edr":
      return { commandId: "security.firewall.status", requestedParams: { profile: "public" } };
    case "host.identity-admins":
      return { commandId: "diagnostic.system.info", requestedParams: {} };
    case "host.surface-ports":
      return { commandId: "diagnostic.system.info", requestedParams: {} };
    case "net.host-segment":
      return { commandId: "security.firewall.status", requestedParams: { profile: "private" } };
    default:
      return null;
  }
}

export function registerSecAuditRoutes(app: FastifyInstance): void {
  registerSecAuditRoutesWithDeps(app, {});
}

export function registerSecAuditRoutesWithDeps(
  app: FastifyInstance,
  deps: { auditStore?: InMemoryAuditLogStore; requireAdminKey?: PreHandlerFn },
): void {
  const store = new InMemorySecAuditPlanStore();
  const auditStore = deps.auditStore ?? new InMemoryAuditLogStore();
  const requireAdminKey = deps.requireAdminKey ?? ((_req, _reply, done) => done());

  app.post(
    "/api/v1/secaudit/plans",
    async (req: FastifyRequest<{ Body: CreatePlanBody }>, reply: FastifyReply) => {
      const body = req.body;
      if (!body || !isNonEmptyString(body.tenantId) || !isNonEmptyString(body.endpointId) || !isNonEmptyString(body.operatorId) || !Array.isArray(body.modules)) {
        return reply.code(422).send({ code: "validation_error", message: "tenantId, endpointId, operatorId and modules are required" });
      }

      const plan = store.create({
        tenantId: body.tenantId,
        endpointId: body.endpointId,
        operatorId: body.operatorId,
        packageId: body.packageId,
        targetOs: body.targetOs,
        executionLevel: body.executionLevel,
        modules: body.modules,
      });

      auditStore.append({
        tenantId: plan.tenantId,
        endpointId: plan.endpointId,
        operatorId: plan.operatorId,
        code: "command.job.created",
        details: {
          scope: "secaudit",
          planId: plan.id,
          packageId: plan.packageId,
          moduleCount: plan.modules.length,
        },
      });

      return reply.code(201).send(plan);
    },
  );

  app.post(
    "/api/v1/secaudit/plans/:id/run",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const plan = store.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      store.update(plan.id, (draft) => {
        draft.status = "running";
        draft.results = draft.results.map((result) => (
          result.origin === "client_network"
            ? { ...result, status: result.findings ? "completed" : "client_required", updatedAt: new Date().toISOString() }
            : { ...result, status: "running", updatedAt: new Date().toISOString() }
        ));
      });

      for (const result of plan.results) {
        if (result.origin === "client_network") {
          continue;
        }

        const mapped = mapModuleToCommand(result.moduleId);
        if (!mapped) {
          store.update(plan.id, (draft) => {
            const item = draft.results.find((x) => x.moduleId === result.moduleId);
            if (item) {
              item.status = "failed";
              item.error = "module_not_mapped";
              item.updatedAt = new Date().toISOString();
            }
          });
          continue;
        }

        const response = await app.inject({
          method: "POST",
          url: "/api/v1/commands/jobs",
          headers: {
            "content-type": "application/json",
            "x-operator-role": "tech",
            "x-endpoint-status": "online",
            "x-endpoint-license-status": "active",
            "x-endpoint-install-profile": "support_full",
            "x-mfa-verified": "true",
          },
          payload: {
            tenantId: plan.tenantId,
            endpointId: plan.endpointId,
            operatorId: plan.operatorId,
            catalogCommandId: mapped.commandId,
            requestedParams: mapped.requestedParams,
          },
        });

        const body = response.json() as { id?: string; status?: string; reason?: string };

        store.update(plan.id, (draft) => {
          const item = draft.results.find((x) => x.moduleId === result.moduleId);
          if (!item) return;

          if ((response.statusCode === 201 || response.statusCode === 202) && body.id) {
            item.commandJobId = body.id;
            item.status = "running";
            item.updatedAt = new Date().toISOString();
          } else {
            item.status = "failed";
            item.error = body.reason ?? `http_${response.statusCode}`;
            item.updatedAt = new Date().toISOString();
          }
        });
      }

      const updated = store.getById(plan.id);
      if (!updated) {
        return reply.code(500).send({ code: "internal_error", message: "plan disappeared after run" });
      }

      return reply.code(200).send({
        id: updated.id,
        status: updated.status,
        modules: updated.results,
      });
    },
  );

  app.post(
    "/api/v1/secaudit/plans/:id/client-findings",
    async (req: FastifyRequest<{ Params: IdParams; Body: ClientFindingsBody }>, reply: FastifyReply) => {
      const plan = store.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      if (!isNonEmptyString(req.body?.moduleId) || typeof req.body?.findings !== "object" || Array.isArray(req.body.findings) || !req.body.findings) {
        return reply.code(422).send({ code: "validation_error", message: "moduleId and findings are required" });
      }

      const updated = store.update(plan.id, (draft) => {
        const target = draft.results.find((x) => x.moduleId === req.body.moduleId);
        if (!target) return;
        target.findings = req.body.findings;
        target.evidence = req.body.evidence ?? [];
        target.status = "completed";
        target.updatedAt = new Date().toISOString();
      });

      return reply.code(200).send(updated);
    },
  );

  app.get(
    "/api/v1/secaudit/plans/:id",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const plan = store.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }
      return reply.code(200).send(plan);
    },
  );

  app.get(
    "/api/v1/secaudit/plans/:id/results",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const plan = store.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      for (const result of plan.results) {
        if (!result.commandJobId) continue;

        const job = await app.inject({
          method: "GET",
          url: `/api/v1/commands/jobs/${result.commandJobId}`,
        });

        if (job.statusCode < 200 || job.statusCode >= 300) continue;
        const body = job.json() as { status?: string };
        const status = body.status;

        const terminalOk = status === "completed";
        const terminalFail = status === "failed" || status === "blocked" || status === "cancelled";

        if (!terminalOk && !terminalFail) {
          continue;
        }

        const transcript = await app.inject({
          method: "GET",
          url: `/api/v1/commands/jobs/${result.commandJobId}/channel-messages`,
        });
        const transcriptBody = transcript.statusCode >= 200 && transcript.statusCode < 300
          ? (transcript.json() as { items?: Array<{ kind: string; chunk?: string; reason?: string; exitCode?: number }> })
          : { items: [] };

        const evidence = (transcriptBody.items ?? []).flatMap((item) => {
          if (item.kind === "command.stdout" || item.kind === "command.stderr") return item.chunk ? [item.chunk] : [];
          if (item.kind === "command.abort") return item.reason ? [`abort=${item.reason}`] : [];
          if (item.kind === "command.exit") return [typeof item.exitCode === "number" ? `exitCode=${item.exitCode}` : "exitCode=unknown"];
          return [];
        }).slice(0, 40);

        store.update(plan.id, (draft) => {
          const target = draft.results.find((x) => x.moduleId === result.moduleId);
          if (!target) return;
          target.status = terminalOk ? "completed" : "failed";
          target.evidence = evidence;
          target.findings = {
            severity: toSeverity(result.moduleId),
            status: terminalOk ? "ok" : "issue",
            signalCount: evidence.length,
          };
          target.updatedAt = new Date().toISOString();
        });
      }

      const refreshed = store.getById(plan.id);
      if (!refreshed) {
        return reply.code(500).send({ code: "internal_error", message: "plan disappeared during refresh" });
      }

      const completed = refreshed.results.every((x) => x.status === "completed");
      const failedAny = refreshed.results.some((x) => x.status === "failed");
      const runningAny = refreshed.results.some((x) => x.status === "running" || x.status === "pending");
      const clientPending = refreshed.results.some((x) => x.status === "client_required");

      const nextStatus = completed
        ? "completed"
        : failedAny
          ? (runningAny || clientPending ? "partial" : "failed")
          : (runningAny || clientPending ? "running" : "partial");

      store.update(plan.id, (draft) => {
        draft.status = nextStatus;
      });

      const latest = store.getById(plan.id)!;
      return reply.code(200).send({
        id: latest.id,
        status: latest.status,
        score: latest.score,
        severityBuckets: latest.severityBuckets,
        summary: {
          total: latest.results.length,
          completed: latest.results.filter((x) => x.status === "completed").length,
          failed: latest.results.filter((x) => x.status === "failed").length,
          running: latest.results.filter((x) => x.status === "running" || x.status === "pending").length,
          clientRequired: latest.results.filter((x) => x.status === "client_required").length,
        },
        modules: latest.results,
      });
    },
  );

  app.get(
    "/api/v1/secaudit/plans/:id/report",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const plan = store.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      const completedModules = plan.results.filter((x) => x.status === "completed");
      const failedModules = plan.results.filter((x) => x.status === "failed");
      const pendingModules = plan.results.filter((x) => x.status === "pending" || x.status === "running" || x.status === "client_required");

      const report = {
        id: plan.id,
        tenantId: plan.tenantId,
        endpointId: plan.endpointId,
        operatorId: plan.operatorId,
        packageId: plan.packageId,
        targetOs: plan.targetOs,
        executionLevel: plan.executionLevel,
        status: plan.status,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
        executive: {
          score: plan.score ?? null,
          severities: plan.severityBuckets ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          completion: {
            total: plan.results.length,
            completed: completedModules.length,
            failed: failedModules.length,
            pending: pendingModules.length,
            percentComplete: plan.results.length > 0 ? Math.round((completedModules.length / plan.results.length) * 100) : 0,
          },
          summary: completedModules.length > 0
            ? `Audit completed with ${plan.score} security score. ${plan.severityBuckets?.critical ?? 0} critical, ${plan.severityBuckets?.high ?? 0} high severity findings.`
            : failedModules.length > 0
              ? `Audit partially completed. ${failedModules.length} module(s) failed.`
              : "Audit in progress or awaiting client results.",
        },
        modules: plan.results.map((result) => ({
          id: result.moduleId,
          origin: result.origin,
          status: result.status,
          findings: result.findings ?? null,
          evidence: result.evidence ?? [],
          error: result.error ?? null,
          updatedAt: result.updatedAt,
        })),
      };

      return reply.code(200).send(report);
    },
  );

  app.get(
    "/api/v1/secaudit/plans/:id/compare",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const comparison = store.compare(req.params.id);
      if (!comparison) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }
      return reply.code(200).send(comparison);
    },
  );

  app.get(
    "/api/v1/secaudit/plans",
    { preHandler: requireAdminKey },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req.query as TenantQuery).tenantId;
      if (!isNonEmptyString(tenantId)) {
        return reply.code(422).send({ code: "validation_error", message: "tenantId query is required" });
      }
      const items = store.listByTenant(tenantId);
      return reply.code(200).send({ items, count: items.length });
    },
  );
}
