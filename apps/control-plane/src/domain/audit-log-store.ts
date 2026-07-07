export type AuditEventCode =
  | "command.job.created"
  | "command.job.policy_check"
  | "command.job.mfa_pending"
  | "command.job.queued"
  | "command.job.dispatched"
  | "command.job.running"
  | "command.job.streaming"
  | "command.job.verifying"
  | "command.job.completed"
  | "command.job.failed"
  | "command.job.blocked"
  | "command.job.cancelled"
  | "command.job.retry"
  | "command.mfa.challenge.issued"
  | "command.mfa.challenge.failed"
  | "command.mfa.challenge.verified"
  | "session.signal.policy_denied";

export type AuditLogRecord = {
  id: string;
  createdAt: string;
  tenantId: string;
  operatorId: string;
  endpointId?: string;
  jobId?: string;
  code: AuditEventCode;
  details: Record<string, unknown>;
};

export type CreateAuditLogInput = Omit<AuditLogRecord, "id" | "createdAt">;

export type AuditPurgePolicy = {
  retentionDays: number;
  preserveCodes?: AuditEventCode[];
  nowMs?: number;
};

export type AuditPurgeReport = {
  purged: number;
  preserved: number;
  byTenant: Record<string, number>;
};

function redactDetails(input: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/secret|token|password|otp|key|passphrase/i.test(key)) {
      redacted[key] = "[REDACTED]";
      continue;
    }

    if (Array.isArray(value)) {
      redacted[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? redactDetails(item as Record<string, unknown>)
          : item,
      );
      continue;
    }

    if (typeof value === "object" && value !== null) {
      redacted[key] = redactDetails(value as Record<string, unknown>);
      continue;
    }

    redacted[key] = value;
  }
  return redacted;
}

export class InMemoryAuditLogStore {
  private readonly records: AuditLogRecord[] = [];

  constructor(
    private readonly retentionDays = 90,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  append(input: CreateAuditLogInput): AuditLogRecord {
    this.purgeExpired();

    const now = new Date(this.nowMs()).toISOString();
    const record: AuditLogRecord = {
      id: `audit_${this.records.length + 1}`,
      createdAt: now,
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      code: input.code,
      details: redactDetails(input.details),
      ...(input.endpointId ? { endpointId: input.endpointId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
    };

    this.records.push(record);
    return record;
  }

  getByJobId(jobId: string): AuditLogRecord[] {
    this.purgeExpired();
    return this.records.filter((item) => item.jobId === jobId);
  }

  find(filters: {
    tenantId?: string;
    operatorId?: string;
  }): AuditLogRecord[] {
    this.purgeExpired();
    return this.records.filter((item) => {
      if (filters.tenantId && item.tenantId !== filters.tenantId) {
        return false;
      }
      if (filters.operatorId && item.operatorId !== filters.operatorId) {
        return false;
      }
      return true;
    });
  }

  purgeExpired(): number {
    const cutoffMs = this.nowMs() - this.retentionDays * 24 * 60 * 60 * 1000;
    const before = this.records.length;
    for (let i = this.records.length - 1; i >= 0; i -= 1) {
      const row = this.records[i];
      if (!row) {
        continue;
      }

      const rowMs = new Date(row.createdAt).getTime();
      if (Number.isFinite(rowMs) && rowMs < cutoffMs) {
        this.records.splice(i, 1);
      }
    }

    return before - this.records.length;
  }

  purgeWithPolicy(policy: AuditPurgePolicy): AuditPurgeReport {
    const cutoffMs =
      (policy.nowMs ?? this.nowMs()) - policy.retentionDays * 24 * 60 * 60 * 1000;
    const preserveSet = new Set(policy.preserveCodes ?? []);

    const byTenant: Record<string, number> = {};
    let purged = 0;
    let preserved = 0;

    for (let i = this.records.length - 1; i >= 0; i -= 1) {
      const row = this.records[i];
      if (!row) {
        continue;
      }

      const rowMs = new Date(row.createdAt).getTime();
      const isExpired = Number.isFinite(rowMs) && rowMs <= cutoffMs;
      if (!isExpired) {
        continue;
      }

      if (preserveSet.has(row.code)) {
        preserved += 1;
        continue;
      }

      purged += 1;
      byTenant[row.tenantId] = (byTenant[row.tenantId] ?? 0) + 1;
      this.records.splice(i, 1);
    }

    return {
      purged,
      preserved,
      byTenant,
    };
  }
}
