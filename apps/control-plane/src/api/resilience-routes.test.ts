import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const adminHeaders = { "x-api-key": "dev-insecure-key-change-in-prod" };

describe("resilience routes", () => {
  it("lists seeded scopes and profiles", async () => {
    const app = buildApp();

    const scopes = await app.inject({ method: "GET", url: "/api/v1/resilience/scopes", headers: adminHeaders });
    expect(scopes.statusCode).toBe(200);
    const scopeBody = scopes.json() as { count: number; items: Array<{ id: string }> };
    expect(scopeBody.count).toBeGreaterThan(0);
    expect(scopeBody.items[0]?.id).toBeDefined();

    const profiles = await app.inject({ method: "GET", url: "/api/v1/resilience/profiles", headers: adminHeaders });
    expect(profiles.statusCode).toBe(200);
    const profileBody = profiles.json() as { count: number; items: Array<{ id: string }> };
    expect(profileBody.count).toBeGreaterThan(0);
    expect(profileBody.items.some((item) => item.id === "stress-guarded")).toBe(true);

    await app.close();
  });

  it("creates a scope and plans a dry-run resilience exercise", async () => {
    const app = buildApp();

    const createScope = await app.inject({
      method: "POST",
      url: "/api/v1/resilience/scopes",
      headers: adminHeaders,
      payload: {
        label: "Branch Wi-Fi",
        kind: "wireless",
        targetRef: "ssid://branch-01",
        authorizedBy: "security-team",
        expiresAt: "2027-01-01T00:00:00.000Z",
        notes: "Approved for planning only",
        limits: { maxRps: 800, maxConcurrency: 120, maxDurationMinutes: 15 },
      },
    });
    expect(createScope.statusCode).toBe(201);
    const scope = createScope.json() as { id: string };

    const createExercise = await app.inject({
      method: "POST",
      url: "/api/v1/resilience/exercises",
      headers: adminHeaders,
      payload: {
        scopeId: scope.id,
        profileId: "stress-guarded",
        tenantId: "tenant-1",
        operatorId: "operator-1",
        ticketRef: "CHG-123",
        rationale: "Validate resilience runbook",
        disclaimerAccepted: true,
        mode: "dry-run",
      },
    });
    expect(createExercise.statusCode).toBe(201);
    const exercise = createExercise.json() as { mode: string; status: string; plan: { targetRps: number }; disclaimer: string };
    expect(exercise.mode).toBe("dry-run");
    expect(exercise.status).toBe("planned");
    expect(exercise.plan.targetRps).toBeGreaterThan(0);
    expect(exercise.disclaimer).toContain("Dry-run only");

    const list = await app.inject({ method: "GET", url: "/api/v1/resilience/exercises", headers: adminHeaders });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { count: number };
    expect(listBody.count).toBeGreaterThan(0);

    await app.close();
  });

  it("rejects exercise planning when disclaimer is not accepted", async () => {
    const app = buildApp();

    const scopes = await app.inject({ method: "GET", url: "/api/v1/resilience/scopes", headers: adminHeaders });
    const scope = (scopes.json() as { items: Array<{ id: string }> }).items[0];

    const createExercise = await app.inject({
      method: "POST",
      url: "/api/v1/resilience/exercises",
      headers: adminHeaders,
      payload: {
        scopeId: scope?.id,
        profileId: "baseline-canary",
        tenantId: "tenant-1",
        operatorId: "operator-1",
        ticketRef: "CHG-124",
        rationale: "Should be denied",
        disclaimerAccepted: false,
        mode: "dry-run",
      },
    });
    expect(createExercise.statusCode).toBe(422);

    await app.close();
  });
});
