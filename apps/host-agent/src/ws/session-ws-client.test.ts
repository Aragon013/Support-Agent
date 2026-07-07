import { describe, expect, it } from "vitest";
import {
  buildSessionWsUrl,
  shouldAutoApproveSession,
} from "./session-ws-client.js";

describe("session-ws-client helpers", () => {
  it("builds ws url with tenant and endpoint filters", () => {
    const url = buildSessionWsUrl({
      controlPlaneUrl: "http://localhost:3000",
      tenantId: "tenant-1",
      endpointId: "endpoint-1",
    });

    expect(url).toContain("ws://localhost:3000/api/v1/sessions/events/ws?");
    expect(url).toContain("tenantId=tenant-1");
    expect(url).toContain("endpointId=endpoint-1");
  });

  it("decides auto-approval only for approval-required events", () => {
    expect(shouldAutoApproveSession("session.approval.required", true)).toBe(true);
    expect(shouldAutoApproveSession("session.created", true)).toBe(false);
    expect(shouldAutoApproveSession("session.approval.required", false)).toBe(false);
  });
});
