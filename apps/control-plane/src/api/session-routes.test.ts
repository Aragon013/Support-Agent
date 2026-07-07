import { describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

describe("session routes", () => {
  it("blocks viewer role from creating sessions", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "viewer",
        "x-endpoint-status": "online",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toBe("role_insufficient");

    await app.close();
  });

  it("creates pending_approval session when unattended is disabled", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        accessMode: "control",
        requestedCapabilities: ["screen", "input"],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("pending_approval");
    expect(body.approvalRequired).toBe(true);

    await app.close();
  });

  it("approves pending session and moves it to signaling", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });

    const id = create.json().sessionId as string;

    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${id}/approve`,
    });

    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe("signaling");

    await app.close();
  });

  it("denies pending session and ends it", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });

    const id = create.json().sessionId as string;

    const deny = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${id}/deny`,
      payload: {
        reason: "user_denied",
      },
    });

    expect(deny.statusCode).toBe(200);
    expect(deny.json().status).toBe("ended");

    await app.close();
  });

  it("prevents second active control session on same endpoint", async () => {
    const app = buildApp();

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        accessMode: "control",
      },
    });

    expect(first.statusCode).toBe(201);
    expect(first.json().status).toBe("signaling");

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-2",
        accessMode: "control",
      },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("endpoint_busy");

    await app.close();
  });
});
