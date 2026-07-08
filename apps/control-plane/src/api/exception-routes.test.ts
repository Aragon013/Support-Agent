import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // +30 days

describe("exception routes", () => {
  it("creates a pending exception", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/exceptions",
      payload: {
        tenantId: "tenant-1",
        planId: "secaudit_plan_1",
        moduleId: "host.firewall-edr",
        justification: "Legacy device — EDR not supported until Q3 upgrade.",
        requestedBy: "operator-alice",
        expiresAt: FUTURE_DATE,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; status: string; moduleId: string };
    expect(body.id).toMatch(/^exc_/);
    expect(body.status).toBe("pending");
    expect(body.moduleId).toBe("host.firewall-edr");

    await app.close();
  });

  it("rejects creation with past expiresAt", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/exceptions",
      payload: {
        tenantId: "tenant-1",
        planId: "plan-1",
        moduleId: "host.os-posture",
        justification: "Test",
        requestedBy: "operator-1",
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it("lists exceptions by plan", async () => {
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/api/v1/exceptions",
      payload: {
        tenantId: "tenant-1",
        planId: "plan-list-test",
        moduleId: "host.firewall-edr",
        justification: "Test exception",
        requestedBy: "operator-1",
        expiresAt: FUTURE_DATE,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/exceptions?planId=plan-list-test",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { count: number; items: Array<{ planId: string }> };
    expect(body.count).toBe(1);
    expect(body.items[0]?.planId).toBe("plan-list-test");

    await app.close();
  });

  it("approves a pending exception", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/exceptions",
      payload: {
        tenantId: "tenant-1",
        planId: "plan-approve",
        moduleId: "host.identity-admins",
        justification: "Approved for sprint-end window.",
        requestedBy: "operator-bob",
        expiresAt: FUTURE_DATE,
      },
    });

    const { id } = create.json() as { id: string };

    const review = await app.inject({
      method: "POST",
      url: `/api/v1/exceptions/${id}/review`,
      payload: { status: "approved", approvedBy: "operator-admin", notes: "Risk accepted." },
    });

    expect(review.statusCode).toBe(200);
    const body = review.json() as { status: string; approvedBy: string; notes: string };
    expect(body.status).toBe("approved");
    expect(body.approvedBy).toBe("operator-admin");
    expect(body.notes).toBe("Risk accepted.");

    await app.close();
  });

  it("rejects double-review of an already decided exception", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/exceptions",
      payload: {
        tenantId: "t",
        planId: "p",
        moduleId: "m",
        justification: "j",
        requestedBy: "r",
        expiresAt: FUTURE_DATE,
      },
    });

    const { id } = create.json() as { id: string };

    await app.inject({
      method: "POST",
      url: `/api/v1/exceptions/${id}/review`,
      payload: { status: "approved", approvedBy: "admin" },
    });

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/exceptions/${id}/review`,
      payload: { status: "rejected", approvedBy: "admin" },
    });

    expect(second.statusCode).toBe(409);

    await app.close();
  });

  it("checks active exception via /check endpoint", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/exceptions",
      payload: {
        tenantId: "tenant-check",
        planId: "plan-check",
        moduleId: "threat.hunt-lite",
        justification: "Threat hunting deferred.",
        requestedBy: "operator-check",
        expiresAt: FUTURE_DATE,
      },
    });

    const { id } = create.json() as { id: string };

    // Before approval — no active exception
    const beforeApproval = await app.inject({
      method: "GET",
      url: "/api/v1/exceptions/check?planId=plan-check&moduleId=threat.hunt-lite",
    });
    expect(beforeApproval.statusCode).toBe(200);
    expect((beforeApproval.json() as { hasActiveException: boolean }).hasActiveException).toBe(false);

    // Approve
    await app.inject({
      method: "POST",
      url: `/api/v1/exceptions/${id}/review`,
      payload: { status: "approved", approvedBy: "admin" },
    });

    const afterApproval = await app.inject({
      method: "GET",
      url: "/api/v1/exceptions/check?planId=plan-check&moduleId=threat.hunt-lite",
    });
    expect(afterApproval.statusCode).toBe(200);
    expect((afterApproval.json() as { hasActiveException: boolean }).hasActiveException).toBe(true);

    await app.close();
  });
});
