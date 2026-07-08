import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("secaudit stress routes", () => {
  it("runs ethernet resilience diagnostics and persists report", async () => {
    const app = buildApp();

    const run = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/stress/ethernet-resilience",
      payload: {
        tenantId: "tenant-1",
        operatorId: "operator-1",
        endpointId: "endpoint-1",
        iterations: 8,
        expectedBandwidthMbps: 1000,
        saturationThresholdPct: 90,
      },
    });

    expect(run.statusCode).toBe(201);
    const report = run.json() as {
      id: string;
      module: string;
      status: string;
      closedSafely: boolean;
      summary: { avgLatencyMs: number; avgPacketLossPct: number; avgResponseTimeMs: number; samples: number };
    };
    expect(report.id).toMatch(/^secaudit_stress_/);
    expect(report.module).toBe("ethernet_resilience");
    expect(report.closedSafely).toBe(true);
    expect(report.summary.samples).toBeGreaterThan(0);

    const list = await app.inject({ method: "GET", url: "/api/v1/secaudit/stress/reports?tenantId=tenant-1" });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { count: number; items: Array<{ id: string }> };
    expect(listBody.count).toBeGreaterThan(0);
    expect(listBody.items.some((item) => item.id === report.id)).toBe(true);

    const byId = await app.inject({ method: "GET", url: `/api/v1/secaudit/stress/reports/${report.id}` });
    expect(byId.statusCode).toBe(200);

    await app.close();
  });

  it("runs wireless density diagnostics and captures safe-close report", async () => {
    const app = buildApp();

    const run = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/stress/wireless-density",
      payload: {
        tenantId: "tenant-2",
        operatorId: "operator-2",
        endpointId: "endpoint-2",
        apId: "ap-branch-01",
        iterations: 10,
        expectedMaxClients: 120,
        associationThresholdPct: 90,
      },
    });

    expect(run.statusCode).toBe(201);
    const report = run.json() as {
      module: string;
      status: "completed" | "hardware_limit" | "failed";
      closedSafely: boolean;
      metrics: Array<{ associationCapacityPct?: number; latencyMs: number; packetLossPct: number; responseTimeMs: number }>;
      terminationReason: string;
    };
    expect(report.module).toBe("wireless_density");
    expect(["completed", "hardware_limit", "failed"]).toContain(report.status);
    expect(report.closedSafely).toBe(true);
    expect(report.metrics.length).toBeGreaterThan(0);
    expect(typeof report.terminationReason).toBe("string");

    const list = await app.inject({ method: "GET", url: "/api/v1/secaudit/stress/reports?tenantId=tenant-2&module=wireless_density" });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { count: number };
    expect(body.count).toBeGreaterThan(0);

    await app.close();
  });

  it("validates required payload fields", async () => {
    const app = buildApp();

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/stress/wireless-density",
      payload: {
        tenantId: "tenant-3",
        operatorId: "operator-3",
        endpointId: "endpoint-3",
      },
    });

    expect(missing.statusCode).toBe(422);

    await app.close();
  });
});
