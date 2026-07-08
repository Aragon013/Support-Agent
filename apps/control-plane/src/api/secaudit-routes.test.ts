import { describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

describe("secaudit routes", () => {
  it("creates and runs a SecAudit plan", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/plans",
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        packageId: "quick",
        targetOs: "windows",
        executionLevel: "safe",
        modules: ["host.os-posture", "host.firewall-edr", "net.client-health"],
      },
    });

    expect(create.statusCode).toBe(201);
    const plan = create.json() as { id: string; status: string; results: Array<{ status: string }> };
    expect(plan.id).toBeTruthy();
    expect(plan.status).toBe("draft");

    const run = await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan.id}/run`,
    });

    expect(run.statusCode).toBe(200);
    const runBody = run.json() as { status: string; modules: Array<{ moduleId: string; status: string }> };
    expect(runBody.status).toBe("running");
    expect(runBody.modules.some((x) => x.moduleId === "net.client-health" && x.status === "client_required")).toBe(true);

    await app.close();
  });

  it("accepts client findings and reflects them in results", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/plans",
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        packageId: "quick",
        targetOs: "windows",
        executionLevel: "safe",
        modules: ["net.client-health"],
      },
    });

    const plan = create.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan.id}/run`,
    });

    const before = await app.inject({
      method: "GET",
      url: `/api/v1/secaudit/plans/${plan.id}/results`,
    });

    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as {
      status: string;
      summary: { clientRequired: number; running: number };
      modules: Array<{ moduleId: string; status: string }>;
    };
    expect(beforeBody.status).toBe("running");
    expect(beforeBody.summary.clientRequired).toBe(1);
    expect(beforeBody.modules[0]?.status).toBe("client_required");

    const ingest = await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan.id}/client-findings`,
      payload: {
        moduleId: "net.client-health",
        findings: {
          status: "ok",
          latencyMs: 31,
        },
        evidence: ["ping=31ms"],
      },
    });

    expect(ingest.statusCode).toBe(200);

    const results = await app.inject({
      method: "GET",
      url: `/api/v1/secaudit/plans/${plan.id}/results`,
    });

    expect(results.statusCode).toBe(200);
    const body = results.json() as {
      status: string;
      modules: Array<{ moduleId: string; status: string; evidence?: string[] }>;
      summary: { completed: number };
    };

    expect(body.status).toBe("completed");
    expect(body.summary.completed).toBe(1);
    const module = body.modules.find((x) => x.moduleId === "net.client-health");
    expect(module?.status).toBe("completed");
    expect(module?.evidence?.[0]).toBe("ping=31ms");

    await app.close();
  });

  it("requires admin key to list plans by tenant", async () => {
    const app = buildApp();

    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/v1/secaudit/plans?tenantId=tenant-1",
    });

    expect(unauthorized.statusCode).toBe(401);

    await app.close();
  });

  it("exports report with score and executive summary", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/plans",
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        packageId: "quick",
        targetOs: "windows",
        executionLevel: "safe",
        modules: ["net.client-health"],
      },
    });

    const plan = create.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan.id}/run`,
    });

    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan.id}/client-findings`,
      payload: {
        moduleId: "net.client-health",
        findings: { status: "ok" },
        evidence: ["ping=31ms"],
      },
    });

    const report = await app.inject({
      method: "GET",
      url: `/api/v1/secaudit/plans/${plan.id}/report`,
    });

    expect(report.statusCode).toBe(200);
    const body = report.json() as {
      id: string;
      executive: { score: number | null; severities: Record<string, number>; summary: string };
      modules: Array<{ id: string; status: string }>;
    };

    expect(body.id).toBe(plan.id);
    expect(body.executive).toBeDefined();
    expect(body.executive.score).toBe(100); // No severity findings = perfect score
    expect(body.executive.severities).toBeDefined();
    expect(body.executive.summary).toContain("Audit completed");
    expect(body.modules.length).toBe(1);
    expect(body.modules[0]?.id).toBe("net.client-health");

    await app.close();
  });

  it("compares current audit with baseline", async () => {
    const app = buildApp();

    // First audit (baseline)
    const create1 = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/plans",
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        packageId: "quick",
        targetOs: "windows",
        executionLevel: "safe",
        modules: ["net.client-health"],
      },
    });

    const plan1 = create1.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan1.id}/run`,
    });

    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan1.id}/client-findings`,
      payload: {
        moduleId: "net.client-health",
        findings: { status: "ok", severity: "high" },
        evidence: ["ping=31ms"],
      },
    });

    // Fetch results to mark plan1 as completed
    await app.inject({
      method: "GET",
      url: `/api/v1/secaudit/plans/${plan1.id}/results`,
    });

    // Second audit (current)
    const create2 = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/plans",
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        packageId: "quick",
        targetOs: "windows",
        executionLevel: "safe",
        modules: ["net.client-health"],
      },
    });

    const plan2 = create2.json() as { id: string; baselinePlanId?: string };
    expect(plan2.baselinePlanId).toBe(plan1.id);

    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan2.id}/run`,
    });

    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan2.id}/client-findings`,
      payload: {
        moduleId: "net.client-health",
        findings: { status: "ok", severity: "medium" },
        evidence: ["ping=28ms"],
      },
    });

    const compare = await app.inject({
      method: "GET",
      url: `/api/v1/secaudit/plans/${plan2.id}/compare`,
    });

    expect(compare.statusCode).toBe(200);
    const body = compare.json() as {
      current: { id: string; score: number | undefined };
      baseline: { id: string } | null;
      scoreDelta: number | null;
      severityDelta: { high: number; medium: number };
    };

    expect(body.current.id).toBe(plan2.id);
    expect(body.baseline?.id).toBe(plan1.id);
    expect(body.scoreDelta).toBeDefined();
    expect(body.severityDelta.high).toBe(-1);
    expect(body.severityDelta.medium).toBe(1);

    await app.close();
  });
});
