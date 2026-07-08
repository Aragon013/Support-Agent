import { randomUUID } from "node:crypto";

export type ExceptionStatus = "pending" | "approved" | "rejected" | "expired";

export type ExceptionRecord = {
  id: string;
  tenantId: string;
  planId: string;
  moduleId: string;
  controlId?: string;
  justification: string;
  requestedBy: string;
  approvedBy?: string;
  status: ExceptionStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
};

type CreateExceptionInput = {
  tenantId: string;
  planId: string;
  moduleId: string;
  controlId?: string;
  justification: string;
  requestedBy: string;
  expiresAt: string;
};

type UpdateExceptionInput = {
  status: "approved" | "rejected";
  approvedBy: string;
  notes?: string;
};

export class InMemoryExceptionStore {
  private readonly items = new Map<string, ExceptionRecord>();

  create(input: CreateExceptionInput): ExceptionRecord {
    const now = new Date().toISOString();
    const record: ExceptionRecord = {
      id: `exc_${randomUUID()}`,
      tenantId: input.tenantId,
      planId: input.planId,
      moduleId: input.moduleId,
      justification: input.justification,
      requestedBy: input.requestedBy,
      status: "pending",
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
      ...(input.controlId !== undefined ? { controlId: input.controlId } : {}),
    };
    this.items.set(record.id, record);
    return record;
  }

  getById(id: string): ExceptionRecord | undefined {
    return this.items.get(id);
  }

  update(id: string, input: UpdateExceptionInput): ExceptionRecord | undefined {
    const found = this.items.get(id);
    if (!found) return undefined;
    const updated: ExceptionRecord = {
      ...found,
      status: input.status,
      approvedBy: input.approvedBy,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.items.set(id, updated);
    return updated;
  }

  listByTenant(tenantId: string): ExceptionRecord[] {
    return Array.from(this.items.values())
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listByPlan(planId: string): ExceptionRecord[] {
    return Array.from(this.items.values())
      .filter((r) => r.planId === planId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Mark overdue pending exceptions as expired. Returns count expired. */
  expireOverdue(): number {
    const now = new Date();
    let count = 0;
    for (const record of this.items.values()) {
      if (record.status !== "pending" && record.status !== "approved") continue;
      if (new Date(record.expiresAt) <= now) {
        this.items.set(record.id, { ...record, status: "expired", updatedAt: now.toISOString() });
        count++;
      }
    }
    return count;
  }

  /** Check if an active (approved, not-expired) exception exists for a plan+module combo. */
  hasActiveException(planId: string, moduleId: string, controlId?: string): boolean {
    const now = new Date();
    return Array.from(this.items.values()).some(
      (r) =>
        r.planId === planId &&
        r.moduleId === moduleId &&
        (controlId === undefined || r.controlId === controlId) &&
        r.status === "approved" &&
        new Date(r.expiresAt) > now,
    );
  }
}
