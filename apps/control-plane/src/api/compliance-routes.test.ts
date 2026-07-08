import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("compliance routes", () => {
  it("lists all compliance packs", async () => {
    const app = buildApp();

    const res = await app.inject({ method: "GET", url: "/api/v1/compliance/packs" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { count: number; items: Array<{ id: string; shortName: string; controlCount: number }> };
    expect(body.count).toBe(5);
    expect(body.items.map((p) => p.id)).toEqual(
      expect.arrayContaining(["cis", "nist-csf", "iso-27001", "soc2", "pci-dss"]),
    );
    expect(body.items[0]?.controlCount).toBeGreaterThan(0);

    await app.close();
  });

  it("returns a full pack definition by id", async () => {
    const app = buildApp();

    const res = await app.inject({ method: "GET", url: "/api/v1/compliance/packs/cis" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; controls: Array<{ id: string }> };
    expect(body.id).toBe("cis");
    expect(body.controls.length).toBeGreaterThan(0);

    await app.close();
  });

  it("returns 404 for an unknown pack", async () => {
    const app = buildApp();

    const res = await app.inject({ method: "GET", url: "/api/v1/compliance/packs/unknown-pack" });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("evaluates a plan against a specific compliance pack", async () => {
    const app = buildApp();

    // Create and run a plan
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/plans",
      payload: {
        tenantId: "tenant-compliance",
        endpointId: "endpoint-compliance",
        operatorId: "operator-compliance",
        packageId: "standard",
        targetOs: "windows",
        executionLevel: "safe",
        modules: [
          "host.os-posture",
          "host.firewall-edr",
          "host.identity-admins",
          "identity.mfa-posture",
          "net.client-health",
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    const plan = create.json() as { id: string };

    await app.inject({ method: "POST", url: `/api/v1/secaudit/plans/${plan.id}/run` });

    // Supply client findings for the client-only module
    await app.inject({
      method: "POST",
      url: `/api/v1/secaudit/plans/${plan.id}/client-findings`,
      payload: {
        moduleId: "net.client-health",
        findings: { status: "ok", severity: "low" },
        evidence: ["ping=12ms"],
      },
    });

    // Poll results until plan reaches terminal state (local runner completes async)
    for (let i = 0; i < 10; i++) {
      const snap = await app.inject({ method: "GET", url: `/api/v1/secaudit/plans/${plan.id}/results` });
      const snapBody = snap.json() as { status: string };
      if (snapBody.status === "completed" || snapBody.status === "failed" || snapBody.status === "partial") break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const evalRes = await app.inject({
      method: "GET",
      url: `/api/v1/compliance/plans/${plan.id}/evaluate/cis`,
    });
    expect(evalRes.statusCode).toBe(200);
    const report = evalRes.json() as {
      packId: string;
      overallScore: number;
      controlsPassed: number;
      controlsFailed: number;
      controlsNotEvaluated: number;
      controls: Array<{ controlId: string; status: string; score: number }>;
    };

    expect(report.packId).toBe("cis");
    expect(typeof report.overallScore).toBe("number");
    expect(report.controls.length).toBeGreaterThan(0);
    // At minimum some controls cover the modules we ran
    const evaluated = report.controls.filter((c) => c.status !== "not_evaluated");
    expect(evaluated.length).toBeGreaterThan(0);

    await app.close();
  });

  it("evaluates a plan against all packs at once", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/secaudit/plans",
      payload: {
        tenantId: "tenant-all",
        endpointId: "endpoint-all",
        operatorId: "operator-all",
        packageId: "quick",
        targetOs: "windows",
        executionLevel: "safe",
        modules: ["host.os-posture", "host.firewall-edr"],
      },
    });
    const plan = create.json() as { id: string };
    await app.inject({ method: "POST", url: `/api/v1/secaudit/plans/${plan.id}/run` });

    const evalRes = await app.inject({
      method: "GET",
      url: `/api/v1/compliance/plans/${plan.id}/evaluate`,
    });
    expect(evalRes.statusCode).toBe(200);
    const body = evalRes.json() as {
      planId: string;
      reports: Array<{ packId: string; overallScore: number }>;
    };
    expect(body.planId).toBe(plan.id);
    expect(body.reports).toHaveLength(5);
    expect(body.reports.every((r) => typeof r.overallScore === "number")).toBe(true);

    await app.close();
  });

  it("returns 404 when plan does not exist", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/compliance/plans/nonexistent-plan/evaluate/cis",
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
