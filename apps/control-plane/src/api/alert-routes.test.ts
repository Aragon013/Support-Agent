import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("alert routes", () => {
  it("creates and lists alert channels", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/alerts/channels",
      payload: {
        name: "Ops Slack",
        type: "webhook",
        target: "https://example.com/webhook",
        authHeaderName: "Authorization",
        authToken: "Bearer supersecrettoken",
        enabled: true,
      },
    });

    expect(create.statusCode).toBe(201);
    const ch = create.json() as { id: string; name: string; type: string; auth?: { tokenMasked?: string } };
    expect(ch.id).toMatch(/^alert_ch_/);
    expect(ch.name).toBe("Ops Slack");
    expect(ch.type).toBe("webhook");
    expect(ch.auth?.tokenMasked).toBeDefined();
    expect(ch.auth?.tokenMasked).not.toContain("supersecrettoken");

    const list = await app.inject({ method: "GET", url: "/api/v1/alerts/channels" });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { count: number; items: Array<{ id: string; auth?: { tokenMasked?: string } }> };
    expect(body.count).toBeGreaterThan(0);
    expect(body.items.some((x) => x.id === ch.id)).toBe(true);
    const listed = body.items.find((x) => x.id === ch.id);
    expect(listed?.auth?.tokenMasked).toBeDefined();
    expect(listed?.auth?.tokenMasked).not.toContain("supersecrettoken");

    await app.close();
  });

  it("updates channel enabled flag", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/alerts/channels",
      payload: {
        name: "Email",
        type: "email",
        target: "secops@example.com",
      },
    });
    const { id } = create.json() as { id: string };

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/alerts/channels/${id}`,
      payload: { enabled: false },
    });

    expect(patch.statusCode).toBe(200);
    const body = patch.json() as { enabled: boolean };
    expect(body.enabled).toBe(false);

    await app.close();
  });

  it("allows setting and clearing auth credentials", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/alerts/channels",
      payload: {
        name: "Webhook",
        type: "webhook",
        target: "https://example.com/w",
      },
    });
    const { id } = create.json() as { id: string };

    const setAuth = await app.inject({
      method: "PATCH",
      url: `/api/v1/alerts/channels/${id}`,
      payload: { authHeaderName: "X-Api-Key", authToken: "abc123secret" },
    });
    expect(setAuth.statusCode).toBe(200);
    const withAuth = setAuth.json() as { auth?: { headerName?: string; tokenMasked?: string } };
    expect(withAuth.auth?.headerName).toBe("X-Api-Key");
    expect(withAuth.auth?.tokenMasked).not.toContain("abc123secret");

    const clearAuth = await app.inject({
      method: "PATCH",
      url: `/api/v1/alerts/channels/${id}`,
      payload: { clearAuth: true },
    });
    expect(clearAuth.statusCode).toBe(200);
    const noAuth = clearAuth.json() as { auth?: unknown };
    expect(noAuth.auth).toBeUndefined();

    await app.close();
  });

  it("dispatches test alert and records event", async () => {
    const app = buildApp();

    // email channel simulates sent delivery without network
    await app.inject({
      method: "POST",
      url: "/api/v1/alerts/channels",
      payload: {
        name: "Email",
        type: "email",
        target: "secops@example.com",
      },
    });

    const testSend = await app.inject({ method: "POST", url: "/api/v1/alerts/test" });
    expect(testSend.statusCode).toBe(200);
    const event = testSend.json() as { category: string; deliveries: Array<{ status: string }> };
    expect(event.category).toBe("test");
    expect(event.deliveries.length).toBeGreaterThan(0);

    const events = await app.inject({ method: "GET", url: "/api/v1/alerts/events" });
    expect(events.statusCode).toBe(200);
    const body = events.json() as { count: number };
    expect(body.count).toBeGreaterThan(0);

    await app.close();
  });

  it("rotates token and writes audit trail entries", async () => {
    const app = buildApp();
    const headers = {
      "x-tenant-id": "tenant-alerts",
      "x-operator-id": "operator-alerts",
    };

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/alerts/channels",
      headers,
      payload: {
        name: "Ops Webhook",
        type: "webhook",
        target: "https://example.com/ops",
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string };

    const rotate = await app.inject({
      method: "POST",
      url: `/api/v1/alerts/channels/${created.id}/rotate-token`,
      headers,
      payload: {
        authToken: "rotated-super-secret-token",
        authHeaderName: "X-Webhook-Token",
      },
    });
    expect(rotate.statusCode).toBe(200);
    const rotated = rotate.json() as { auth?: { headerName?: string; tokenMasked?: string } };
    expect(rotated.auth?.headerName).toBe("X-Webhook-Token");
    expect(rotated.auth?.tokenMasked).toBeDefined();
    expect(rotated.auth?.tokenMasked).not.toContain("rotated-super-secret-token");

    const audit = await app.inject({
      method: "GET",
      url: "/api/v1/audit?tenantId=tenant-alerts&operatorId=operator-alerts",
    });
    expect(audit.statusCode).toBe(200);
    const auditBody = audit.json() as { items: Array<{ code: string }> };
    expect(auditBody.items.some((x) => x.code === "alerts.channel.created")).toBe(true);
    expect(auditBody.items.some((x) => x.code === "alerts.channel.token_rotated")).toBe(true);

    await app.close();
  });
});
