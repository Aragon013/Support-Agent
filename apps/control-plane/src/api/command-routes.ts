import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { cpus, hostname, platform, release, totalmem } from "node:os";

import { findCatalogCommand, COMMAND_CATALOG } from "../domain/command-catalog.js";
import { validateCommandParams } from "../domain/command-param-schema.js";
import {
  assertTransition,
  type CommandJobStatus,
} from "../domain/command-job.js";
import {
  InMemoryCommandJobStore,
  type CommandJobRecord,
} from "../domain/command-job-store.js";
import {
  DEFAULT_COMMAND_POLICY,
  evaluateCommandPolicy,
  type EndpointInstallProfile,
  type EndpointLicenseStatus,
  type OperatorRole,
} from "../domain/command-policy.js";
import { InMemoryMfaStepupStore } from "../domain/mfa-stepup.js";
import { InMemoryCommandEventBus } from "../domain/command-event-bus.js";
import {
  InMemoryAuditLogStore,
  type AuditEventCode,
} from "../domain/audit-log-store.js";
import {
  CommandEventsWsHub,
  registerCommandEventsWsRoute,
} from "./command-events-ws.js";

type CreateJobBody = {
  tenantId: string;
  endpointId: string;
  operatorId: string;
  catalogCommandId: string;
  requestedParams?: Record<string, unknown>;
};

type IdParams = {
  id: string;
};

type CreateMfaChallengeBody = {
  tenantId: string;
  operatorId: string;
};

type VerifyMfaChallengeBody = {
  tenantId: string;
  operatorId: string;
  otp: string;
};

type AuditQuery = {
  tenantId?: string;
  operatorId?: string;
};

type PurgeBody = {
  retentionDays?: number;
  tenantId?: string;        // Purga solo ese tenant si se especifica
};

type RunJobBody = {
  outcome?: "completed" | "failed";
  failReason?: string;
};

type ReportJobBody = {
  status?: "completed" | "failed" | "cancelled";
  failReason?: string;
  output?: {
    stdout?: string[];
    stderr?: string[];
    exitCode?: number;
  };
  digestSha256?: string;
  outputBytes?: number;
  truncated?: boolean;
};

const RETENTION_DAYS_DEFAULT = 90;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRESERVE_AUDIT_CODES = [
  "command.job.blocked",
  "command.job.cancelled",
  "command.mfa.challenge.failed",
] as const;
const PRESERVE_ENVELOPE_KINDS = ["command.abort", "command.exit"] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseOperatorRole(value: unknown): OperatorRole {
  if (value === "viewer" || value === "tech" || value === "admin") {
    return value;
  }
  return "tech";
}

function parseEndpointLicenseStatus(value: unknown): EndpointLicenseStatus {
  return value === "inactive" ? "inactive" : "active";
}

function parseEndpointInstallProfile(value: unknown): EndpointInstallProfile {
  if (
    value === "remote_only" ||
    value === "support_limited_no_folders" ||
    value === "support_full"
  ) {
    return value;
  }

  return "support_full";
}

function parseActiveCommandCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function parseMfaVerified(value: unknown): boolean {
  return value === "true";
}

function shouldRunLocal(req: FastifyRequest): boolean {
  return req.headers["x-command-local-runner"] === "true" || process.env.COMMAND_LOCAL_RUNNER === "true";
}

function renderLocalOutput(commandId: string, params: Record<string, unknown>): { exitCode: number; stdout: string[]; stderr: string[] } {
  switch (commandId) {
    case "diagnostic.system.info":
      return {
        exitCode: 0,
        stdout: [
          `host=${hostname()}`,
          `platform=${platform()}`,
          `release=${release()}`,
          `cpus=${cpus().length}`,
          `ram_mb=${Math.round(totalmem() / (1024 * 1024))}`,
          `forensic=${Boolean(params.forensic)}`,
          `ransomware=${Boolean(params.ransomware)}`,
        ],
        stderr: [],
      };
    case "security.firewall.status":
      return {
        exitCode: 0,
        stdout: [`profile=${String(params.profile ?? "all")}`, "firewall=enabled"],
        stderr: [],
      };
    case "diagnostic.process.enum":
      return {
        exitCode: 0,
        stdout: [`deep=${Boolean(params.deep)}`, "signals=process-tree,network-edges,persistence"],
        stderr: [],
      };
    case "security.audit-logging.status":
      return {
        exitCode: 0,
        stdout: [`framework=${String(params.framework ?? "generic")}`, "audit_logging=enabled"],
        stderr: [],
      };
    case "security.secret-scanning.status":
      return {
        exitCode: 0,
        stdout: [`scope=${String(params.scope ?? "all")}`, "secret_scan=completed"],
        stderr: [],
      };
    case "security.remote-access.status":
      return {
        exitCode: 0,
        stdout: [`mode=${String(params.mode ?? "all")}`, "remote_surface=reviewed"],
        stderr: [],
      };
    case "diagnostic.cloud.config":
      return {
        exitCode: 0,
        stdout: [`provider=${String(params.provider ?? "all")}`, "cloud_posture=baseline_collected"],
        stderr: [],
      };
    default:
      return {
        exitCode: 0,
        stdout: [`command=${commandId}`, "status=ok"],
        stderr: [],
      };
  }
}

function lifecycleAuditCode(status: CommandJobStatus): AuditEventCode {
  switch (status) {
    case "policy_check":
      return "command.job.policy_check";
    case "mfa_pending":
      return "command.job.mfa_pending";
    case "queued":
      return "command.job.queued";
    case "dispatched":
      return "command.job.dispatched";
    case "running":
      return "command.job.running";
    case "streaming":
      return "command.job.streaming";
    case "verifying":
      return "command.job.verifying";
    case "completed":
      return "command.job.completed";
    case "failed":
      return "command.job.failed";
    case "blocked":
      return "command.job.blocked";
    case "cancelled":
      return "command.job.cancelled";
    case "created":
      return "command.job.created";
    default:
      return "command.job.created";
  }
}

type PreHandlerFn = (req: FastifyRequest, reply: FastifyReply, done: () => void) => void;

export function registerCommandRoutes(app: FastifyInstance): void {
  registerCommandRoutesWithDeps(app, {});
}

export function registerCommandRoutesWithDeps(
  app: FastifyInstance,
  deps: {
    auditStore?: InMemoryAuditLogStore;
    requireAdminKey?: PreHandlerFn;
  },
): void {
  const store = new InMemoryCommandJobStore();
  const mfaStore = new InMemoryMfaStepupStore();
  const eventBus = new InMemoryCommandEventBus();
  const auditStore = deps.auditStore ?? new InMemoryAuditLogStore(RETENTION_DAYS_DEFAULT);
  const requireAdminKey = deps.requireAdminKey ?? ((_req, _reply, done) => done());
  const wsHub = new CommandEventsWsHub();
  const detachWs = wsHub.attach(eventBus);

  registerCommandEventsWsRoute(app, wsHub);

  const runRetentionPurge = (retentionDays = RETENTION_DAYS_DEFAULT, tenantId?: string) => {
    const auditReport = auditStore.purgeWithPolicy({
      retentionDays,
      preserveCodes: [...PRESERVE_AUDIT_CODES],
      ...(tenantId ? { tenantId } : {}),
    });
    const eventReport = eventBus.purgeWithPolicy({
      retentionDays,
      preserveEnvelopeKinds: [...PRESERVE_ENVELOPE_KINDS],
      ...(tenantId ? { tenantId } : {}),
    });

    const mergedByTenant: Record<string, number> = { ...auditReport.byTenant };
    for (const [tenantId, count] of Object.entries(eventReport.byTenant)) {
      mergedByTenant[tenantId] = (mergedByTenant[tenantId] ?? 0) + count;
    }

    return {
      runAt: new Date().toISOString(),
      retentionDays,
      audit: auditReport,
      eventPipeline: eventReport,
      byTenant: mergedByTenant,
      totalPurged:
        auditReport.purged + eventReport.jobEventsPurged + eventReport.envelopesPurged,
    };
  };

  const emitLifecycle = (
    record: CommandJobRecord,
    reason?: string,
    extraDetails?: Record<string, unknown>,
  ) => {
    eventBus.emitTransition(record, reason ? { reason } : undefined);
    auditStore.append({
      tenantId: record.tenantId,
      endpointId: record.endpointId,
      operatorId: record.operatorId,
      jobId: record.id,
      code: lifecycleAuditCode(record.status),
      details: {
        commandId: record.catalogCommandId,
        commandVersion: record.commandVersion,
        riskLevel: record.riskLevel,
        requiresMfa: record.requiresMfa,
        reason,
        requestedParams: record.requestedParams,
        ...extraDetails,
      },
    });
  };

  const runLocalCommand = async (record: CommandJobRecord) => {
    const transitions: CommandJobStatus[] = ["dispatched", "running", "streaming", "verifying"];
    let current = record;

    for (const status of transitions) {
      const transition = assertTransition(current.status, status);
      if (!transition.ok) {
        return;
      }
      const updated = store.updateStatus(current.id, status);
      if (!updated) {
        return;
      }
      current = updated;
      emitLifecycle(current);
    }

    const output = renderLocalOutput(current.catalogCommandId, current.requestedParams);
    for (const line of output.stdout) {
      eventBus.emitStdout(current, line);
    }
    for (const line of output.stderr) {
      eventBus.emitStderr(current, line);
    }
    eventBus.emitExit(current, output.exitCode);

    const finalStatus: CommandJobStatus = output.exitCode === 0 ? "completed" : "failed";
    const transition = assertTransition(current.status, finalStatus);
    if (!transition.ok) {
      return;
    }
    const final = store.updateStatus(current.id, finalStatus);
    if (!final) {
      return;
    }
    emitLifecycle(final, finalStatus === "failed" ? "local_runner_failed" : undefined, {
      localRunner: true,
      exitCode: output.exitCode,
    });
  };

  const timer = setInterval(() => {
    const report = runRetentionPurge(RETENTION_DAYS_DEFAULT);
    app.log.info(
      {
        retentionDays: RETENTION_DAYS_DEFAULT,
        totalPurged: report.totalPurged,
        byTenant: report.byTenant,
      },
      "daily retention purge completed",
    );
  }, RETENTION_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", async () => {
    clearInterval(timer);
    detachWs();
  });

  app.post(
    "/api/v1/mfa/challenges",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (
      req: FastifyRequest<{ Body: CreateMfaChallengeBody }>,
      reply: FastifyReply,
    ) => {
      const body = req.body;
      if (
        !body ||
        !isNonEmptyString(body.tenantId) ||
        !isNonEmptyString(body.operatorId)
      ) {
        return reply.code(422).send({
          code: "validation_error",
          message: "tenantId and operatorId are required",
        });
      }

      const challenge = mfaStore.issueChallenge(body.tenantId, body.operatorId);
      auditStore.append({
        tenantId: body.tenantId,
        operatorId: body.operatorId,
        code: "command.mfa.challenge.issued",
        details: {
          challengeId: challenge.id,
        },
      });

      return reply.code(201).send({
        challengeId: challenge.id,
        expiresAt: new Date(challenge.expiresAtMs).toISOString(),
      });
    },
  );

  // Rate limit estricto para prevenir brute-force de OTP (OWASP API4)
  app.post(
    "/api/v1/mfa/challenges/:id/verify",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes", keyGenerator: (req) => (req.body as { operatorId?: string } | undefined)?.operatorId ?? req.ip } } },
    async (
      req: FastifyRequest<{ Params: IdParams; Body: VerifyMfaChallengeBody }>,
      reply: FastifyReply,
    ) => {
      const body = req.body;
      if (
        !body ||
        !isNonEmptyString(body.tenantId) ||
        !isNonEmptyString(body.operatorId) ||
        !isNonEmptyString(body.otp)
      ) {
        return reply.code(422).send({
          code: "validation_error",
          message: "tenantId, operatorId and otp are required",
        });
      }

      const result = mfaStore.verifyChallenge(
        req.params.id,
        body.tenantId,
        body.operatorId,
        body.otp,
      );

      if (!result.ok) {
        auditStore.append({
          tenantId: body.tenantId,
          operatorId: body.operatorId,
          code: "command.mfa.challenge.failed",
          details: {
            challengeId: req.params.id,
            reason: result.reason,
            otp: body.otp,
          },
        });

        return reply.code(403).send({
          code: "mfa_verify_failed",
          reason: result.reason,
        });
      }

      auditStore.append({
        tenantId: body.tenantId,
        operatorId: body.operatorId,
        code: "command.mfa.challenge.verified",
        details: {
          challengeId: req.params.id,
          mfaToken: result.token,
        },
      });

      return {
        mfaToken: result.token,
        expiresAt: result.expiresAt,
      };
    },
  );

  app.get("/api/v1/commands/catalog", async () => {
    return { items: COMMAND_CATALOG };
  });

  app.get(
    "/api/v1/audit",
    async (
      req: FastifyRequest<{ Querystring: AuditQuery }>,
      reply: FastifyReply,
    ) => {
      const { tenantId, operatorId } = req.query;
      if (!isNonEmptyString(tenantId)) {
        return reply.code(422).send({
          code: "validation_error",
          message: "tenantId is required",
        });
      }

      return {
        retentionDays: 90,
        items: auditStore.find(
          isNonEmptyString(operatorId)
            ? { tenantId, operatorId }
            : { tenantId },
        ),
      };
    },
  );

  app.post<{ Body: PurgeBody }>(
    "/api/v1/internal/retention/purge",
    { preHandler: requireAdminKey },
    async (req, reply) => {
      const body = req.body;
      const tenantId = isNonEmptyString(body?.tenantId) ? body.tenantId : undefined;
      const requestedDays = body?.retentionDays;
      const retentionDays =
        typeof requestedDays === "number" &&
        Number.isFinite(requestedDays) &&
        requestedDays >= 0
          ? Math.floor(requestedDays)
          : tenantId
            ? auditStore.getRetentionDaysForTenant(tenantId)
            : RETENTION_DAYS_DEFAULT;

      if (
        requestedDays !== undefined &&
        (!Number.isFinite(requestedDays) || requestedDays < 0)
      ) {
        return reply.code(422).send({
          code: "validation_error",
          message: "retentionDays must be a number >= 0",
        });
      }

      const report = runRetentionPurge(retentionDays, tenantId);
      return {
        policy: {
          retentionDays,
          tenantId: tenantId ?? "all",
          preserveAuditCodes: [...PRESERVE_AUDIT_CODES],
          preserveEnvelopeKinds: [...PRESERVE_ENVELOPE_KINDS],
        },
        report,
      };
    },
  );

  app.post(
    "/api/v1/commands/jobs",
    async (
      req: FastifyRequest<{ Body: CreateJobBody }>,
      reply: FastifyReply,
    ) => {
      const body = req.body;
      if (
        !body ||
        !isNonEmptyString(body.tenantId) ||
        !isNonEmptyString(body.endpointId) ||
        !isNonEmptyString(body.operatorId) ||
        !isNonEmptyString(body.catalogCommandId)
      ) {
        return reply.code(422).send({
          code: "validation_error",
          message: "tenantId, endpointId, operatorId and catalogCommandId are required",
        });
      }

      const command = findCatalogCommand(body.catalogCommandId);
      if (!command) {
        return reply.code(422).send({
          code: "unknown_command",
          message: "catalogCommandId is not in the command catalog",
        });
      }

      const requestedParams = body.requestedParams ?? {};
      const paramValidation = validateCommandParams(
        command.paramsSchema,
        requestedParams,
      );
      if (!paramValidation.ok) {
        return reply.code(422).send({
          code: "invalid_command_params",
          errors: paramValidation.errors,
        });
      }

      const policyDecision = evaluateCommandPolicy(DEFAULT_COMMAND_POLICY, {
        commandId: command.id,
        riskLevel: command.riskLevel,
        operatorRole: parseOperatorRole(req.headers["x-operator-role"]),
        endpointLicenseStatus: parseEndpointLicenseStatus(
          req.headers["x-endpoint-license-status"],
        ),
        endpointInstallProfile: parseEndpointInstallProfile(
          req.headers["x-endpoint-install-profile"],
        ),
        activeCommandCountForEndpoint: parseActiveCommandCount(
          req.headers["x-active-commands"],
        ),
        mfaVerified:
          (typeof req.headers["x-mfa-token"] === "string" &&
            mfaStore.validateToken(
              req.headers["x-mfa-token"],
              body.tenantId,
              body.operatorId,
            )) || parseMfaVerified(req.headers["x-mfa-verified"]),
      });

      let initialStatus: CommandJobStatus = "created";
      const policyTransition = assertTransition(initialStatus, "policy_check");
      if (policyTransition.ok) {
        initialStatus = "policy_check";
      }

      if (policyDecision.decision === "deny") {
        const blockedTransition = assertTransition(initialStatus, "blocked");
        if (blockedTransition.ok) {
          initialStatus = "blocked";
        }

        const blocked = store.create({
          tenantId: body.tenantId,
          endpointId: body.endpointId,
          operatorId: body.operatorId,
          catalogCommandId: command.id,
          commandVersion: command.version,
          requestedParams,
          riskLevel: command.riskLevel,
          requiresMfa: false,
          status: initialStatus,
        });

        emitLifecycle(blocked, policyDecision.reason);
        eventBus.emitAbort(blocked, policyDecision.reason);

        return reply.code(403).send({
          code: "policy_denied",
          reason: policyDecision.reason,
          id: blocked.id,
          status: blocked.status,
        });
      }

      if (policyDecision.decision === "stepup") {
        const mfaTransition = assertTransition(initialStatus, "mfa_pending");
        if (mfaTransition.ok) {
          initialStatus = "mfa_pending";
        }

        const mfaPending = store.create({
          tenantId: body.tenantId,
          endpointId: body.endpointId,
          operatorId: body.operatorId,
          catalogCommandId: command.id,
          commandVersion: command.version,
          requestedParams,
          riskLevel: command.riskLevel,
          requiresMfa: true,
          status: initialStatus,
        });

        emitLifecycle(mfaPending, policyDecision.reason);

        return reply.code(202).send({
          id: mfaPending.id,
          status: mfaPending.status,
          requiresMfa: mfaPending.requiresMfa,
          reason: policyDecision.reason,
          mfaRequired: true,
        });
      }

      const queuedTransition = assertTransition(initialStatus, "queued");
      if (queuedTransition.ok) {
        initialStatus = "queued";
      }

      const created = store.create({
        tenantId: body.tenantId,
        endpointId: body.endpointId,
        operatorId: body.operatorId,
        catalogCommandId: command.id,
        commandVersion: command.version,
        requestedParams,
        riskLevel: command.riskLevel,
        requiresMfa: false,
        status: initialStatus,
      });

      emitLifecycle(created);
      eventBus.emitCommandInit(created);

      if (shouldRunLocal(req)) {
        void runLocalCommand(created);
      }

      return reply.code(201).send({
        id: created.id,
        status: created.status,
        requiresMfa: created.requiresMfa,
        riskLevel: created.riskLevel,
      });
    },
  );

  app.get(
    "/api/v1/commands/jobs/:id",
    async (
      req: FastifyRequest<{ Params: IdParams }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "command job not found",
        });
      }
      return found;
    },
  );

  app.post(
    "/api/v1/commands/jobs/:id/cancel",
    async (
      req: FastifyRequest<{ Params: IdParams }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "command job not found",
        });
      }

      const transition = assertTransition(found.status, "cancelled");
      if (!transition.ok) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: `cannot transition from ${found.status} to cancelled`,
        });
      }

      const updated = store.updateStatus(found.id, "cancelled")!;
      eventBus.emitTransition(updated);
      eventBus.emitAbort(updated, "cancelled_by_operator");
      auditStore.append({
        tenantId: updated.tenantId,
        endpointId: updated.endpointId,
        operatorId: updated.operatorId,
        jobId: updated.id,
        code: "command.job.cancelled",
        details: {
          commandId: updated.catalogCommandId,
          commandVersion: updated.commandVersion,
          requestedParams: updated.requestedParams,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
      };
    },
  );

  app.post(
    "/api/v1/commands/jobs/:id/retry",
    async (
      req: FastifyRequest<{ Params: IdParams }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "command job not found",
        });
      }

      if (found.status !== "failed" && found.status !== "cancelled") {
        return reply.code(409).send({
          code: "retry_not_allowed",
          message: "retry is only allowed from failed or cancelled",
        });
      }

      const updated = store.updateStatus(found.id, "queued")!;
      eventBus.emitRetry(updated);
      eventBus.emitTransition(updated);
      eventBus.emitCommandInit(updated);
      auditStore.append({
        tenantId: updated.tenantId,
        endpointId: updated.endpointId,
        operatorId: updated.operatorId,
        jobId: updated.id,
        code: "command.job.retry",
        details: {
          fromStatus: found.status,
          toStatus: updated.status,
        },
      });
      auditStore.append({
        tenantId: updated.tenantId,
        endpointId: updated.endpointId,
        operatorId: updated.operatorId,
        jobId: updated.id,
        code: "command.job.queued",
        details: {
          commandId: updated.catalogCommandId,
          commandVersion: updated.commandVersion,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
      };
    },
  );

  app.post(
    "/api/v1/internal/commands/jobs/:id/report",
    async (
      req: FastifyRequest<{ Params: IdParams; Body: ReportJobBody }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "command job not found",
        });
      }

      if (found.status !== "queued") {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "run report is only allowed from queued",
        });
      }

      const requestedStatus = req.body?.status;
      if (
        requestedStatus !== "completed" &&
        requestedStatus !== "failed" &&
        requestedStatus !== "cancelled"
      ) {
        return reply.code(422).send({
          code: "validation_error",
          message: "status must be one of completed | failed | cancelled",
        });
      }

      const failReason =
        isNonEmptyString(req.body?.failReason) ? req.body.failReason : "runner_error";

      const stdout = Array.isArray(req.body?.output?.stdout)
        ? req.body.output.stdout.filter((x): x is string => typeof x === "string")
        : [];
      const stderr = Array.isArray(req.body?.output?.stderr)
        ? req.body.output.stderr.filter((x): x is string => typeof x === "string")
        : [];
      const exitCode =
        typeof req.body?.output?.exitCode === "number" && Number.isFinite(req.body.output.exitCode)
          ? Math.trunc(req.body.output.exitCode)
          : requestedStatus === "completed"
            ? 0
            : 1;

      let current = found;
      const advance = (
        target: CommandJobStatus,
        reason?: string,
        extraDetails?: Record<string, unknown>,
      ) => {
        const transition = assertTransition(current.status, target);
        if (!transition.ok) {
          return undefined;
        }

        const updated = store.updateStatus(current.id, target);
        if (!updated) {
          return undefined;
        }

        current = updated;
        emitLifecycle(updated, reason, extraDetails);
        return updated;
      };

      if (!advance("dispatched", undefined, { progressPercent: 0 })) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "cannot dispatch command job",
        });
      }

      if (!advance("running", undefined, { progressPercent: 10 })) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "cannot mark command job as running",
        });
      }

      const hasChunks = stdout.length > 0 || stderr.length > 0;
      if (hasChunks) {
        if (!advance("streaming", undefined, { progressPercent: 60 })) {
          return reply.code(409).send({
            code: "invalid_state_transition",
            message: "cannot mark command job as streaming",
          });
        }

        for (const chunk of stdout) {
          eventBus.emitStdout(current, chunk);
        }
        for (const chunk of stderr) {
          eventBus.emitStderr(current, chunk);
        }
      }

      const meta = {
        progressPercent: 100,
        digestSha256: req.body?.digestSha256,
        outputBytes: req.body?.outputBytes,
        truncated: req.body?.truncated,
      };

      if (requestedStatus === "cancelled") {
        if (!advance("cancelled", failReason, meta)) {
          return reply.code(409).send({
            code: "invalid_state_transition",
            message: "cannot cancel command job",
          });
        }

        eventBus.emitExit(current, exitCode);
        eventBus.emitAbort(current, failReason);

        return {
          id: current.id,
          status: current.status,
          outcome: requestedStatus,
          exitCode,
        };
      }

      if (requestedStatus === "failed") {
        if (!advance("failed", failReason, meta)) {
          return reply.code(409).send({
            code: "invalid_state_transition",
            message: "cannot fail command job",
          });
        }

        eventBus.emitExit(current, exitCode);
        eventBus.emitAbort(current, failReason);

        return {
          id: current.id,
          status: current.status,
          outcome: requestedStatus,
          exitCode,
        };
      }

      if (!advance("verifying", undefined, {
        progressPercent: 90,
        digestSha256: req.body?.digestSha256,
        outputBytes: req.body?.outputBytes,
        truncated: req.body?.truncated,
      })) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "cannot mark command job as verifying",
        });
      }

      if (!advance("completed", undefined, meta)) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "cannot complete command job",
        });
      }

      eventBus.emitExit(current, exitCode);

      return {
        id: current.id,
        status: current.status,
        outcome: requestedStatus,
        exitCode,
      };
    },
  );

  app.post(
    "/api/v1/internal/commands/jobs/:id/run",
    async (
      req: FastifyRequest<{ Params: IdParams; Body: RunJobBody }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "command job not found",
        });
      }

      if (found.status !== "queued") {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "run simulation is only allowed from queued",
        });
      }

      const outcome = req.body?.outcome === "failed" ? "failed" : "completed";
      const failReason =
        isNonEmptyString(req.body?.failReason) ? req.body.failReason : "runner_error";

      let current = found;

      const advance = (
        target: CommandJobStatus,
        reason?: string,
        extraDetails?: Record<string, unknown>,
      ) => {
        const transition = assertTransition(current.status, target);
        if (!transition.ok) {
          return undefined;
        }

        const updated = store.updateStatus(current.id, target);
        if (!updated) {
          return undefined;
        }

        current = updated;
        emitLifecycle(updated, reason, extraDetails);
        return updated;
      };

      if (!advance("dispatched", undefined, { progressPercent: 0 })) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "cannot dispatch command job",
        });
      }

      if (!advance("running", undefined, { progressPercent: 10 })) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "cannot mark command job as running",
        });
      }

      eventBus.emitStdout(current, "runner: started");

      if (!advance("streaming", undefined, { progressPercent: 60 })) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "cannot mark command job as streaming",
        });
      }

      if (outcome === "failed") {
        eventBus.emitStderr(current, `runner failed: ${failReason}`);

        if (!advance("failed", failReason, { progressPercent: 100 })) {
          return reply.code(409).send({
            code: "invalid_state_transition",
            message: "cannot fail command job",
          });
        }

        eventBus.emitExit(current, 1);
        eventBus.emitAbort(current, failReason);

        return {
          id: current.id,
          status: current.status,
          outcome,
          exitCode: 1,
        };
      }

      eventBus.emitStdout(current, "runner: processing complete");

      if (!advance("verifying", undefined, { progressPercent: 90 })) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "cannot mark command job as verifying",
        });
      }

      if (!advance("completed", undefined, { progressPercent: 100 })) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "cannot complete command job",
        });
      }

      eventBus.emitExit(current, 0);

      return {
        id: current.id,
        status: current.status,
        outcome,
        exitCode: 0,
      };
    },
  );

  app.get(
    "/api/v1/commands/jobs/:id/events",
    async (
      req: FastifyRequest<{ Params: IdParams }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "command job not found",
        });
      }

      return {
        items: eventBus.getEvents(found.id),
      };
    },
  );

  app.get(
    "/api/v1/commands/jobs/:id/channel-messages",
    async (
      req: FastifyRequest<{ Params: IdParams }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "command job not found",
        });
      }

      return {
        items: eventBus.getEnvelopes(found.id),
      };
    },
  );

  app.get(
    "/api/v1/commands/jobs/:id/audit",
    async (
      req: FastifyRequest<{ Params: IdParams }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "command job not found",
        });
      }

      return {
        retentionDays: 90,
        items: auditStore.getByJobId(found.id),
      };
    },
  );
}
