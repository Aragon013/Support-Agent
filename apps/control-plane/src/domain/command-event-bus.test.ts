import { describe, expect, it } from "vitest";

import { InMemoryCommandEventBus } from "./command-event-bus.js";
import type { CommandJobRecord } from "./command-job-store.js";

function makeJob(overrides?: Partial<CommandJobRecord>): CommandJobRecord {
  return {
    id: "job-1",
    tenantId: "tenant-1",
    endpointId: "endpoint-1",
    operatorId: "operator-1",
    catalogCommandId: "diagnostic.system.info",
    commandVersion: "1.0.0",
    requestedParams: {},
    riskLevel: "low",
    requiresMfa: false,
    status: "queued",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("InMemoryCommandEventBus", () => {
  it("purges expired events and keeps preserved envelope kinds", () => {
    const bus = new InMemoryCommandEventBus();

    const oldJob = makeJob({
      id: "job-old",
      tenantId: "tenant-A",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "queued",
    });

    bus.emitTransition(oldJob);
    bus.emitCommandInit(oldJob);
    bus.emitAbort(oldJob, "cancelled_by_operator");

    const report = bus.purgeWithPolicy({
      retentionDays: 0,
      nowMs: new Date("2027-01-01T00:00:00.000Z").getTime(),
      preserveEnvelopeKinds: ["command.abort"],
    });

    expect(report.jobEventsPurged).toBeGreaterThan(0);
    expect(report.envelopesPurged).toBeGreaterThan(0);
    expect(report.envelopesPreserved).toBe(1);
    expect(report.byTenant["tenant-A"]).toBeGreaterThan(0);

    const envelopes = bus.getEnvelopes("job-old");
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.kind).toBe("command.abort");
  });

  it("redacts sensitive fields recursively in transition details", () => {
    const bus = new InMemoryCommandEventBus();
    const job = makeJob({ id: "job-redact" });

    const event = bus.emitTransition(job, {
      token: "abc",
      nested: {
        password: "secret",
        keep: "ok",
      },
      arr: [
        { otp: "123456" },
        { plain: "value" },
      ],
    });

    expect(event.details?.token).toBe("[REDACTED]");
    expect((event.details?.nested as Record<string, unknown>)?.password).toBe("[REDACTED]");
    expect((event.details?.nested as Record<string, unknown>)?.keep).toBe("ok");

    const arr = event.details?.arr as Array<Record<string, unknown>>;
    expect(arr[0]?.otp).toBe("[REDACTED]");
    expect(arr[1]?.plain).toBe("value");
  });
});
