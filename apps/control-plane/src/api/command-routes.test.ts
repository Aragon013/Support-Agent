import { describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

describe("command routes policy integration", () => {
  it("returns 422 when command params are invalid", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "maintenance.service.restart",
        requestedParams: {
          badField: true,
        },
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.code).toBe("invalid_command_params");
    expect(Array.isArray(body.errors)).toBe(true);

    await app.close();
  });

  it("returns 403 when endpoint license is inactive", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      headers: {
        "x-endpoint-license-status": "inactive",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.code).toBe("policy_denied");
    expect(body.reason).toBe("license_inactive");

    await app.close();
  });

  it("returns 403 when endpoint install profile is remote_only", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      headers: {
        "x-endpoint-install-profile": "remote_only",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.code).toBe("policy_denied");
    expect(body.reason).toBe("install_profile_remote_only");

    await app.close();
  });

  it("returns 202 and mfa_pending for high risk when MFA is missing", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      headers: {
        "x-operator-role": "admin",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "maintenance.network.reset",
        requestedParams: {
          mode: "soft",
        },
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.status).toBe("mfa_pending");
    expect(body.requiresMfa).toBe(true);
    expect(body.reason).toBe("mfa_required");
    expect(body.mfaRequired).toBe(true);

    await app.close();
  });

  it("returns 201 queued when MFA token is verified for high risk", async () => {
    const app = buildApp();

    const challenge = await app.inject({
      method: "POST",
      url: "/api/v1/mfa/challenges",
      payload: {
        tenantId: "tenant-1",
        operatorId: "operator-1",
      },
    });
    expect(challenge.statusCode).toBe(201);
    const challengeBody = challenge.json();

    const verify = await app.inject({
      method: "POST",
      url: `/api/v1/mfa/challenges/${challengeBody.challengeId}/verify`,
      payload: {
        tenantId: "tenant-1",
        operatorId: "operator-1",
        otp: "000000",
      },
    });
    expect(verify.statusCode).toBe(200);
    const verifyBody = verify.json();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      headers: {
        "x-operator-role": "admin",
        "x-mfa-token": verifyBody.mfaToken,
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "maintenance.network.reset",
        requestedParams: {
          mode: "soft",
        },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("queued");
    expect(body.requiresMfa).toBe(false);

    await app.close();
  });

  it("creates and verifies MFA challenge endpoints", async () => {
    const app = buildApp();

    const challenge = await app.inject({
      method: "POST",
      url: "/api/v1/mfa/challenges",
      payload: {
        tenantId: "tenant-1",
        operatorId: "operator-1",
      },
    });

    expect(challenge.statusCode).toBe(201);
    const challengeBody = challenge.json();
    expect(typeof challengeBody.challengeId).toBe("string");

    const verify = await app.inject({
      method: "POST",
      url: `/api/v1/mfa/challenges/${challengeBody.challengeId}/verify`,
      payload: {
        tenantId: "tenant-1",
        operatorId: "operator-1",
        otp: "000000",
      },
    });

    expect(verify.statusCode).toBe(200);
    const verifyBody = verify.json();
    expect(typeof verifyBody.mfaToken).toBe("string");

    await app.close();
  });

  it("returns 201 queued when medium-risk command has valid params", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      headers: {
        "x-operator-role": "tech",
      },
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "maintenance.service.restart",
        requestedParams: {
          serviceId: "Spooler",
        },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("queued");
    expect(body.riskLevel).toBe("medium");

    await app.close();
  });

  it("emits v1 lifecycle events and command.init envelope in order", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });

    expect(create.statusCode).toBe(201);
    const createdBody = create.json();

    const events = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${createdBody.id}/events`,
    });

    expect(events.statusCode).toBe(200);
    const eventsBody = events.json();
    expect(Array.isArray(eventsBody.items)).toBe(true);
    expect(eventsBody.items.length).toBe(1);
    expect(eventsBody.items[0].name).toBe("command.job.queued");

    const channel = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${createdBody.id}/channel-messages`,
    });
    expect(channel.statusCode).toBe(200);
    const channelBody = channel.json();
    expect(Array.isArray(channelBody.items)).toBe(true);
    expect(channelBody.items.length).toBe(1);
    expect(channelBody.items[0].v).toBe(1);
    expect(channelBody.items[0].kind).toBe("command.init");

    await app.close();
  });

  it("writes audit trail with redacted sensitive fields", async () => {
    const app = buildApp();

    const challenge = await app.inject({
      method: "POST",
      url: "/api/v1/mfa/challenges",
      payload: {
        tenantId: "tenant-1",
        operatorId: "operator-1",
      },
    });
    expect(challenge.statusCode).toBe(201);
    const challengeBody = challenge.json();

    const verify = await app.inject({
      method: "POST",
      url: `/api/v1/mfa/challenges/${challengeBody.challengeId}/verify`,
      payload: {
        tenantId: "tenant-1",
        operatorId: "operator-1",
        otp: "wrong-otp",
      },
    });
    expect(verify.statusCode).toBe(403);

    const audit = await app.inject({
      method: "GET",
      url: "/api/v1/audit?tenantId=tenant-1&operatorId=operator-1",
    });

    expect(audit.statusCode).toBe(200);
    const auditBody = audit.json();
    expect(auditBody.retentionDays).toBe(90);
    expect(Array.isArray(auditBody.items)).toBe(true);
    const failed = auditBody.items.find(
      (x: { code: string; details: Record<string, unknown> }) =>
        x.code === "command.mfa.challenge.failed",
    );
    expect(failed).toBeTruthy();
    expect(failed?.details?.otp).toBe("[REDACTED]");

    await app.close();
  });

  it("emits abort envelope and audit when cancelled", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });
    expect(create.statusCode).toBe(201);
    const createdBody = create.json();

    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/commands/jobs/${createdBody.id}/cancel`,
    });
    expect(cancel.statusCode).toBe(200);

    const channel = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${createdBody.id}/channel-messages`,
    });
    const channelBody = channel.json();
    expect(channelBody.items.some((x: { kind: string }) => x.kind === "command.abort")).toBe(true);

    const audit = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${createdBody.id}/audit`,
    });
    const auditBody = audit.json();
    expect(auditBody.items.some((x: { code: string }) => x.code === "command.job.cancelled")).toBe(true);

    await app.close();
  });

  it("runs retention purge and returns per-tenant report", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-retention",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });
    expect(create.statusCode).toBe(201);

    const purge = await app.inject({
      method: "POST",
      url: "/api/v1/internal/retention/purge",
      payload: {
        retentionDays: 0,
      },
    });

    expect(purge.statusCode).toBe(200);
    const body = purge.json();
    expect(body.policy.retentionDays).toBe(0);
    expect(body.report.totalPurged).toBeGreaterThan(0);
    expect(body.report.byTenant["tenant-retention"]).toBeGreaterThan(0);

    await app.close();
  });

  it("preserves base events according to retention policy", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-preserve",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });
    expect(create.statusCode).toBe(201);
    const createdBody = create.json();

    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/commands/jobs/${createdBody.id}/cancel`,
    });
    expect(cancel.statusCode).toBe(200);

    const purge = await app.inject({
      method: "POST",
      url: "/api/v1/internal/retention/purge",
      payload: {
        retentionDays: 0,
      },
    });
    expect(purge.statusCode).toBe(200);

    const audit = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${createdBody.id}/audit`,
    });
    expect(audit.statusCode).toBe(200);
    const auditBody = audit.json();
    expect(
      auditBody.items.some(
        (x: { code: string }) => x.code === "command.job.cancelled",
      ),
    ).toBe(true);

    const channel = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${createdBody.id}/channel-messages`,
    });
    expect(channel.statusCode).toBe(200);
    const channelBody = channel.json();
    expect(
      channelBody.items.some(
        (x: { kind: string }) => x.kind === "command.abort",
      ),
    ).toBe(true);

    await app.close();
  });

  it("simulates runner success and emits full lifecycle with stdout/exit", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-runner",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();

    const run = await app.inject({
      method: "POST",
      url: `/api/v1/internal/commands/jobs/${created.id}/run`,
      payload: {
        outcome: "completed",
      },
    });

    expect(run.statusCode).toBe(200);
    const runBody = run.json();
    expect(runBody.status).toBe("completed");
    expect(runBody.exitCode).toBe(0);

    const events = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${created.id}/events`,
    });
    const eventsBody = events.json();
    const names = eventsBody.items.map((x: { name: string }) => x.name);
    expect(names).toContain("command.job.dispatched");
    expect(names).toContain("command.job.running");
    expect(names).toContain("command.job.streaming");
    expect(names).toContain("command.job.verifying");
    expect(names).toContain("command.job.completed");

    const channel = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${created.id}/channel-messages`,
    });
    const channelBody = channel.json();
    const kinds = channelBody.items.map((x: { kind: string }) => x.kind);
    expect(kinds).toContain("command.stdout");
    expect(kinds).toContain("command.exit");

    await app.close();
  });

  it("simulates runner failure and emits failed lifecycle with stderr/abort", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-runner-fail",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();

    const run = await app.inject({
      method: "POST",
      url: `/api/v1/internal/commands/jobs/${created.id}/run`,
      payload: {
        outcome: "failed",
        failReason: "timeout_in_runner",
      },
    });

    expect(run.statusCode).toBe(200);
    const runBody = run.json();
    expect(runBody.status).toBe("failed");
    expect(runBody.exitCode).toBe(1);

    const channel = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${created.id}/channel-messages`,
    });
    const channelBody = channel.json();
    const kinds = channelBody.items.map((x: { kind: string }) => x.kind);
    expect(kinds).toContain("command.stderr");
    expect(kinds).toContain("command.abort");

    await app.close();
  });

  it("accepts host run report with chunk stream and digest metadata", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-report",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();

    const report = await app.inject({
      method: "POST",
      url: `/api/v1/internal/commands/jobs/${created.id}/report`,
      payload: {
        status: "completed",
        output: {
          stdout: ["line one", "line two"],
          stderr: ["warn one"],
          exitCode: 0,
        },
        digestSha256: "abc123",
        outputBytes: 24,
        truncated: false,
      },
    });

    expect(report.statusCode).toBe(200);
    const reportBody = report.json();
    expect(reportBody.status).toBe("completed");

    const channel = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${created.id}/channel-messages`,
    });
    expect(channel.statusCode).toBe(200);
    const channelBody = channel.json();
    const stdoutChunks = channelBody.items.filter(
      (x: { kind: string }) => x.kind === "command.stdout",
    );
    const stderrChunks = channelBody.items.filter(
      (x: { kind: string }) => x.kind === "command.stderr",
    );
    expect(stdoutChunks.length).toBe(2);
    expect(stderrChunks.length).toBe(1);

    const audit = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${created.id}/audit`,
    });
    expect(audit.statusCode).toBe(200);
    const auditBody = audit.json();
    const completed = auditBody.items.find(
      (x: { code: string }) => x.code === "command.job.completed",
    );
    expect(completed?.details?.digestSha256).toBe("abc123");
    expect(completed?.details?.outputBytes).toBe(24);

    await app.close();
  });
});
