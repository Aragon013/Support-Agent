import { describe, it, expect } from "vitest";
import {
  evaluateControlInputPolicy,
  buildControlInputResultPayload,
  buildSessionSignalWsUrl,
} from "./session-signal-client.js";

describe("Session Signal Client Integration", () => {
  describe("evaluateControlInputPolicy", () => {
    const makeSession = (overrides?: any) => ({
      id: "sess-123",
      tenantId: "tenant-1",
      endpointId: "host-1",
      status: "connected_p2p" as any,
      accessMode: "control" as any,
      requestedCapabilities: ["screen", "input", "clipboard"],
      ...overrides,
    });

    it("allows input when all conditions are met", () => {
      const result = evaluateControlInputPolicy(makeSession(), true);
      expect(result.ok).toBe(true);
    });

    it("denies when allowRemoteInput is false", () => {
      const result = evaluateControlInputPolicy(makeSession(), false);
      expect(result.ok).toBe(false);
      expect((result as any).code).toBe("feature_disabled");
    });

    it("denies when session is ended", () => {
      const result = evaluateControlInputPolicy(makeSession({ status: "ended" }), true);
      expect(result.ok).toBe(false);
      expect((result as any).code).toBe("session_not_active");
    });

    it("denies when session is failed", () => {
      const result = evaluateControlInputPolicy(makeSession({ status: "failed" }), true);
      expect(result.ok).toBe(false);
      expect((result as any).code).toBe("session_not_active");
    });

    it("denies when accessMode is not 'control'", () => {
      const result = evaluateControlInputPolicy(makeSession({ accessMode: "view" }), true);
      expect(result.ok).toBe(false);
      expect((result as any).code).toBe("session_not_control_mode");
    });

    it("denies when input capability is not requested", () => {
      const result = evaluateControlInputPolicy(
        makeSession({ requestedCapabilities: ["screen", "clipboard"] }),
        true,
      );
      expect(result.ok).toBe(false);
      expect((result as any).code).toBe("input_capability_missing");
    });

    it("allows input in reconnecting state", () => {
      const result = evaluateControlInputPolicy(makeSession({ status: "reconnecting" }), true);
      expect(result.ok).toBe(true);
    });

    it("allows input in connected_relay state", () => {
      const result = evaluateControlInputPolicy(makeSession({ status: "connected_relay" }), true);
      expect(result.ok).toBe(true);
    });
  });

  describe("buildControlInputResultPayload", () => {
    it("builds accepted payload with all fields", () => {
      const payload = buildControlInputResultPayload({
        accepted: true,
        action: "mouse.move",
        sessionStatus: "connected_p2p",
      });

      expect(payload.result).toBe("accepted");
      expect(payload.action).toBe("mouse.move");
      expect(payload.sessionStatus).toBe("connected_p2p");
      expect(payload.handledAt).toBeDefined();
      expect(typeof payload.handledAt).toBe("string");
      expect((payload as any).denyCode).toBeUndefined();
    });

    it("builds accepted payload without optional fields", () => {
      const payload = buildControlInputResultPayload({
        accepted: true,
      });

      expect(payload.result).toBe("accepted");
      expect((payload as any).action).toBeUndefined();
      expect((payload as any).sessionStatus).toBeUndefined();
      expect((payload as any).denyCode).toBeUndefined();
      expect(payload.handledAt).toBeDefined();
    });

    it("builds denied payload with denyCode", () => {
      const payload = buildControlInputResultPayload({
        accepted: false,
        denyCode: "out_of_bounds",
        action: "mouse.move",
      });

      expect(payload.result).toBe("denied");
      expect(payload.denyCode).toBe("out_of_bounds");
      expect(payload.action).toBe("mouse.move");
      expect(payload.handledAt).toBeDefined();
    });

    it("uses provided timestamp", () => {
      const now = new Date("2024-01-15T10:30:00Z");
      const payload = buildControlInputResultPayload({
        accepted: true,
        now,
      });

      expect(payload.handledAt).toBe("2024-01-15T10:30:00.000Z");
    });

    it("uses current timestamp when not provided", () => {
      const beforeCall = new Date();
      const payload = buildControlInputResultPayload({
        accepted: true,
      });
      const afterCall = new Date();

      const handledAt = new Date(payload.handledAt);
      expect(handledAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(handledAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });

    it("excludes optional fields when not provided", () => {
      const payload = buildControlInputResultPayload({
        accepted: false,
      });

      expect(payload.result).toBe("denied");
      expect((payload as any).action).toBeUndefined();
      expect((payload as any).sessionStatus).toBeUndefined();
      expect((payload as any).denyCode).toBeUndefined();
    });
  });

  describe("buildSessionSignalWsUrl", () => {
    const cfg = {
      controlPlaneUrl: "http://localhost:3000",
      tenantId: "tenant-1",
    };

    it("converts http to ws protocol", () => {
      const url = buildSessionSignalWsUrl(cfg, "sess-123");
      expect(url).toMatch(/^ws:\/\//);
    });

    it("converts https to wss protocol", () => {
      const httpsUrl = buildSessionSignalWsUrl(
        { ...cfg, controlPlaneUrl: "https://api.example.com" },
        "sess-456",
      );
      expect(httpsUrl).toMatch(/^wss:\/\//);
    });

    it("includes sessionId in path", () => {
      const url = buildSessionSignalWsUrl(cfg, "sess-123");
      expect(url).toContain("/sessions/sess-123/signal/ws");
    });

    it("includes tenantId as query parameter", () => {
      const url = buildSessionSignalWsUrl(cfg, "sess-123");
      expect(url).toContain("tenantId=tenant-1");
    });

    it("includes participantType=host as query parameter", () => {
      const url = buildSessionSignalWsUrl(cfg, "sess-123");
      expect(url).toContain("participantType=host");
    });

    it("includes sinceSeq=0 by default", () => {
      const url = buildSessionSignalWsUrl(cfg, "sess-123");
      expect(url).toContain("sinceSeq=0");
    });

    it("uses provided sinceSeq parameter", () => {
      const url = buildSessionSignalWsUrl(cfg, "sess-123", 42);
      expect(url).toContain("sinceSeq=42");
    });

    it("handles negative sinceSeq by treating as 0", () => {
      const url = buildSessionSignalWsUrl(cfg, "sess-123", -10);
      expect(url).toContain("sinceSeq=0");
    });

    it("removes trailing slash from controlPlaneUrl", () => {
      const urlWithSlash = buildSessionSignalWsUrl(
        { ...cfg, controlPlaneUrl: "http://localhost:3000/" },
        "sess-123",
      );
      expect(urlWithSlash).not.toContain("//signal");
    });

    it("builds complete valid URL", () => {
      const url = buildSessionSignalWsUrl(cfg, "sess-789", 5);
      const parsed = new URL(url);

      expect(parsed.protocol).toBe("ws:");
      expect(parsed.hostname).toBe("localhost");
      expect(parsed.port).toBe("3000");
      expect(parsed.pathname).toBe("/api/v1/sessions/sess-789/signal/ws");
      expect(parsed.searchParams.get("tenantId")).toBe("tenant-1");
      expect(parsed.searchParams.get("participantType")).toBe("host");
      expect(parsed.searchParams.get("sinceSeq")).toBe("5");
    });
  });
});
