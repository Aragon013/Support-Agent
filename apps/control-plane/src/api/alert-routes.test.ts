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
        enabled: true,
      },
    });

    expect(create.statusCode).toBe(201);
    const ch = create.json() as { id: string; name: string; type: string };
    expect(ch.id).toMatch(/^alert_ch_/);
    expect(ch.name).toBe("Ops Slack");
    expect(ch.type).toBe("webhook");

    const list = await app.inject({ method: "GET", url: "/api/v1/alerts/channels" });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { count: number; items: Array<{ id: string }> };
    expect(body.count).toBeGreaterThan(0);
    expect(body.items.some((x) => x.id === ch.id)).toBe(true);

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
});
