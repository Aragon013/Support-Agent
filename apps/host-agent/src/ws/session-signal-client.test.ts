import { describe, expect, it } from "vitest";

import {
  buildControlInputResultPayload,
  buildSessionSignalWsUrl,
  evaluateControlInputPolicy,
} from "./session-signal-client.js";

describe("session-signal-client helpers", () => {
  it("builds ws url with tenant and host participant filters", () => {
    const url = buildSessionSignalWsUrl(
      {
        controlPlaneUrl: "http://localhost:3000",
        tenantId: "tenant-1",
      },
      "session-1",
      12,
    );

    expect(url).toContain("ws://localhost:3000/api/v1/sessions/session-1/signal/ws?");
    expect(url).toContain("tenantId=tenant-1");
    expect(url).toContain("participantType=host");
    expect(url).toContain("sinceSeq=12");
  });

  it("denies input when feature flag is off", () => {
    const result = evaluateControlInputPolicy(
      {
        id: "session-1",
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        status: "signaling",
        accessMode: "control",
        requestedCapabilities: ["screen", "input"],
      },
      false,
    );

    expect(result).toEqual({ ok: false, code: "feature_disabled" });
  });

  it("denies input when session is not control mode", () => {
    const result = evaluateControlInputPolicy(
      {
        id: "session-1",
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        status: "signaling",
        accessMode: "view",
        requestedCapabilities: ["screen", "input"],
      },
      true,
    );

    expect(result).toEqual({ ok: false, code: "session_not_control_mode" });
  });

  it("denies input when capability is missing", () => {
    const result = evaluateControlInputPolicy(
      {
        id: "session-1",
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        status: "signaling",
        accessMode: "control",
        requestedCapabilities: ["screen"],
      },
      true,
    );

    expect(result).toEqual({ ok: false, code: "input_capability_missing" });
  });

  it("allows input only when session is active control with input capability", () => {
    const result = evaluateControlInputPolicy(
      {
        id: "session-1",
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        status: "connected_p2p",
        accessMode: "control",
        requestedCapabilities: ["screen", "input"],
      },
      true,
    );

    expect(result).toEqual({ ok: true });
  });

  it("builds accepted control input result payload with action and session status", () => {
    const payload = buildControlInputResultPayload({
      accepted: true,
      action: "mouse.move",
      sessionStatus: "connected_p2p",
      now: new Date("2026-07-06T12:00:00.000Z"),
    });

    expect(payload).toEqual({
      result: "accepted",
      action: "mouse.move",
      sessionStatus: "connected_p2p",
      handledAt: "2026-07-06T12:00:00.000Z",
    });
  });

  it("builds denied control input result payload with deny code", () => {
    const payload = buildControlInputResultPayload({
      accepted: false,
      action: "mouse.move",
      sessionStatus: "signaling",
      denyCode: "session_not_active",
      now: new Date("2026-07-06T12:00:00.000Z"),
    });

    expect(payload).toEqual({
      result: "denied",
      action: "mouse.move",
      sessionStatus: "signaling",
      denyCode: "session_not_active",
      handledAt: "2026-07-06T12:00:00.000Z",
    });
  });
});
