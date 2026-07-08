import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { InMemorySecAuditPlanStore, type SecAuditExecutionLevel, type AuditComparison } from "../domain/secaudit-plan-store.js";
import { InMemoryAuditLogStore } from "../domain/audit-log-store.js";
import { generateSecAuditPDF } from "../services/pdf-generator.js";
import { buildSecAuditReport } from "../services/secaudit-report.js";

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
  if (
    moduleId.includes("threat") ||
    moduleId.includes("identity") ||
    moduleId.includes("compliance") ||
    moduleId.includes("code-integrity") ||
    moduleId.includes("secret")
  ) {
    return "critical";
  }
  if (
    moduleId.includes("firewall") ||
    moduleId.includes("ransomware") ||
    moduleId.includes("incident") ||
    moduleId.includes("lateral") ||
    moduleId.includes("remote-access") ||
    moduleId.includes("supply-chain") ||
    moduleId.includes("backup") ||
    moduleId.includes("cloud")
  ) {
    return "high";
  }
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
    case "identity.mfa-posture":
      return { commandId: "security.mfa.status", requestedParams: { scope: "all" } };
    case "identity.secrets-exposure":
      return { commandId: "security.secret-scanning.status", requestedParams: { scope: "all" } };
    case "host.surface-ports":
      return { commandId: "diagnostic.system.info", requestedParams: {} };
    case "app.supply-chain":
      return { commandId: "security.software-integrity.status", requestedParams: { framework: "supply-chain" } };
    case "host.code-integrity":
      return { commandId: "security.driver-signing.status", requestedParams: {} };
    case "host.lateral-movement":
      return { commandId: "security.credential-guard.status", requestedParams: {} };
    case "host.cloud-saas-posture":
      return { commandId: "diagnostic.cloud.config", requestedParams: { provider: "all" } };
    case "net.host-segment":
      return { commandId: "security.firewall.status", requestedParams: { profile: "private" } };
    case "net.remote-access":
      return { commandId: "security.remote-access.status", requestedParams: { mode: "all" } };
    case "threat.hunt-lite":
      return { commandId: "diagnostic.process.enum", requestedParams: {} };
    case "threat.hunt-deep":
      return { commandId: "diagnostic.process.enum", requestedParams: { deep: true } };
    case "incident.response-readiness":
      return { commandId: "diagnostic.system.info", requestedParams: { forensic: true } };
    case "compliance.hipaa":
      return { commandId: "security.audit-logging.status", requestedParams: { framework: "hipaa" } };
    case "compliance.pci-dss":
      return { commandId: "security.firewall.status", requestedParams: { framework: "pci-dss" } };
    case "compliance.soc2":
      return { commandId: "security.audit-logging.status", requestedParams: { framework: "soc2" } };
    case "compliance.cis":
      return { commandId: "security.benchmark.status", requestedParams: { framework: "cis" } };
    case "resilience.backup":
      return { commandId: "diagnostic.backup-status.check", requestedParams: {} };
    case "resilience.ransomware":
      return { commandId: "diagnostic.system.info", requestedParams: { ransomware: true } };
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

      const report = buildSecAuditReport(plan);

      return reply.code(200).send(report);
    },
  );

  app.post(
    "/api/v1/secaudit/plans/:id/report/pdf",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const plan = store.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      const comparison = store.compare(req.params.id);
      const pdfBuffer = generateSecAuditPDF({
        plan,
        comparison,
      });

      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `attachment; filename="audit-${plan.id}.pdf"`);
      return reply.code(200).send(pdfBuffer);
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
