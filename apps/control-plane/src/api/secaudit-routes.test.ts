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
      remediations: Array<{ moduleId: string; title: string; priority: string; actions: string[] }>;
      modules: Array<{ id: string; status: string }>;
    };

    expect(body.id).toBe(plan.id);
    expect(body.executive).toBeDefined();
    expect(body.executive.score).toBe(100); // No severity findings = perfect score
    expect(body.executive.severities).toBeDefined();
    expect(body.executive.summary).toContain("Audit completed");
    expect(body.remediations).toHaveLength(1);
    expect(body.remediations[0]?.moduleId).toBe("net.client-health");
    expect(body.remediations[0]?.actions.length).toBeGreaterThan(0);
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

  it("generates PDF report with score and executive summary", async () => {
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
        modules: ["host.os-posture", "host.firewall-edr"],
      },
    });

    const plan = create.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan.id}/run`,
    });

    const pdf = await app.inject({
      method: "GET",
      url: `/api/v1/secaudit/plans/${plan.id}/report/pdf`,
    });

    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(`audit-${plan.id}.pdf`);

    await app.close();
  });

  it("exports CSV with modules and remediations", async () => {
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

    await app.inject({ method: "POST", url: `/api/v1/secaudit/plans/${plan.id}/run` });
    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan.id}/client-findings`,
      payload: { moduleId: "net.client-health", findings: { status: "ok", severity: "medium" }, evidence: ["ping=12ms"] },
    });

    const csv = await app.inject({
      method: "GET",
      url: `/api/v1/secaudit/plans/${plan.id}/report/csv`,
    });

    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain(`audit-${plan.id}.csv`);
    expect(csv.payload).toContain("net.client-health");
    expect(csv.payload).toContain("Module ID");

    await app.close();
  });

  it("supports remediation tracking, batch execution, and schedules", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/plans",
      payload: {
        tenantId: "tenant-ops",
        endpointId: "endpoint-tracking",
        operatorId: "operator-ops",
        packageId: "quick",
        targetOs: "windows",
        executionLevel: "safe",
        modules: ["net.client-health"],
      },
    });
    const plan = create.json() as { id: string };

    await app.inject({ method: "POST", url: `/api/v1/secaudit/plans/${plan.id}/run` });
    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan.id}/client-findings`,
      payload: { moduleId: "net.client-health", findings: { status: "ok", severity: "medium" }, evidence: ["lat=23ms"] },
    });

    const remPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/secaudit/plans/${plan.id}/remediations/net.client-health`,
      payload: { status: "accepted", notes: "will fix in next maintenance window" },
    });
    expect(remPatch.statusCode).toBe(200);
    const remBody = remPatch.json() as { status: string; notes?: string };
    expect(remBody.status).toBe("accepted");
    expect(remBody.notes).toContain("maintenance");

    const batchCreate = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/batches",
      payload: {
        tenantId: "tenant-ops",
        operatorId: "operator-ops",
        packageId: "quick",
        targetOs: "windows",
        executionLevel: "safe",
        modules: ["host.os-posture"],
        endpointIds: ["endpoint-a", "endpoint-b"],
      },
    });
    expect(batchCreate.statusCode).toBe(201);
    const batch = batchCreate.json() as { id: string; planIds: string[] };
    expect(batch.planIds).toHaveLength(2);

    const batchGet = await app.inject({ method: "GET", url: `/api/v1/secaudit/batches/${batch.id}` });
    expect(batchGet.statusCode).toBe(200);

    const batchList = await app.inject({ method: "GET", url: "/api/v1/secaudit/batches?tenantId=tenant-ops" });
    expect(batchList.statusCode).toBe(200);
    const batchListBody = batchList.json() as { count: number; items: Array<{ id: string }> };
    expect(batchListBody.count).toBeGreaterThan(0);
    expect(batchListBody.items.some((item) => item.id === batch.id)).toBe(true);

    const batchCancel = await app.inject({ method: "POST", url: `/api/v1/secaudit/batches/${batch.id}/cancel` });
    expect(batchCancel.statusCode).toBe(200);
    const batchCancelBody = batchCancel.json() as { status: string; cancelled: boolean };
    expect(batchCancelBody.cancelled).toBe(true);
    expect(batchCancelBody.status).toBe("cancelled");

    const schedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/schedules",
      payload: {
        tenantId: "tenant-ops",
        operatorId: "operator-ops",
        endpointId: "endpoint-sched",
        packageId: "quick",
        targetOs: "windows",
        executionLevel: "safe",
        modules: ["host.os-posture"],
        intervalMinutes: 15,
      },
    });
    expect(schedCreate.statusCode).toBe(201);
    const sched = schedCreate.json() as { id: string };

    const schedList = await app.inject({ method: "GET", url: "/api/v1/secaudit/schedules" });
    expect(schedList.statusCode).toBe(200);
    const listBody = schedList.json() as { count: number };
    expect(listBody.count).toBeGreaterThan(0);

    const schedDelete = await app.inject({ method: "DELETE", url: `/api/v1/secaudit/schedules/${sched.id}` });
    expect(schedDelete.statusCode).toBe(200);

    await app.close();
  });

  it("dispatches extended mapped modules without catalog validation failures", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/plans",
      payload: {
        tenantId: "tenant-extended",
        endpointId: "endpoint-extended",
        operatorId: "operator-extended",
        packageId: "deep",
        targetOs: "windows",
        executionLevel: "deep",
        modules: [
          "host.code-integrity",
          "identity.mfa-posture",
          "identity.secrets-exposure",
          "app.supply-chain",
          "host.cloud-saas-posture",
          "net.remote-access",
          "threat.hunt-deep",
          "incident.response-readiness",
          "compliance.cis",
          "compliance.hipaa",
          "resilience.backup",
        ],
      },
    });

    expect(create.statusCode).toBe(201);
    const plan = create.json() as { id: string };

    const run = await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan.id}/run`,
    });

    expect(run.statusCode).toBe(200);
    const runBody = run.json() as { modules: Array<{ moduleId: string; status: string; error?: string }> };
    expect(runBody.modules).toHaveLength(11);
    expect(runBody.modules.every((item) => item.status === "running")).toBe(true);
    expect(runBody.modules.some((item) => item.error === "module_not_mapped")).toBe(false);

    await app.close();
  });
});
