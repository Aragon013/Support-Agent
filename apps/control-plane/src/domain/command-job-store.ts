import { randomUUID } from "node:crypto";

import type { CommandJobStatus, RiskLevel } from "./command-job.js";

export type CommandJobRecord = {
  id: string;
  tenantId: string;
  endpointId: string;
  operatorId: string;
  catalogCommandId: string;
  commandVersion: string;
  requestedParams: Record<string, unknown>;
  riskLevel: RiskLevel;
  requiresMfa: boolean;
  status: CommandJobStatus;
  createdAt: string;
};

export type CreateCommandJobInput = Omit<
  CommandJobRecord,
  "id" | "createdAt" | "status"
> & {
  status?: CommandJobStatus;
};

export class InMemoryCommandJobStore {
  private readonly jobs = new Map<string, CommandJobRecord>();

  create(input: CreateCommandJobInput): CommandJobRecord {
    const nowIso = new Date().toISOString();
    const record: CommandJobRecord = {
      id: randomUUID(),
      status: input.status ?? "created",
      createdAt: nowIso,
      tenantId: input.tenantId,
      endpointId: input.endpointId,
      operatorId: input.operatorId,
      catalogCommandId: input.catalogCommandId,
      commandVersion: input.commandVersion,
      requestedParams: input.requestedParams,
      riskLevel: input.riskLevel,
      requiresMfa: input.requiresMfa,
    };

    this.jobs.set(record.id, record);
    return record;
  }

  getById(id: string): CommandJobRecord | undefined {
    return this.jobs.get(id);
  }

  updateStatus(id: string, status: CommandJobStatus): CommandJobRecord | undefined {
    const current = this.jobs.get(id);
    if (!current) {
      return undefined;
    }

    const updated: CommandJobRecord = { ...current, status };
    this.jobs.set(id, updated);
    return updated;
  }
}
