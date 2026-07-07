import { describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

describe("QA-01 security pack", () => {
  it("rejects command injection-like serviceId payload", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-sec",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "maintenance.service.restart",
        requestedParams: {
          serviceId: "Spooler; shutdown -s",
        },
      },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("invalid_command_params");
    expect(body.errors.some((e: string) => e.includes("serviceId has invalid format"))).toBe(true);

    await app.close();
  });

  it("rejects unknown extra params to avoid schema bypass", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-sec",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
        requestedParams: {
          shell: "cmd.exe /c whoami",
        },
      },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("invalid_command_params");
    expect(body.errors.some((e: string) => e.includes("shell is not allowed"))).toBe(true);

    await app.close();
  });

  it("does not allow role bypass on high-risk command even with x-mfa-verified", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      headers: {
        "x-operator-role": "tech",
        "x-mfa-verified": "true",
      },
      payload: {
        tenantId: "tenant-sec",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "maintenance.network.reset",
        requestedParams: {
          mode: "soft",
        },
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe("policy_denied");
    expect(body.reason).toBe("role_insufficient");

    await app.close();
  });

  it("does not allow license bypass even with x-mfa-verified", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      headers: {
        "x-endpoint-license-status": "inactive",
        "x-operator-role": "admin",
        "x-mfa-verified": "true",
      },
      payload: {
        tenantId: "tenant-sec",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "maintenance.network.reset",
        requestedParams: {
          mode: "soft",
        },
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe("policy_denied");
    expect(body.reason).toBe("license_inactive");

    await app.close();
  });

  it("does not accept fake MFA token header for high-risk command", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      headers: {
        "x-operator-role": "admin",
        "x-mfa-token": "forged-token",
      },
      payload: {
        tenantId: "tenant-sec",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "maintenance.network.reset",
        requestedParams: {
          mode: "full",
        },
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("mfa_pending");
    expect(body.reason).toBe("mfa_required");

    await app.close();
  });
});
