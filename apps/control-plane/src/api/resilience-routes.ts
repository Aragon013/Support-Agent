import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { InMemoryAuditLogStore } from "../domain/audit-log-store.js";
import {
  InMemoryResilienceExerciseStore,
  type ResilienceScopeKind,
} from "../domain/resilience-exercise-store.js";

type PreHandlerFn = (req: FastifyRequest, reply: FastifyReply, done: () => void) => void;

type CreateScopeBody = {
  label: string;
  kind: ResilienceScopeKind;
  targetRef: string;
  authorizedBy: string;
  expiresAt: string;
  notes?: string;
  limits: {
    maxRps: number;
    maxConcurrency: number;
    maxDurationMinutes: number;
  };
};

type CreateExerciseBody = {
  scopeId: string;
  profileId: string;
  tenantId: string;
  operatorId: string;
  ticketRef: string;
  rationale: string;
  disclaimerAccepted: boolean;
  mode: "dry-run";
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isScopeKind(value: unknown): value is ResilienceScopeKind {
  return value === "wireless" || value === "perimeter" || value === "service";
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function registerResilienceRoutes(app: FastifyInstance): void {
  registerResilienceRoutesWithDeps(app, {});
}

export function registerResilienceRoutesWithDeps(
  app: FastifyInstance,
  deps: {
    store?: InMemoryResilienceExerciseStore;
    auditStore?: InMemoryAuditLogStore;
    requireAdminKey?: PreHandlerFn;
  },
): void {
  const store = deps.store ?? new InMemoryResilienceExerciseStore();
  const auditStore = deps.auditStore ?? new InMemoryAuditLogStore();
  const requireAdminKey = deps.requireAdminKey ?? ((_req, _reply, done) => done());

  app.get("/api/v1/resilience/scopes", { preHandler: requireAdminKey }, async (_req, reply) => {
    const items = store.listScopes();
    return reply.code(200).send({ items, count: items.length });
  });

  app.post<{ Body: CreateScopeBody }>("/api/v1/resilience/scopes", { preHandler: requireAdminKey }, async (req, reply) => {
    const body = req.body;
    if (!body || !isNonEmptyString(body.label) || !isScopeKind(body.kind) || !isNonEmptyString(body.targetRef) || !isNonEmptyString(body.authorizedBy) || !isNonEmptyString(body.expiresAt)) {
      return reply.code(422).send({ code: "validation_error", message: "label, kind, targetRef, authorizedBy and expiresAt are required" });
    }

    if (!body.limits || !isPositiveNumber(body.limits.maxRps) || !isPositiveNumber(body.limits.maxConcurrency) || !isPositiveNumber(body.limits.maxDurationMinutes)) {
      return reply.code(422).send({ code: "validation_error", message: "limits.maxRps, limits.maxConcurrency and limits.maxDurationMinutes must be > 0" });
    }

    const created = store.createScope({
      label: body.label,
      kind: body.kind,
      targetRef: body.targetRef,
      authorizedBy: body.authorizedBy,
      expiresAt: new Date(body.expiresAt).toISOString(),
      ...(isNonEmptyString(body.notes) ? { notes: body.notes } : {}),
      limits: {
        maxRps: Math.floor(body.limits.maxRps),
        maxConcurrency: Math.floor(body.limits.maxConcurrency),
        maxDurationMinutes: Math.floor(body.limits.maxDurationMinutes),
      },
    });

    auditStore.append({
      tenantId: "system",
      operatorId: "system",
      code: "resilience.scope.created",
      details: {
        scopeId: created.id,
        kind: created.kind,
        targetRef: created.targetRef,
      },
    });

    return reply.code(201).send(created);
  });

  app.get("/api/v1/resilience/profiles", { preHandler: requireAdminKey }, async (_req, reply) => {
    const items = store.listProfiles();
    return reply.code(200).send({ items, count: items.length });
  });

  app.get("/api/v1/resilience/exercises", { preHandler: requireAdminKey }, async (_req, reply) => {
    const items = store.listExercises();
    return reply.code(200).send({ items, count: items.length });
  });

  app.post<{ Body: CreateExerciseBody }>("/api/v1/resilience/exercises", { preHandler: requireAdminKey }, async (req, reply) => {
    const body = req.body;
    if (
      !body ||
      !isNonEmptyString(body.scopeId) ||
      !isNonEmptyString(body.profileId) ||
      !isNonEmptyString(body.tenantId) ||
      !isNonEmptyString(body.operatorId) ||
      !isNonEmptyString(body.ticketRef) ||
      !isNonEmptyString(body.rationale)
    ) {
      return reply.code(422).send({ code: "validation_error", message: "scopeId, profileId, tenantId, operatorId, ticketRef and rationale are required" });
    }

    if (body.disclaimerAccepted !== true) {
      return reply.code(422).send({ code: "validation_error", message: "disclaimerAccepted must be true" });
    }

    if (body.mode !== "dry-run") {
      return reply.code(422).send({ code: "validation_error", message: "only dry-run mode is supported" });
    }

    const scope = store.getScopeById(body.scopeId);
    const profile = store.getProfileById(body.profileId);
    if (!scope || !profile) {
      return reply.code(404).send({ code: "not_found", message: "scope or profile not found" });
    }

    const targetRps = Math.max(1, Math.floor(scope.limits.maxRps * profile.utilizationFactor));
    const burstRps = Math.max(targetRps, Math.floor(targetRps * profile.burstMultiplier));
    const concurrency = Math.max(1, Math.floor(scope.limits.maxConcurrency * profile.utilizationFactor));
    const durationMinutes = Math.min(scope.limits.maxDurationMinutes, profile.recommendedDurationMinutes);

    const planned = store.addExercise({
      scopeId: scope.id,
      profileId: profile.id,
      tenantId: body.tenantId,
      operatorId: body.operatorId,
      ticketRef: body.ticketRef,
      rationale: body.rationale,
      mode: "dry-run",
      status: "planned",
      disclaimerAcceptedAt: new Date().toISOString(),
      plan: {
        targetRps,
        burstRps,
        concurrency,
        durationMinutes,
        targetRef: scope.targetRef,
        kind: scope.kind,
      },
    });

    auditStore.append({
      tenantId: body.tenantId,
      operatorId: body.operatorId,
      code: "resilience.exercise.planned",
      details: {
        exerciseId: planned.id,
        scopeId: scope.id,
        profileId: profile.id,
        targetRef: scope.targetRef,
        mode: planned.mode,
        plan: planned.plan,
      },
    });

    return reply.code(201).send({
      ...planned,
      profile,
      scope,
      disclaimer: "Dry-run only. No network traffic or disruptive activity is generated by this module.",
    });
  });
}
