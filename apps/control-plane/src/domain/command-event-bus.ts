import type { CommandJobRecord } from "./command-job-store.js";
import type { CommandJobStatus, StreamType } from "./command-job.js";

export type CommandJobEventName = `command.job.${CommandJobStatus}` | "command.job.retry";

export type CommandJobEvent = {
  id: string;
  seq: number;
  jobId: string;
  tenantId: string;
  endpointId: string;
  operatorId: string;
  name: CommandJobEventName;
  status: CommandJobStatus;
  createdAt: string;
  details?: Record<string, unknown>;
};

export type CommandDataEnvelope =
  | {
      v: 1;
      kind: "command.init";
      seq: number;
      jobId: string;
      commandId: string;
      commandVersion: string;
      requestedAt: string;
      params: Record<string, unknown>;
    }
  | {
      v: 1;
      kind: "command.stdout" | "command.stderr";
      seq: number;
      jobId: string;
      chunk: string;
      stream: StreamType;
      ts: string;
    }
  | {
      v: 1;
      kind: "command.exit";
      seq: number;
      jobId: string;
      exitCode: number;
      ts: string;
    }
  | {
      v: 1;
      kind: "command.abort";
      seq: number;
      jobId: string;
      reason: string;
      ts: string;
    };

export type EventPurgePolicy = {
  retentionDays: number;
  preserveEnvelopeKinds?: Array<CommandDataEnvelope["kind"]>;
  tenantId?: string;     // Si se especifica, purga solo ese tenant
  nowMs?: number;
};

export type EventPurgeReport = {
  jobEventsPurged: number;
  envelopesPurged: number;
  envelopesPreserved: number;
  byTenant: Record<string, number>;
};

function statusEventName(status: CommandJobStatus): CommandJobEventName {
  return `command.job.${status}`;
}

export function redactSecrets(input: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/secret|token|password|otp|key|passphrase/i.test(key)) {
      redacted[key] = "[REDACTED]";
      continue;
    }

    if (Array.isArray(value)) {
      redacted[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? redactSecrets(item as Record<string, unknown>)
          : item,
      );
      continue;
    }

    if (typeof value === "object" && value !== null) {
      redacted[key] = redactSecrets(value as Record<string, unknown>);
      continue;
    }

    redacted[key] = value;
  }
  return redacted;
}

export class InMemoryCommandEventBus {
  private readonly jobEvents = new Map<string, CommandJobEvent[]>();
  private readonly dataEnvelopes = new Map<string, CommandDataEnvelope[]>();
  private readonly jobTenant = new Map<string, string>();
  private readonly listeners = new Set<(event: CommandJobEvent) => void>();
  private seq = 0;

  subscribe(listener: (event: CommandJobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(event: CommandJobEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  emitTransition(
    job: CommandJobRecord,
    details?: Record<string, unknown>,
  ): CommandJobEvent {
    this.seq += 1;
    const event: CommandJobEvent = {
      id: `${job.id}:${this.seq}`,
      seq: this.seq,
      jobId: job.id,
      tenantId: job.tenantId,
      endpointId: job.endpointId,
      operatorId: job.operatorId,
      name: statusEventName(job.status),
      status: job.status,
      createdAt: new Date().toISOString(),
      ...(details ? { details: redactSecrets(details) } : {}),
    };

    const list = this.jobEvents.get(job.id);
    if (!list) {
      this.jobEvents.set(job.id, [event]);
    } else {
      list.push(event);
    }

    this.jobTenant.set(job.id, job.tenantId);
    this.notify(event);

    return event;
  }

  emitRetry(job: CommandJobRecord): CommandJobEvent {
    this.seq += 1;
    const event: CommandJobEvent = {
      id: `${job.id}:${this.seq}`,
      seq: this.seq,
      jobId: job.id,
      tenantId: job.tenantId,
      endpointId: job.endpointId,
      operatorId: job.operatorId,
      name: "command.job.retry",
      status: job.status,
      createdAt: new Date().toISOString(),
    };

    const list = this.jobEvents.get(job.id);
    if (!list) {
      this.jobEvents.set(job.id, [event]);
    } else {
      list.push(event);
    }

    this.jobTenant.set(job.id, job.tenantId);
    this.notify(event);

    return event;
  }

  emitCommandInit(job: CommandJobRecord): CommandDataEnvelope {
    this.seq += 1;
    const envelope: CommandDataEnvelope = {
      v: 1,
      kind: "command.init",
      seq: this.seq,
      jobId: job.id,
      commandId: job.catalogCommandId,
      commandVersion: job.commandVersion,
      requestedAt: job.createdAt,
      params: redactSecrets(job.requestedParams),
    };

    const list = this.dataEnvelopes.get(job.id);
    if (!list) {
      this.dataEnvelopes.set(job.id, [envelope]);
    } else {
      list.push(envelope);
    }

    this.jobTenant.set(job.id, job.tenantId);

    return envelope;
  }

  emitAbort(job: CommandJobRecord, reason: string): CommandDataEnvelope {
    this.seq += 1;
    const envelope: CommandDataEnvelope = {
      v: 1,
      kind: "command.abort",
      seq: this.seq,
      jobId: job.id,
      reason,
      ts: new Date().toISOString(),
    };

    const list = this.dataEnvelopes.get(job.id);
    if (!list) {
      this.dataEnvelopes.set(job.id, [envelope]);
    } else {
      list.push(envelope);
    }

    this.jobTenant.set(job.id, job.tenantId);

    return envelope;
  }

  emitStdout(job: CommandJobRecord, chunk: string): CommandDataEnvelope {
    this.seq += 1;
    const envelope: CommandDataEnvelope = {
      v: 1,
      kind: "command.stdout",
      seq: this.seq,
      jobId: job.id,
      chunk,
      stream: "stdout",
      ts: new Date().toISOString(),
    };

    const list = this.dataEnvelopes.get(job.id);
    if (!list) {
      this.dataEnvelopes.set(job.id, [envelope]);
    } else {
      list.push(envelope);
    }

    this.jobTenant.set(job.id, job.tenantId);
    return envelope;
  }

  emitStderr(job: CommandJobRecord, chunk: string): CommandDataEnvelope {
    this.seq += 1;
    const envelope: CommandDataEnvelope = {
      v: 1,
      kind: "command.stderr",
      seq: this.seq,
      jobId: job.id,
      chunk,
      stream: "stderr",
      ts: new Date().toISOString(),
    };

    const list = this.dataEnvelopes.get(job.id);
    if (!list) {
      this.dataEnvelopes.set(job.id, [envelope]);
    } else {
      list.push(envelope);
    }

    this.jobTenant.set(job.id, job.tenantId);
    return envelope;
  }

  emitExit(job: CommandJobRecord, exitCode: number): CommandDataEnvelope {
    this.seq += 1;
    const envelope: CommandDataEnvelope = {
      v: 1,
      kind: "command.exit",
      seq: this.seq,
      jobId: job.id,
      exitCode,
      ts: new Date().toISOString(),
    };

    const list = this.dataEnvelopes.get(job.id);
    if (!list) {
      this.dataEnvelopes.set(job.id, [envelope]);
    } else {
      list.push(envelope);
    }

    this.jobTenant.set(job.id, job.tenantId);
    return envelope;
  }

  getEvents(jobId: string): CommandJobEvent[] {
    return [...(this.jobEvents.get(jobId) ?? [])].sort((a, b) => a.seq - b.seq);
  }

  getEnvelopes(jobId: string): CommandDataEnvelope[] {
    return [...(this.dataEnvelopes.get(jobId) ?? [])].sort(
      (a, b) => a.seq - b.seq,
    );
  }

  purgeWithPolicy(policy: EventPurgePolicy): EventPurgeReport {
    const nowMs = policy.nowMs ?? Date.now();
    const cutoffMs = nowMs - policy.retentionDays * 24 * 60 * 60 * 1000;
    const preserveKinds = new Set(policy.preserveEnvelopeKinds ?? []);

    const byTenant: Record<string, number> = {};
    let jobEventsPurged = 0;
    let envelopesPurged = 0;
    let envelopesPreserved = 0;

    for (const [jobId, events] of this.jobEvents.entries()) {
      const tenantId = this.jobTenant.get(jobId) ?? "unknown";
      // Skip if scoped to a different tenant
      if (policy.tenantId && tenantId !== policy.tenantId) {
        continue;
      }
      const kept = events.filter((event) => {
        const eventMs = new Date(event.createdAt).getTime();
        const expired = Number.isFinite(eventMs) && eventMs <= cutoffMs;
        if (!expired) {
          return true;
        }

        jobEventsPurged += 1;
        byTenant[tenantId] = (byTenant[tenantId] ?? 0) + 1;
        return false;
      });

      if (kept.length === 0) {
        this.jobEvents.delete(jobId);
      } else {
        this.jobEvents.set(jobId, kept);
      }
    }

    for (const [jobId, envelopes] of this.dataEnvelopes.entries()) {
      const tenantId = this.jobTenant.get(jobId) ?? "unknown";
      // Skip if scoped to a different tenant
      if (policy.tenantId && tenantId !== policy.tenantId) {
        continue;
      }
      const kept = envelopes.filter((envelope) => {
        const createdMs =
          envelope.kind === "command.init"
            ? new Date(envelope.requestedAt).getTime()
            : new Date(envelope.ts).getTime();
        const expired = Number.isFinite(createdMs) && createdMs <= cutoffMs;
        if (!expired) {
          return true;
        }

        if (preserveKinds.has(envelope.kind)) {
          envelopesPreserved += 1;
          return true;
        }

        envelopesPurged += 1;
        byTenant[tenantId] = (byTenant[tenantId] ?? 0) + 1;
        return false;
      });

      if (kept.length === 0) {
        this.dataEnvelopes.delete(jobId);
      } else {
        this.dataEnvelopes.set(jobId, kept);
      }
    }

    return {
      jobEventsPurged,
      envelopesPurged,
      envelopesPreserved,
      byTenant,
    };
  }
}
