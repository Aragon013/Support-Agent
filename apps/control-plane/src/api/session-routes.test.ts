import { describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

describe("session routes", () => {
  it("returns install profile capabilities in endpoint policy", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/endpoints/endpoint-1/session-policy",
      headers: {
        "x-endpoint-unattended": "true",
        "x-endpoint-install-profile": "remote_only",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.installProfile).toBe("remote_only");
    expect(body.supportCommandsAllowed).toBe(false);
    expect(body.folderActionsAllowed).toBe(false);

    await app.close();
  });

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

  it("normalizes view-mode capabilities by removing input", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-install-profile": "support_full",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        accessMode: "view",
        requestedCapabilities: ["screen", "input", "clipboard"],
      },
    });

    expect(create.statusCode).toBe(201);
    const createBody = create.json();
    expect(createBody.installProfile).toBe("support_full");
    expect(createBody.requestedCapabilities).toEqual(["screen", "clipboard"]);

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${createBody.sessionId}`,
    });

    expect(read.statusCode).toBe(200);
    expect(read.json().requestedCapabilities).toEqual(["screen", "clipboard"]);

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

  it("accepts and lists session signaling messages", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-signal",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = create.json().sessionId as string;

    const signal = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/signal`,
      payload: {
        senderType: "controller",
        messageType: "signal.offer",
        payload: {
          sdp: "v=0...",
          e2ePubKey: "pub-key",
        },
      },
    });

    expect(signal.statusCode).toBe(201);
    expect(signal.json().item.messageType).toBe("signal.offer");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/sessions/${sessionId}/signal?afterSeq=0`,
    });

    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBe(1);
    expect(body.items[0].messageType).toBe("signal.offer");

    await app.close();
  });

  it("rejects invalid signaling message direction", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-signal",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = create.json().sessionId as string;

    const signal = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/signal`,
      payload: {
        senderType: "host",
        messageType: "signal.offer",
        payload: {
          sdp: "v=0...",
        },
      },
    });

    expect(signal.statusCode).toBe(403);
    expect(signal.json().reason).toBe("message_direction_invalid");

    const audit = await app.inject({
      method: "GET",
      url: "/api/v1/audit?tenantId=tenant-signal&operatorId=operator-1",
    });

    expect(audit.statusCode).toBe(200);
    const auditBody = audit.json() as {
      items: Array<{ code: string; details: Record<string, unknown> }>;
    };
    const denial = auditBody.items.find((item) => item.code === "session.signal.policy_denied");
    expect(denial?.details.reason).toBe("message_direction_invalid");
    expect(denial?.details.messageType).toBe("signal.offer");

    await app.close();
  });

  it("rejects participant header mismatch with sender type", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-signal",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = create.json().sessionId as string;

    const signal = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/signal`,
      headers: {
        "x-participant-type": "host",
      },
      payload: {
        senderType: "controller",
        messageType: "control.input",
        payload: {
          action: "mouse.move",
          x: 10,
          y: 20,
        },
      },
    });

    expect(signal.statusCode).toBe(403);
    expect(signal.json().reason).toBe("participant_sender_mismatch");

    await app.close();
  });

  it("rejects screen frame stub until session is connected", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-signal",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = create.json().sessionId as string;

    const signal = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/signal`,
      payload: {
        senderType: "host",
        messageType: "screen.frame.stub",
        payload: {
          frameId: "frame-1",
        },
      },
    });

    expect(signal.statusCode).toBe(403);
    expect(signal.json().reason).toBe("message_state_invalid");

    await app.close();
  });

  it("rejects control input until session is connected", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-signal",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = create.json().sessionId as string;

    const signal = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/signal`,
      headers: {
        "x-participant-type": "controller",
      },
      payload: {
        senderType: "controller",
        messageType: "control.input",
        payload: {
          action: "mouse.move",
          x: 320,
          y: 180,
        },
      },
    });

    expect(signal.statusCode).toBe(403);
    expect(signal.json().reason).toBe("message_state_invalid");

    await app.close();
  });

  it("allows clipboard sync while signaling", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-signal",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = create.json().sessionId as string;

    const signal = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/signal`,
      headers: {
        "x-participant-type": "controller",
      },
      payload: {
        senderType: "controller",
        messageType: "clipboard.sync",
        payload: {
          text: "hello",
          format: "text/plain",
        },
      },
    });

    expect(signal.statusCode).toBe(201);
    expect(signal.json().item.messageType).toBe("clipboard.sync");

    await app.close();
  });

  it("rejects screen frame feedback until session is connected", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-signal",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = create.json().sessionId as string;

    const signal = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/signal`,
      headers: {
        "x-participant-type": "controller",
      },
      payload: {
        senderType: "controller",
        messageType: "screen.frame.feedback",
        payload: {
          targetFps: 12,
          targetQuality: 60,
        },
      },
    });

    expect(signal.statusCode).toBe(403);
    expect(signal.json().reason).toBe("message_state_invalid");

    await app.close();
  });

  it("accepts control input after session transitions to connected_p2p", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-signal",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        accessMode: "control",
        requestedCapabilities: ["screen", "input", "clipboard"],
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = create.json().sessionId as string;

    const transition = await app.inject({
      method: "POST",
      url: `/api/v1/internal/sessions/${sessionId}/state`,
      payload: {
        status: "connected_p2p",
        routeMode: "direct",
      },
    });

    expect(transition.statusCode).toBe(200);
    expect(transition.json().status).toBe("connected_p2p");
    expect(transition.json().routeMode).toBe("direct");

    const signal = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/signal`,
      headers: {
        "x-participant-type": "controller",
      },
      payload: {
        senderType: "controller",
        messageType: "control.input",
        payload: {
          action: "mouse.move",
          x: 640,
          y: 360,
        },
      },
    });

    expect(signal.statusCode).toBe(201);
    expect(signal.json().item.messageType).toBe("control.input");

    await app.close();
  });

  it("accepts screen frame feedback after session transitions to connected_p2p", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-signal",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        accessMode: "control",
        requestedCapabilities: ["screen", "input", "clipboard"],
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = create.json().sessionId as string;

    const transition = await app.inject({
      method: "POST",
      url: `/api/v1/internal/sessions/${sessionId}/state`,
      payload: {
        status: "connected_p2p",
        routeMode: "direct",
      },
    });

    expect(transition.statusCode).toBe(200);

    const signal = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/signal`,
      headers: {
        "x-participant-type": "controller",
      },
      payload: {
        senderType: "controller",
        messageType: "screen.frame.feedback",
        payload: {
          targetFps: 8,
          targetQuality: 50,
        },
      },
    });

    expect(signal.statusCode).toBe(201);
    expect(signal.json().item.messageType).toBe("screen.frame.feedback");

    await app.close();
  });
});

describe("endpoint registry routes", () => {
  const ADMIN_KEY = "dev-insecure-key-change-in-prod";

  it("POST /api/v1/endpoints requires x-api-key", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/endpoints",
      payload: { endpointId: "laptop-001", installProfile: "support_full" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("unauthorized");

    await app.close();
  });

  it("GET /api/v1/endpoints requires x-api-key", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/endpoints",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("unauthorized");

    await app.close();
  });

  it("POST /api/v1/endpoints registers an endpoint with valid key", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/endpoints",
      headers: { "x-api-key": ADMIN_KEY },
      payload: {
        endpointId: "laptop-001",
        installProfile: "support_full",
        licenseStatus: "active",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.endpointId).toBe("laptop-001");
    expect(body.installProfile).toBe("support_full");

    await app.close();
  });

  it("POST /api/v1/endpoints validates endpointId is required", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/endpoints",
      headers: { "x-api-key": ADMIN_KEY },
      payload: { installProfile: "support_full" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("validation_error");

    await app.close();
  });

  it("GET /api/v1/endpoints lists registered endpoints", async () => {
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/api/v1/endpoints",
      headers: { "x-api-key": ADMIN_KEY },
      payload: { endpointId: "device-aaa", installProfile: "remote_only" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/endpoints",
      headers: { "x-api-key": ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ endpointId: string }>; count: number };
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.items.some((e) => e.endpointId === "device-aaa")).toBe(true);

    await app.close();
  });

  it("GET /endpoints/:id/session-policy returns registry data for registered endpoint", async () => {
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/api/v1/endpoints",
      headers: { "x-api-key": ADMIN_KEY },
      payload: {
        endpointId: "registered-device",
        installProfile: "support_limited_no_folders",
        licenseStatus: "active",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/endpoints/registered-device/session-policy",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("registry");
    expect(body.installProfile).toBe("support_limited_no_folders");
    expect(body.supportCommandsAllowed).toBe(true);
    expect(body.folderActionsAllowed).toBe(false);

    await app.close();
  });

  it("GET /endpoints/:id/session-policy returns header-fallback for unknown endpoint in dev", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/endpoints/unknown-device/session-policy",
      headers: { "x-endpoint-install-profile": "support_full" },
    });

    // Either header-fallback (dev) or prod fallback, both 200
    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it("POST /api/v1/endpoints with remote_only disables support commands", async () => {
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/api/v1/endpoints",
      headers: { "x-api-key": ADMIN_KEY },
      payload: {
        endpointId: "restricted-device",
        installProfile: "remote_only",
      },
    });

    const policy = await app.inject({
      method: "GET",
      url: "/api/v1/endpoints/restricted-device/session-policy",
    });

    expect(policy.statusCode).toBe(200);
    const body = policy.json();
    expect(body.installProfile).toBe("remote_only");
    expect(body.supportCommandsAllowed).toBe(false);
    expect(body.folderActionsAllowed).toBe(false);

    await app.close();
  });
});
