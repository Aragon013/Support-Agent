import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { InMemorySecAuditPlanStore, type SecAuditExecutionLevel, type AuditComparison } from "../domain/secaudit-plan-store.js";
import { InMemoryAuditLogStore } from "../domain/audit-log-store.js";
import { InMemorySecAuditStressStore } from "../domain/secaudit-stress-store.js";
import { generateSecAuditPDF } from "../services/pdf-generator.js";
import { buildSecAuditReport, generateSecAuditCSV } from "../services/secaudit-report.js";
import { SecAuditStressDiagnostics } from "../services/secaudit-stress-diagnostics.js";

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

type BatchCreateBody = {
  tenantId: string;
  operatorId: string;
  packageId: string;
  targetOs: "windows" | "linux" | "macos" | "all";
  executionLevel: SecAuditExecutionLevel;
  modules: string[];
  endpointIds: string[];
};

type ScheduleCreateBody = {
  tenantId: string;
  operatorId: string;
  endpointId: string;
  packageId: string;
  targetOs: "windows" | "linux" | "macos" | "all";
  executionLevel: SecAuditExecutionLevel;
  modules: string[];
  intervalMinutes?: number;
};

type RemediationStatus = "open" | "accepted" | "closed";

type RemediationUpdateBody = {
  status?: RemediationStatus;
  notes?: string;
};

type BatchRecord = {
  id: string;
  tenantId: string;
  operatorId: string;
  endpointIds: string[];
  planIds: string[];
  createdAt: string;
  status: "running" | "completed" | "partial" | "failed" | "cancelled";
};

type ScheduleRecord = {
  id: string;
  tenantId: string;
  operatorId: string;
  endpointId: string;
  packageId: string;
  targetOs: "windows" | "linux" | "macos" | "all";
  executionLevel: SecAuditExecutionLevel;
  modules: string[];
  intervalMinutes: number;
  nextRunAt: string;
  createdAt: string;
};

type RemediationState = {
  planId: string;
  moduleId: string;
  status: RemediationStatus;
  notes?: string;
  updatedAt: string;
};

type ClientFindingsBody = {
  moduleId: string;
  findings: Record<string, unknown>;
  evidence?: string[];
};

type StressRecoveryPolicyBody = {
  autoResumeEnabled?: boolean;
  stopThresholds?: {
    packetLossPct?: number;
    latencyMs?: number;
    responseTimeMs?: number;
  };
  resumeDelayMs?: number;
  resumeBackoffMs?: number;
  maxResumeAttempts?: number;
  resumeProbeSamples?: number;
  resumeHealthySamplesRequired?: number;
  resumeThresholds?: {
    packetLossPct?: number;
    latencyMs?: number;
    responseTimeMs?: number;
  };
};

type EthernetStressBody = {
  tenantId: string;
  operatorId: string;
  endpointId: string;
  iterations?: number;
  expectedBandwidthMbps?: number;
  saturationThresholdPct?: number;
  recoveryPolicy?: StressRecoveryPolicyBody;
};

type WirelessDensityBody = {
  tenantId: string;
  operatorId: string;
  endpointId: string;
  apId: string;
  iterations?: number;
  expectedMaxClients?: number;
  associationThresholdPct?: number;
  recoveryPolicy?: StressRecoveryPolicyBody;
};

type StressReportQuery = {
  tenantId?: string;
  module?: "ethernet_resilience" | "wireless_density";
};

type PreHandlerFn = (req: FastifyRequest, reply: FastifyReply, done: () => void) => void;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
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
  deps: {
    auditStore?: InMemoryAuditLogStore;
    requireAdminKey?: PreHandlerFn;
    planStore?: InMemorySecAuditPlanStore;
    stressStore?: InMemorySecAuditStressStore;
    stressDiagnostics?: SecAuditStressDiagnostics;
    onCriticalDrift?: (payload: {
      planId: string;
      tenantId: string;
      endpointId: string;
      scoreDelta: number | null;
      severityDelta: { critical: number; high: number; medium: number; low: number; info: number };
      baselinePlanId: string | null;
    }) => Promise<void> | void;
  },
): void {
  const store = deps.planStore ?? new InMemorySecAuditPlanStore();
  const auditStore = deps.auditStore ?? new InMemoryAuditLogStore();
  const requireAdminKey = deps.requireAdminKey ?? ((_req, _reply, done) => done());
  const stressStore = deps.stressStore ?? new InMemorySecAuditStressStore();
  const stressDiagnostics = deps.stressDiagnostics ?? new SecAuditStressDiagnostics(stressStore);
  const onCriticalDrift = deps.onCriticalDrift;
  const batches = new Map<string, BatchRecord>();
  const schedules = new Map<string, ScheduleRecord>();
  const remediationStates = new Map<string, RemediationState>();
  const driftAlertedPlanIds = new Set<string>();
  const dbUrl = process.env.NODE_ENV === "test" ? undefined : process.env.SECAUDIT_DB_URL;
  const dbPool = dbUrl ? new pg.Pool({ connectionString: dbUrl }) : null;
  let persistenceHydrated = dbPool === null;
  let hydratePromise: Promise<void> | null = null;

  const ensurePersistenceSchema = async () => {
    if (!dbPool) return;
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS secaudit_batches (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        endpoint_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        plan_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed', 'cancelled')),
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS secaudit_schedules (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        endpoint_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        target_os TEXT NOT NULL,
        execution_level TEXT NOT NULL,
        modules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        interval_minutes INTEGER NOT NULL,
        next_run_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_secaudit_batches_tenant_created
        ON secaudit_batches (tenant_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_secaudit_schedules_next_run
        ON secaudit_schedules (next_run_at ASC);
    `);
  };

  const saveBatchToDb = async (batch: BatchRecord) => {
    if (!dbPool) return;
    await dbPool.query(
      `
        INSERT INTO secaudit_batches (
          id,
          tenant_id,
          operator_id,
          endpoint_ids_json,
          plan_ids_json,
          status,
          created_at
        )
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::timestamptz)
        ON CONFLICT (id)
        DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          operator_id = EXCLUDED.operator_id,
          endpoint_ids_json = EXCLUDED.endpoint_ids_json,
          plan_ids_json = EXCLUDED.plan_ids_json,
          status = EXCLUDED.status,
          created_at = EXCLUDED.created_at
      `,
      [
        batch.id,
        batch.tenantId,
        batch.operatorId,
        JSON.stringify(batch.endpointIds),
        JSON.stringify(batch.planIds),
        batch.status,
        batch.createdAt,
      ],
    );
  };

  const saveScheduleToDb = async (schedule: ScheduleRecord) => {
    if (!dbPool) return;
    await dbPool.query(
      `
        INSERT INTO secaudit_schedules (
          id,
          tenant_id,
          operator_id,
          endpoint_id,
          package_id,
          target_os,
          execution_level,
          modules_json,
          interval_minutes,
          next_run_at,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::timestamptz, $11::timestamptz)
        ON CONFLICT (id)
        DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          operator_id = EXCLUDED.operator_id,
          endpoint_id = EXCLUDED.endpoint_id,
          package_id = EXCLUDED.package_id,
          target_os = EXCLUDED.target_os,
          execution_level = EXCLUDED.execution_level,
          modules_json = EXCLUDED.modules_json,
          interval_minutes = EXCLUDED.interval_minutes,
          next_run_at = EXCLUDED.next_run_at,
          created_at = EXCLUDED.created_at
      `,
      [
        schedule.id,
        schedule.tenantId,
        schedule.operatorId,
        schedule.endpointId,
        schedule.packageId,
        schedule.targetOs,
        schedule.executionLevel,
        JSON.stringify(schedule.modules),
        schedule.intervalMinutes,
        schedule.nextRunAt,
        schedule.createdAt,
      ],
    );
  };

  const deleteScheduleFromDb = async (id: string) => {
    if (!dbPool) return;
    await dbPool.query("DELETE FROM secaudit_schedules WHERE id = $1", [id]);
  };

  const ensurePersistenceHydrated = async () => {
    if (persistenceHydrated || !dbPool) return;
    if (!hydratePromise) {
      hydratePromise = (async () => {
        try {
          await ensurePersistenceSchema();

          const batchResult = await dbPool.query<{
            id: string;
            tenant_id: string;
            operator_id: string;
            endpoint_ids_json: unknown;
            plan_ids_json: unknown;
            status: BatchRecord["status"];
            created_at: string | Date;
          }>(
            `SELECT id, tenant_id, operator_id, endpoint_ids_json, plan_ids_json, status, created_at
             FROM secaudit_batches`,
          );

          for (const row of batchResult.rows) {
            batches.set(row.id, {
              id: row.id,
              tenantId: row.tenant_id,
              operatorId: row.operator_id,
              endpointIds: asStringArray(row.endpoint_ids_json),
              planIds: asStringArray(row.plan_ids_json),
              status: row.status,
              createdAt: new Date(row.created_at).toISOString(),
            });
          }

          const scheduleResult = await dbPool.query<{
            id: string;
            tenant_id: string;
            operator_id: string;
            endpoint_id: string;
            package_id: string;
            target_os: "windows" | "linux" | "macos" | "all";
            execution_level: SecAuditExecutionLevel;
            modules_json: unknown;
            interval_minutes: number;
            next_run_at: string | Date;
            created_at: string | Date;
          }>(
            `SELECT id, tenant_id, operator_id, endpoint_id, package_id, target_os, execution_level,
                    modules_json, interval_minutes, next_run_at, created_at
             FROM secaudit_schedules`,
          );

          for (const row of scheduleResult.rows) {
            schedules.set(row.id, {
              id: row.id,
              tenantId: row.tenant_id,
              operatorId: row.operator_id,
              endpointId: row.endpoint_id,
              packageId: row.package_id,
              targetOs: row.target_os,
              executionLevel: row.execution_level,
              modules: asStringArray(row.modules_json),
              intervalMinutes: row.interval_minutes,
              nextRunAt: new Date(row.next_run_at).toISOString(),
              createdAt: new Date(row.created_at).toISOString(),
            });
          }
        } catch (error) {
          app.log.error({ error }, "Failed to hydrate SecAudit batch/schedule persistence, continuing in-memory");
        } finally {
          persistenceHydrated = true;
          hydratePromise = null;
        }
      })();
    }
    await hydratePromise;
  };

  const remediationKey = (planId: string, moduleId: string) => `${planId}:${moduleId}`;

  const getRemediationStatus = (planId: string, moduleId: string) => remediationStates.get(remediationKey(planId, moduleId));

  const runPlan = async (planId: string) => {
    const plan = store.getById(planId);
    if (!plan) return null;

    store.update(plan.id, (draft) => {
      draft.status = "running";
      draft.results = draft.results.map((result) => (
        result.origin === "client_network"
          ? { ...result, status: result.findings ? "completed" : "client_required", updatedAt: new Date().toISOString() }
          : { ...result, status: "running", updatedAt: new Date().toISOString() }
      ));
    });

    for (const result of plan.results) {
      if (result.origin === "client_network") continue;

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
          "x-command-local-runner": "true",
        },
        payload: {
          tenantId: plan.tenantId,
          endpointId: plan.endpointId,
          operatorId: plan.operatorId,
          catalogCommandId: mapped.commandId,
          requestedParams: mapped.requestedParams,
        },
      });

      const body = response.json() as { id?: string; reason?: string };

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
    if (!updated) return null;
    return {
      id: updated.id,
      status: updated.status,
      modules: updated.results,
    };
  };

  const refreshPlan = async (planId: string) => {
    const plan = store.getById(planId);
    if (!plan) return null;

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
      if (!terminalOk && !terminalFail) continue;

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
    if (!refreshed) return null;

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

    return store.getById(plan.id) ?? null;
  };

  const maybeEmitCriticalDrift = async (planId: string) => {
    if (!onCriticalDrift) return;
    if (driftAlertedPlanIds.has(planId)) return;

    const plan = store.getById(planId);
    if (!plan) return;
    if (plan.status !== "completed" && plan.status !== "partial" && plan.status !== "failed") return;

    const comparison = store.compare(planId);
    if (!comparison || !comparison.baseline) return;

    const scoreDelta = comparison.scoreDelta ?? 0;
    const severityDelta = comparison.severityDelta;
    const criticalRegression =
      scoreDelta <= -10 ||
      severityDelta.critical > 0 ||
      severityDelta.high >= 2;

    if (!criticalRegression) return;

    driftAlertedPlanIds.add(planId);
    await onCriticalDrift({
      planId: plan.id,
      tenantId: plan.tenantId,
      endpointId: plan.endpointId,
      scoreDelta: comparison.scoreDelta,
      severityDelta,
      baselinePlanId: comparison.baseline?.id ?? null,
    });
  };

  const summarizeBatch = (batch: BatchRecord) => {
    const plans = batch.planIds.map((id) => store.getById(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
    const completed = plans.filter((p) => p.status === "completed").length;
    const failed = plans.filter((p) => p.status === "failed").length;
    const partial = plans.filter((p) => p.status === "partial").length;
    const running = plans.filter((p) => p.status === "running" || p.status === "draft").length;

    const nextStatus: BatchRecord["status"] = batch.status === "cancelled"
      ? "cancelled"
      : completed === plans.length
        ? "completed"
        : failed === plans.length
          ? "failed"
          : (partial > 0 || failed > 0) && completed > 0
            ? "partial"
            : "running";

    return {
      ...batch,
      status: nextStatus,
      summary: {
        total: plans.length,
        completed,
        failed,
        partial,
        running,
      },
    };
  };

  const schedulerTimer = setInterval(async () => {
    await ensurePersistenceHydrated();
    const now = Date.now();
    for (const schedule of schedules.values()) {
      if (new Date(schedule.nextRunAt).getTime() > now) continue;
      const created = store.create({
        tenantId: schedule.tenantId,
        endpointId: schedule.endpointId,
        operatorId: schedule.operatorId,
        packageId: schedule.packageId,
        targetOs: schedule.targetOs,
        executionLevel: schedule.executionLevel,
        modules: schedule.modules,
      });
      await runPlan(created.id);
      schedule.nextRunAt = new Date(now + schedule.intervalMinutes * 60_000).toISOString();
      schedules.set(schedule.id, schedule);
      await saveScheduleToDb(schedule);
    }
  }, 30_000);

  app.addHook("onClose", (_instance, done) => {
    clearInterval(schedulerTimer);
    if (!dbPool) {
      done();
      return;
    }
    dbPool.end().then(() => done()).catch(() => done());
  });

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
      const updated = await runPlan(req.params.id);
      if (!updated) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      return reply.code(200).send({
        id: updated.id,
        status: updated.status,
        modules: updated.modules,
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
      const latest = await refreshPlan(req.params.id);
      if (!latest) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      try {
        await maybeEmitCriticalDrift(req.params.id);
      } catch (error) {
        app.log.error({ error, planId: req.params.id }, "Failed to emit critical drift alert");
      }

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
      const remediations = report.remediations.map((item) => {
        const state = getRemediationStatus(plan.id, item.moduleId);
        return {
          ...item,
          tracking: {
            status: state?.status ?? "open",
            notes: state?.notes,
            updatedAt: state?.updatedAt,
          },
        };
      });

      return reply.code(200).send({ ...report, remediations });
    },
  );

  app.get(
    "/api/v1/secaudit/plans/:id/remediations",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const plan = store.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }
      const report = buildSecAuditReport(plan);
      const items = report.remediations.map((item) => {
        const state = getRemediationStatus(plan.id, item.moduleId);
        return {
          ...item,
          status: state?.status ?? "open",
          notes: state?.notes,
          updatedAt: state?.updatedAt,
        };
      });
      return reply.code(200).send({ items, count: items.length });
    },
  );

  app.patch(
    "/api/v1/secaudit/plans/:id/remediations/:moduleId",
    async (req: FastifyRequest<{ Params: { id: string; moduleId: string }; Body: RemediationUpdateBody }>, reply: FastifyReply) => {
      const plan = store.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      const report = buildSecAuditReport(plan);
      const exists = report.remediations.some((item) => item.moduleId === req.params.moduleId);
      if (!exists) {
        return reply.code(404).send({ code: "not_found", message: "remediation module not found in plan" });
      }

      const status = req.body?.status;
      if (status && status !== "open" && status !== "accepted" && status !== "closed") {
        return reply.code(422).send({ code: "validation_error", message: "status must be open | accepted | closed" });
      }

      const key = remediationKey(req.params.id, req.params.moduleId);
      const current = remediationStates.get(key);
      const next: RemediationState = {
        planId: req.params.id,
        moduleId: req.params.moduleId,
        status: status ?? current?.status ?? "open",
        ...(req.body?.notes !== undefined
          ? { notes: req.body.notes }
          : current?.notes !== undefined
            ? { notes: current.notes }
            : {}),
        updatedAt: new Date().toISOString(),
      };
      remediationStates.set(key, next);

      return reply.code(200).send(next);
    },
  );

  app.get(
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
    "/api/v1/secaudit/plans/:id/report/csv",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const plan = store.getById(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: "not_found", message: "secaudit plan not found" });
      }

      const report = buildSecAuditReport(plan);
      const csv = generateSecAuditCSV(report);

      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="audit-${plan.id}.csv"`);
      return reply.code(200).send(csv);
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

  app.post(
    "/api/v1/secaudit/batches",
    async (req: FastifyRequest<{ Body: BatchCreateBody }>, reply: FastifyReply) => {
      await ensurePersistenceHydrated();
      const body = req.body;
      if (
        !body ||
        !isNonEmptyString(body.tenantId) ||
        !isNonEmptyString(body.operatorId) ||
        !isNonEmptyString(body.packageId) ||
        !Array.isArray(body.modules) ||
        !Array.isArray(body.endpointIds) ||
        body.endpointIds.length === 0
      ) {
        return reply.code(422).send({ code: "validation_error", message: "tenantId, operatorId, packageId, modules and endpointIds are required" });
      }

      const planIds: string[] = [];
      for (const endpointId of body.endpointIds) {
        if (!isNonEmptyString(endpointId)) continue;
        const plan = store.create({
          tenantId: body.tenantId,
          endpointId,
          operatorId: body.operatorId,
          packageId: body.packageId,
          targetOs: body.targetOs,
          executionLevel: body.executionLevel,
          modules: body.modules,
        });
        planIds.push(plan.id);
        void runPlan(plan.id);
      }

      const batch: BatchRecord = {
        id: `secaudit_batch_${randomUUID()}`,
        tenantId: body.tenantId,
        operatorId: body.operatorId,
        endpointIds: body.endpointIds,
        planIds,
        createdAt: new Date().toISOString(),
        status: "running",
      };
      batches.set(batch.id, batch);
      await saveBatchToDb(batch);
      return reply.code(201).send(batch);
    },
  );

  app.get(
    "/api/v1/secaudit/batches",
    async (req: FastifyRequest<{ Querystring: TenantQuery }>, reply: FastifyReply) => {
      await ensurePersistenceHydrated();
      const tenantFilter = req.query?.tenantId;
      const source = Array.from(batches.values())
        .filter((item) => !isNonEmptyString(tenantFilter) || item.tenantId === tenantFilter)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const items: Array<ReturnType<typeof summarizeBatch>> = [];
      for (const item of source) {
        const summarized = summarizeBatch(item);
        const updated: BatchRecord = {
          id: summarized.id,
          tenantId: summarized.tenantId,
          operatorId: summarized.operatorId,
          endpointIds: summarized.endpointIds,
          planIds: summarized.planIds,
          createdAt: summarized.createdAt,
          status: summarized.status,
        };
        batches.set(updated.id, updated);
        await saveBatchToDb(updated);
        items.push(summarized);
      }

      return reply.code(200).send({ items, count: items.length });
    },
  );

  app.get(
    "/api/v1/secaudit/batches/:id",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      await ensurePersistenceHydrated();
      const batch = batches.get(req.params.id);
      if (!batch) {
        return reply.code(404).send({ code: "not_found", message: "secaudit batch not found" });
      }

      const summarized = summarizeBatch(batch);
      const updated: BatchRecord = {
        id: summarized.id,
        tenantId: summarized.tenantId,
        operatorId: summarized.operatorId,
        endpointIds: summarized.endpointIds,
        planIds: summarized.planIds,
        createdAt: summarized.createdAt,
        status: summarized.status,
      };
      batches.set(updated.id, updated);
      await saveBatchToDb(updated);

      return reply.code(200).send(summarized);
    },
  );

  app.post(
    "/api/v1/secaudit/batches/:id/cancel",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      await ensurePersistenceHydrated();
      const batch = batches.get(req.params.id);
      if (!batch) {
        return reply.code(404).send({ code: "not_found", message: "secaudit batch not found" });
      }

      for (const planId of batch.planIds) {
        const plan = store.getById(planId);
        if (!plan) continue;

        for (const result of plan.results) {
          if (!result.commandJobId) continue;
          if (result.status !== "running" && result.status !== "pending") continue;
          await app.inject({
            method: "POST",
            url: `/api/v1/commands/jobs/${result.commandJobId}/cancel`,
          });
        }

        store.update(plan.id, (draft) => {
          draft.results = draft.results.map((item) => {
            if (item.status === "completed" || item.status === "failed") {
              return item;
            }
            return {
              ...item,
              status: "failed",
              error: item.error ?? "batch_cancelled",
              updatedAt: new Date().toISOString(),
            };
          });
          draft.status = "failed";
        });
      }

      const next: BatchRecord = { ...batch, status: "cancelled" };
      batches.set(next.id, next);
      await saveBatchToDb(next);
      const summarized = summarizeBatch(next);

      return reply.code(200).send({
        ...summarized,
        cancelled: true,
      });
    },
  );

  app.post(
    "/api/v1/secaudit/schedules",
    async (req: FastifyRequest<{ Body: ScheduleCreateBody }>, reply: FastifyReply) => {
      await ensurePersistenceHydrated();
      const body = req.body;
      if (
        !body ||
        !isNonEmptyString(body.tenantId) ||
        !isNonEmptyString(body.operatorId) ||
        !isNonEmptyString(body.endpointId) ||
        !isNonEmptyString(body.packageId) ||
        !Array.isArray(body.modules) ||
        body.modules.length === 0
      ) {
        return reply.code(422).send({ code: "validation_error", message: "tenantId, operatorId, endpointId, packageId and modules are required" });
      }

      const intervalMinutes = Number(body.intervalMinutes ?? 60);
      if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) {
        return reply.code(422).send({ code: "validation_error", message: "intervalMinutes must be >= 5" });
      }

      const now = Date.now();
      const schedule: ScheduleRecord = {
        id: `secaudit_sched_${randomUUID()}`,
        tenantId: body.tenantId,
        operatorId: body.operatorId,
        endpointId: body.endpointId,
        packageId: body.packageId,
        targetOs: body.targetOs,
        executionLevel: body.executionLevel,
        modules: body.modules,
        intervalMinutes,
        createdAt: new Date(now).toISOString(),
        nextRunAt: new Date(now + intervalMinutes * 60_000).toISOString(),
      };
      schedules.set(schedule.id, schedule);
      await saveScheduleToDb(schedule);
      return reply.code(201).send(schedule);
    },
  );

  app.get(
    "/api/v1/secaudit/schedules",
    async (_req: FastifyRequest, reply: FastifyReply) => {
      await ensurePersistenceHydrated();
      const items = Array.from(schedules.values()).sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
      return reply.code(200).send({ items, count: items.length });
    },
  );

  app.delete(
    "/api/v1/secaudit/schedules/:id",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      await ensurePersistenceHydrated();
      const exists = schedules.has(req.params.id);
      if (!exists) {
        return reply.code(404).send({ code: "not_found", message: "secaudit schedule not found" });
      }
      schedules.delete(req.params.id);
      await deleteScheduleFromDb(req.params.id);
      return reply.code(200).send({ id: req.params.id, deleted: true });
    },
  );

  app.post(
    "/api/v1/secaudit/stress/ethernet-resilience",
    async (req: FastifyRequest<{ Body: EthernetStressBody }>, reply: FastifyReply) => {
      const body = req.body;
      if (!body || !isNonEmptyString(body.tenantId) || !isNonEmptyString(body.operatorId) || !isNonEmptyString(body.endpointId)) {
        return reply.code(422).send({
          code: "validation_error",
          message: "tenantId, operatorId and endpointId are required",
        });
      }

      const report = await stressDiagnostics.runEthernetResilience({
        tenantId: body.tenantId,
        operatorId: body.operatorId,
        endpointId: body.endpointId,
        ...(typeof body.iterations === "number" ? { iterations: body.iterations } : {}),
        ...(typeof body.expectedBandwidthMbps === "number" ? { expectedBandwidthMbps: body.expectedBandwidthMbps } : {}),
        ...(typeof body.saturationThresholdPct === "number" ? { saturationThresholdPct: body.saturationThresholdPct } : {}),
        ...(typeof body.recoveryPolicy === "object" && body.recoveryPolicy ? { recoveryPolicy: body.recoveryPolicy } : {}),
      });

      auditStore.append({
        tenantId: body.tenantId,
        operatorId: body.operatorId,
        endpointId: body.endpointId,
        code: "resilience.exercise.planned",
        details: {
          scope: "secaudit_stress",
          module: "ethernet_resilience",
          reportId: report.id,
          status: report.status,
          closedSafely: report.closedSafely,
          summary: report.summary,
          terminationReason: report.terminationReason,
        },
      });

      return reply.code(201).send(report);
    },
  );

  app.post(
    "/api/v1/secaudit/stress/wireless-density",
    async (req: FastifyRequest<{ Body: WirelessDensityBody }>, reply: FastifyReply) => {
      const body = req.body;
      if (!body || !isNonEmptyString(body.tenantId) || !isNonEmptyString(body.operatorId) || !isNonEmptyString(body.endpointId) || !isNonEmptyString(body.apId)) {
        return reply.code(422).send({
          code: "validation_error",
          message: "tenantId, operatorId, endpointId and apId are required",
        });
      }

      const report = await stressDiagnostics.runWirelessDensity({
        tenantId: body.tenantId,
        operatorId: body.operatorId,
        endpointId: body.endpointId,
        apId: body.apId,
        ...(typeof body.iterations === "number" ? { iterations: body.iterations } : {}),
        ...(typeof body.expectedMaxClients === "number" ? { expectedMaxClients: body.expectedMaxClients } : {}),
        ...(typeof body.associationThresholdPct === "number" ? { associationThresholdPct: body.associationThresholdPct } : {}),
        ...(typeof body.recoveryPolicy === "object" && body.recoveryPolicy ? { recoveryPolicy: body.recoveryPolicy } : {}),
      });

      auditStore.append({
        tenantId: body.tenantId,
        operatorId: body.operatorId,
        endpointId: body.endpointId,
        code: "resilience.exercise.planned",
        details: {
          scope: "secaudit_stress",
          module: "wireless_density",
          apId: body.apId,
          reportId: report.id,
          status: report.status,
          closedSafely: report.closedSafely,
          summary: report.summary,
          terminationReason: report.terminationReason,
        },
      });

      return reply.code(201).send(report);
    },
  );

  app.get(
    "/api/v1/secaudit/stress/reports",
    async (req: FastifyRequest<{ Querystring: StressReportQuery }>, reply: FastifyReply) => {
      const items = stressStore.listReports({
        ...(isNonEmptyString(req.query.tenantId) ? { tenantId: req.query.tenantId } : {}),
        ...(req.query.module === "ethernet_resilience" || req.query.module === "wireless_density"
          ? { module: req.query.module }
          : {}),
      });
      return reply.code(200).send({ items, count: items.length });
    },
  );

  app.get(
    "/api/v1/secaudit/stress/reports/:id",
    async (req: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
      const report = stressStore.getById(req.params.id);
      if (!report) {
        return reply.code(404).send({ code: "not_found", message: "stress report not found" });
      }
      return reply.code(200).send(report);
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
