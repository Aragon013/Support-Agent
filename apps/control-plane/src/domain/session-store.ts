import { randomUUID } from "node:crypto";
import {
  canTransitionSession,
  NON_TERMINAL_SESSION_STATUSES,
  type SessionAccessMode,
  type SessionApprovalMode,
  type SessionCapability,
  type SessionRouteMode,
  type SessionStatus,
} from "./session.js";

export type SessionRecord = {
  id: string;
  tenantId: string;
  endpointId: string;
  operatorId: string;
  status: SessionStatus;
  routeMode: SessionRouteMode;
  approvalMode: SessionApprovalMode;
  accessMode: SessionAccessMode;
  requestedCapabilities: SessionCapability[];
  createdAt: string;
  updatedAt: string;
  connectedAt?: string;
  endedAt?: string;
  endReason?: string;
};

export type CreateSessionInput = {
  tenantId: string;
  endpointId: string;
  operatorId: string;
  status: SessionStatus;
  routeMode: SessionRouteMode;
  approvalMode: SessionApprovalMode;
  accessMode: SessionAccessMode;
  requestedCapabilities: SessionCapability[];
};

export class InMemorySessionStore {
  private readonly byId = new Map<string, SessionRecord>();

  create(input: CreateSessionInput): SessionRecord {
    const now = new Date().toISOString();
    const rec: SessionRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      endpointId: input.endpointId,
      operatorId: input.operatorId,
      status: input.status,
      routeMode: input.routeMode,
      approvalMode: input.approvalMode,
      accessMode: input.accessMode,
      requestedCapabilities: [...input.requestedCapabilities],
      createdAt: now,
      updatedAt: now,
    };

    this.byId.set(rec.id, rec);
    return rec;
  }

  getById(id: string): SessionRecord | undefined {
    const found = this.byId.get(id);
    return found ? { ...found, requestedCapabilities: [...found.requestedCapabilities] } : undefined;
  }

  updateStatus(
    id: string,
    next: SessionStatus,
    extra?: {
      routeMode?: SessionRouteMode;
      endReason?: string;
    },
  ): SessionRecord | undefined {
    const found = this.byId.get(id);
    if (!found) return undefined;
    if (!canTransitionSession(found.status, next)) {
      return undefined;
    }

    const now = new Date().toISOString();
    const updated: SessionRecord = {
      ...found,
      status: next,
      routeMode: extra?.routeMode ?? found.routeMode,
      updatedAt: now,
      ...(next === "connected_p2p" || next === "connected_relay"
        ? { connectedAt: now }
        : {}),
      ...(next === "ended" || next === "failed"
        ? { endedAt: now, ...(extra?.endReason ? { endReason: extra.endReason } : {}) }
        : {}),
    };

    this.byId.set(id, updated);
    return { ...updated, requestedCapabilities: [...updated.requestedCapabilities] };
  }

  hasActiveControlSession(tenantId: string, endpointId: string): boolean {
    for (const rec of this.byId.values()) {
      if (rec.tenantId !== tenantId || rec.endpointId !== endpointId) {
        continue;
      }
      if (rec.accessMode !== "control") {
        continue;
      }
      if (NON_TERMINAL_SESSION_STATUSES.includes(rec.status)) {
        return true;
      }
    }

    return false;
  }
}
