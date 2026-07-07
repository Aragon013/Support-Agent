import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  InMemorySessionStore,
  type SessionRecord,
} from "../domain/session-store.js";
import {
  type SessionAccessMode,
  type SessionApprovalMode,
  type SessionCapability,
  type SessionStatus,
} from "../domain/session.js";
import { InMemorySessionEventBus } from "../domain/session-event-bus.js";
import { InMemoryAuditLogStore } from "../domain/audit-log-store.js";
import {
  registerSessionEventsWsRoute,
  SessionEventsWsHub,
} from "./session-events-ws.js";
import {
  InMemorySessionSignalStore,
  SIGNAL_MESSAGE_TYPES,
  type SessionSignalMessageType,
  type SessionSignalSenderType,
} from "../domain/session-signal-store.js";
import {
  registerSessionSignalWsRoute,
  SessionSignalWsHub,
} from "./session-signal-ws.js";
import {
  InMemoryEndpointRegistry,
  type EndpointInstallProfile,
} from "../domain/endpoint-registry.js";

type CreateSessionBody = {
  tenantId: string;
  endpointId: string;
  operatorId: string;
  accessMode?: SessionAccessMode;
  requestedCapabilities?: SessionCapability[];
};

type IdParams = {
  id: string;
};

type EndpointPolicyParams = {
  id: string;
};

type DenySessionBody = {
  reason?: string;
};

type InternalStateBody = {
  status?: SessionStatus;
  routeMode?: "direct" | "relay";
};

type SignalParams = {
  id: string;
};

type SignalQuery = {
  afterSeq?: string;
};

type SignalBody = {
  senderType?: SessionSignalSenderType;
  messageType?: SessionSignalMessageType;
  payload?: Record<string, unknown>;
};

function isSignalDirectionAllowed(
  senderType: SessionSignalSenderType,
  messageType: SessionSignalMessageType,
): boolean {
  if (senderType === "controller") {
    return (
      messageType === "signal.offer" ||
      messageType === "signal.ice-candidate" ||
      messageType === "control.input" ||
      messageType === "clipboard.sync" ||
      messageType === "screen.frame.feedback"
    );
  }

  return (
    messageType === "signal.answer" ||
    messageType === "signal.ice-candidate" ||
    messageType === "clipboard.sync" ||
    messageType === "screen.frame.stub" ||
    messageType === "screen.frame.data" ||
    messageType === "control.input"
  );
}

function isSignalStateAllowed(
  status: SessionStatus,
  messageType: SessionSignalMessageType,
): boolean {
  if (messageType === "control.input") {
    return (
      status === "connected_p2p" ||
      status === "connected_relay" ||
      status === "reconnecting"
    );
  }

  if (messageType === "clipboard.sync") {
    return (
      status === "signaling" ||
      status === "connecting_p2p" ||
      status === "connected_p2p" ||
      status === "connected_relay" ||
      status === "reconnecting"
    );
  }

  if (messageType !== "screen.frame.stub" && messageType !== "screen.frame.data") {
    if (messageType === "screen.frame.feedback") {
      return (
        status === "connected_p2p" ||
        status === "connected_relay" ||
        status === "reconnecting"
      );
    }

    return true;
  }

  return (
    status === "connected_p2p" ||
    status === "connected_relay" ||
    status === "reconnecting"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseOperatorRole(value: unknown): "viewer" | "tech" | "admin" {
  if (value === "admin" || value === "tech" || value === "viewer") {
    return value;
  }
  return "tech";
}

function parseAccessMode(value: unknown): SessionAccessMode {
  return value === "control" ? "control" : "view";
}

function parseCapabilities(value: unknown): SessionCapability[] {
  if (!Array.isArray(value)) {
    return ["screen"];
  }

  const allowed = new Set<SessionCapability>(["screen", "input", "clipboard"]);
  const parsed = value.filter(
    (x): x is SessionCapability => typeof x === "string" && allowed.has(x as SessionCapability),
  );

  if (parsed.length === 0) {
    return ["screen"];
  }

  return [...new Set(parsed)];
}

function parseEndpointOnline(value: unknown): boolean {
  return value === "online" || value === "true";
}

function parseEndpointUnattended(value: unknown): boolean {
  return value === "true";
}

function parseEndpointLicense(value: unknown): "active" | "inactive" {
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

function normalizeRequestedCapabilities(
  accessMode: SessionAccessMode,
  requested: SessionCapability[],
): SessionCapability[] {
  const next =
    accessMode === "view"
      ? requested.filter((capability) => capability !== "input")
      : requested;

  return next.length > 0 ? next : ["screen"];
}

function emitStateChanged(
  eventBus: InMemorySessionEventBus,
  session: SessionRecord,
  prevStatus: SessionStatus,
): void {
  eventBus.emit("session.state.changed", session, {
    prevStatus,
    newStatus: session.status,
    routeMode: session.routeMode,
  });
}

export function registerSessionRoutes(app: FastifyInstance): void {
  registerSessionRoutesWithDeps(app, {});
}

export function registerSessionRoutesWithDeps(
  app: FastifyInstance,
  deps: {
    auditStore?: InMemoryAuditLogStore;
  },
): void {
  const store = new InMemorySessionStore();
  const eventBus = new InMemorySessionEventBus();
  const auditStore = deps.auditStore ?? new InMemoryAuditLogStore();
  const signalStore = new InMemorySessionSignalStore();
  const endpointRegistry = new InMemoryEndpointRegistry();
  const wsHub = new SessionEventsWsHub();
  const signalWsHub = new SessionSignalWsHub(signalStore);
  const detachWs = wsHub.attach(eventBus);
  const isDev = process.env.NODE_ENV === "development";

  registerSessionEventsWsRoute(app, wsHub);
  registerSessionSignalWsRoute(app, signalWsHub, (id) => store.getById(id));

  app.addHook("onClose", async () => {
    detachWs();
  });

  /**
   * GET /api/v1/endpoints/:id/session-policy
   * Returns the endpoint's security policy (installProfile, license status, etc.)
   * 
   * In production: reads from the endpoint registry (authoritative source).
   * In dev: headers are treated as hints for testing purposes.
   */
  app.get(
    "/api/v1/endpoints/:id/session-policy",
    async (
      req: FastifyRequest<{ Params: EndpointPolicyParams }>,
      reply: FastifyReply,
    ) => {
      const endpointId = req.params.id;
      
      // Try to load from registry first (authoritative source)
      const registeredEndpoint = endpointRegistry.get(endpointId);
      
      if (registeredEndpoint) {
        // Endpoint is registered in our system
        return reply.code(200).send({
          endpointId: registeredEndpoint.endpointId,
          unattendedEnabled: registeredEndpoint.unattendedEnabled,
          requiresUserConsent: registeredEndpoint.requiresUserConsent,
          maxActiveControlSessions: registeredEndpoint.maxActiveControlSessions,
          installProfile: registeredEndpoint.installProfile,
          supportCommandsAllowed: registeredEndpoint.supportCommandsAllowed,
          folderActionsAllowed: registeredEndpoint.folderActionsAllowed,
        });
      }
      
      // Endpoint not registered: use header hints (dev mode only) or safe defaults
      if (isDev) {
        // In dev, allow headers to override for testing
        const unattended = parseEndpointUnattended(
          req.headers["x-endpoint-unattended"],
        );
        const installProfile = parseEndpointInstallProfile(
          req.headers["x-endpoint-install-profile"],
        );
        return reply.code(200).send({
          endpointId,
          unattendedEnabled: unattended,
          requiresUserConsent: !unattended,
          maxActiveControlSessions: 1,
          installProfile,
          supportCommandsAllowed: installProfile !== "remote_only",
          folderActionsAllowed: installProfile === "support_full",
        });
      }
      
      // In production, unknown endpoints get the most restrictive profile
      return reply.code(200).send({
        endpointId,
        unattendedEnabled: false,
        requiresUserConsent: true,
        maxActiveControlSessions: 1,
        installProfile: "remote_only",
        supportCommandsAllowed: false,
        folderActionsAllowed: false,
      });
    },
  );

  app.post(
    "/api/v1/sessions",
    async (
      req: FastifyRequest<{ Body: CreateSessionBody }>,
      reply: FastifyReply,
    ) => {
      const body = req.body;
      if (
        !body ||
        !isNonEmptyString(body.tenantId) ||
        !isNonEmptyString(body.endpointId) ||
        !isNonEmptyString(body.operatorId)
      ) {
        return reply.code(422).send({
          code: "validation_error",
          message: "tenantId, endpointId and operatorId are required",
        });
      }

      const role = parseOperatorRole(req.headers["x-operator-role"]);
      if (role === "viewer") {
        return reply.code(403).send({
          code: "policy_denied",
          reason: "role_insufficient",
        });
      }

      const license = parseEndpointLicense(req.headers["x-endpoint-license-status"]);
      if (license !== "active") {
        return reply.code(403).send({
          code: "policy_denied",
          reason: "license_inactive",
        });
      }

      const online = parseEndpointOnline(req.headers["x-endpoint-status"]);
      if (!online) {
        return reply.code(409).send({
          code: "endpoint_offline",
          message: "endpoint must be online",
        });
      }

      const accessMode = parseAccessMode(body.accessMode);
      const installProfile = parseEndpointInstallProfile(
        req.headers["x-endpoint-install-profile"],
      );
      if (accessMode === "control" && store.hasActiveControlSession(body.tenantId, body.endpointId)) {
        return reply.code(409).send({
          code: "endpoint_busy",
          message: "endpoint already has an active control session",
        });
      }

      const unattended = parseEndpointUnattended(req.headers["x-endpoint-unattended"]);
      const approvalMode: SessionApprovalMode = unattended ? "unattended" : "user_consent";
      const initialStatus: SessionStatus = unattended ? "signaling" : "pending_approval";
      const requestedCapabilities = normalizeRequestedCapabilities(
        accessMode,
        parseCapabilities(body.requestedCapabilities),
      );

      const session = store.create({
        tenantId: body.tenantId,
        endpointId: body.endpointId,
        operatorId: body.operatorId,
        status: initialStatus,
        routeMode: "unknown",
        approvalMode,
        accessMode,
        requestedCapabilities,
      });

      eventBus.emit("session.created", session, {
        approvalRequired: session.status === "pending_approval",
      });
      eventBus.emit("session.host.notified", session);
      if (session.status === "pending_approval") {
        eventBus.emit("session.approval.required", session);
      }

      return reply.code(201).send({
        sessionId: session.id,
        status: session.status,
        approvalRequired: session.status === "pending_approval",
        routeMode: session.routeMode,
        approvalMode: session.approvalMode,
        installProfile,
        requestedCapabilities,
      });
    },
  );

  app.get(
    "/api/v1/sessions/:id",
    async (
      req: FastifyRequest<{ Params: IdParams }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "session not found",
        });
      }

      return reply.code(200).send(found);
    },
  );

  app.post(
    "/api/v1/internal/sessions/:id/state",
    async (
      req: FastifyRequest<{ Params: IdParams; Body: InternalStateBody }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "session not found",
        });
      }

      const target = req.body?.status;
      const routeMode = req.body?.routeMode;
      if (
        target !== "signaling" &&
        target !== "connecting_p2p" &&
        target !== "connected_p2p" &&
        target !== "connected_relay" &&
        target !== "reconnecting" &&
        target !== "failed" &&
        target !== "ended"
      ) {
        return reply.code(422).send({
          code: "validation_error",
          message: "status is invalid",
        });
      }

      const updated = store.updateStatus(found.id, target, {
        ...(routeMode ? { routeMode } : {}),
      });
      if (!updated) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "session cannot transition to requested state",
        });
      }

      emitStateChanged(eventBus, updated, found.status);

      return reply.code(200).send({
        sessionId: updated.id,
        status: updated.status,
        routeMode: updated.routeMode,
      });
    },
  );

  app.post(
    "/api/v1/sessions/:id/approve",
    async (
      req: FastifyRequest<{ Params: IdParams }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "session not found",
        });
      }

      const updated = store.updateStatus(found.id, "signaling");
      if (!updated) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "session cannot be approved from current state",
        });
      }

      eventBus.emit("session.approved", updated, {
        approvalMode: updated.approvalMode,
      });
      emitStateChanged(eventBus, updated, found.status);

      return reply.code(200).send({
        sessionId: updated.id,
        status: updated.status,
      });
    },
  );

  app.post(
    "/api/v1/sessions/:id/signal",
    async (
      req: FastifyRequest<{ Params: SignalParams; Body: SignalBody }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "session not found",
        });
      }

      if (found.status === "ended" || found.status === "failed") {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "session is terminal",
        });
      }

      const senderType = req.body?.senderType;
      const messageType = req.body?.messageType;
      const payload = req.body?.payload;

      if (senderType !== "controller" && senderType !== "host") {
        return reply.code(422).send({
          code: "validation_error",
          message: "senderType must be controller or host",
        });
      }

      if (!messageType || !SIGNAL_MESSAGE_TYPES.includes(messageType)) {
        return reply.code(422).send({
          code: "validation_error",
          message: "messageType is invalid",
        });
      }

      const participantHeader = req.headers["x-participant-type"];
      if (
        (participantHeader === "controller" || participantHeader === "host") &&
        participantHeader !== senderType
      ) {
        return reply.code(403).send({
          code: "policy_denied",
          reason: "participant_sender_mismatch",
        });
      }

      if (!isSignalDirectionAllowed(senderType, messageType)) {
        auditStore.append({
          tenantId: found.tenantId,
          endpointId: found.endpointId,
          operatorId: found.operatorId,
          code: "session.signal.policy_denied",
          details: {
            sessionId: found.id,
            senderType,
            messageType,
            reason: "message_direction_invalid",
            status: found.status,
          },
        });
        return reply.code(403).send({
          code: "policy_denied",
          reason: "message_direction_invalid",
        });
      }

      if (!isSignalStateAllowed(found.status, messageType)) {
        auditStore.append({
          tenantId: found.tenantId,
          endpointId: found.endpointId,
          operatorId: found.operatorId,
          code: "session.signal.policy_denied",
          details: {
            sessionId: found.id,
            senderType,
            messageType,
            reason: "message_state_invalid",
            status: found.status,
          },
        });
        return reply.code(403).send({
          code: "policy_denied",
          reason: "message_state_invalid",
        });
      }

      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return reply.code(422).send({
          code: "validation_error",
          message: "payload must be an object",
        });
      }

      if (
        (
          messageType === "screen.frame.stub" ||
          messageType === "screen.frame.data" ||
          messageType === "screen.frame.feedback"
        ) &&
        !found.requestedCapabilities.includes("screen")
      ) {
        auditStore.append({
          tenantId: found.tenantId,
          endpointId: found.endpointId,
          operatorId: found.operatorId,
          code: "session.signal.policy_denied",
          details: {
            sessionId: found.id,
            senderType,
            messageType,
            reason: "screen_capability_missing",
            status: found.status,
          },
        });
        return reply.code(403).send({
          code: "policy_denied",
          reason: "screen_capability_missing",
        });
      }

      const message = signalStore.append({
        sessionId: found.id,
        tenantId: found.tenantId,
        senderType,
        messageType,
        payload,
      });

      signalWsHub.publish(message);

      return reply.code(201).send({
        item: message,
      });
    },
  );

  app.get(
    "/api/v1/sessions/:id/signal",
    async (
      req: FastifyRequest<{ Params: SignalParams; Querystring: SignalQuery }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "session not found",
        });
      }

      const afterSeqRaw = req.query.afterSeq;
      const parsed = Number(afterSeqRaw);
      const afterSeq = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;

      return reply.code(200).send({
        items: signalStore.list(found.id, afterSeq),
      });
    },
  );

  app.post(
    "/api/v1/sessions/:id/deny",
    async (
      req: FastifyRequest<{ Params: IdParams; Body: DenySessionBody }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "session not found",
        });
      }

      const reason = isNonEmptyString(req.body?.reason)
        ? req.body.reason
        : "user_denied";

      const updated = store.updateStatus(found.id, "ended", {
        endReason: reason,
      });
      if (!updated) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "session cannot be denied from current state",
        });
      }

      eventBus.emit("session.denied", updated, { reasonCode: reason });
      emitStateChanged(eventBus, updated, found.status);
      eventBus.emit("session.ended", updated, {
        endReason: reason,
      });

      return reply.code(200).send({
        sessionId: updated.id,
        status: updated.status,
      });
    },
  );

  app.post(
    "/api/v1/sessions/:id/end",
    async (
      req: FastifyRequest<{ Params: IdParams }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "session not found",
        });
      }

      const updated = store.updateStatus(found.id, "ended", {
        endReason: "ended_by_operator",
      });
      if (!updated) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "session cannot be ended from current state",
        });
      }

      emitStateChanged(eventBus, updated, found.status);
      eventBus.emit("session.ended", updated, {
        endReason: "ended_by_operator",
      });

      return reply.code(200).send({
        sessionId: updated.id,
        status: updated.status,
      });
    },
  );

  app.post(
    "/api/v1/sessions/:id/cancel",
    async (
      req: FastifyRequest<{ Params: IdParams }>,
      reply: FastifyReply,
    ) => {
      const found = store.getById(req.params.id);
      if (!found) {
        return reply.code(404).send({
          code: "not_found",
          message: "session not found",
        });
      }

      const updated = store.updateStatus(found.id, "ended", {
        endReason: "cancelled_by_operator",
      });
      if (!updated) {
        return reply.code(409).send({
          code: "invalid_state_transition",
          message: "session cannot be cancelled from current state",
        });
      }

      emitStateChanged(eventBus, updated, found.status);
      eventBus.emit("session.ended", updated, {
        endReason: "cancelled_by_operator",
      });

      return reply.code(200).send({
        sessionId: updated.id,
        status: updated.status,
      });
    },
  );
}
