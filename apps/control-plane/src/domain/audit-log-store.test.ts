import { describe, expect, it } from "vitest";

import { InMemoryAuditLogStore } from "./audit-log-store.js";

describe("InMemoryAuditLogStore", () => {
  it("purges entries older than 90 days", () => {
    let now = new Date("2026-07-06T00:00:00.000Z").getTime();
    const store = new InMemoryAuditLogStore(90, () => now);

    store.append({
      tenantId: "tenant-1",
      operatorId: "operator-1",
      jobId: "job-1",
      code: "command.job.queued",
      details: {},
    });

    now += 91 * 24 * 60 * 60 * 1000;

    store.append({
      tenantId: "tenant-1",
      operatorId: "operator-1",
      jobId: "job-1",
      code: "command.job.cancelled",
      details: {},
    });

    const items = store.getByJobId("job-1");
    expect(items).toHaveLength(1);
    expect(items[0]?.code).toBe("command.job.cancelled");
  });

  it("redacts sensitive detail fields", () => {
    const store = new InMemoryAuditLogStore();

    store.append({
      tenantId: "tenant-1",
      operatorId: "operator-1",
      jobId: "job-1",
      code: "command.mfa.challenge.failed",
      details: {
        otp: "000000",
        tokenValue: "abc",
        nested: {
          password: "top-secret",
        },
      },
    });

    const items = store.getByJobId("job-1");
    expect(items[0]?.details.otp).toBe("[REDACTED]");
    expect(items[0]?.details.tokenValue).toBe("[REDACTED]");
    const nested = items[0]?.details.nested as { password: string };
    expect(nested.password).toBe("[REDACTED]");
  });

  it("purges with policy and reports by tenant", () => {
    let now = new Date("2026-07-06T00:00:00.000Z").getTime();
    const store = new InMemoryAuditLogStore(90, () => now);

    store.append({
      tenantId: "t1",
      operatorId: "op1",
      code: "command.job.queued",
      details: {},
    });
    store.append({
      tenantId: "t2",
      operatorId: "op2",
      code: "command.job.cancelled",
      details: {},
    });

    now += 91 * 24 * 60 * 60 * 1000;

    const report = store.purgeWithPolicy({
      retentionDays: 90,
      preserveCodes: ["command.job.cancelled"],
      nowMs: now,
    });

    expect(report.purged).toBe(1);
    expect(report.preserved).toBe(1);
    expect(report.byTenant.t1).toBe(1);
    expect(report.byTenant.t2).toBeUndefined();
  });

  it("supports tenant-specific retention overrides", () => {
    const store = new InMemoryAuditLogStore(90);

    expect(store.getRetentionDaysForTenant("tenant-1")).toBe(90);

    store.setRetentionDaysForTenant("tenant-1", 14);
    expect(store.getRetentionDaysForTenant("tenant-1")).toBe(14);

    store.clearRetentionDaysForTenant("tenant-1");
    expect(store.getRetentionDaysForTenant("tenant-1")).toBe(90);
  });
});
