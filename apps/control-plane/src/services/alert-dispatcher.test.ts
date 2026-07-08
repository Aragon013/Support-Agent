import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";

import { InMemoryAlertStore } from "../domain/alert-store.js";
import { AlertDispatcher } from "./alert-dispatcher.js";

type Capture = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

async function withCaptureServer(testFn: (url: string, captures: Capture[]) => Promise<void>): Promise<void> {
  const captures: Capture[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf-8");
      captures.push({
        method: req.method ?? "",
        headers: req.headers,
        body: text ? JSON.parse(text) : null,
      });
      res.statusCode = 200;
      res.end("ok");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  try {
    await testFn(url, captures);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("AlertDispatcher", () => {
  afterEach(() => {
    // defensive cleanup in case a test fails before closing resources
  });

  it("sends Slack-formatted payloads to slack channels", async () => {
    await withCaptureServer(async (url, captures) => {
      const store = new InMemoryAlertStore();
      store.createChannel({ name: "Slack", type: "slack", target: url, enabled: true });
      const dispatcher = new AlertDispatcher(store);

      const event = await dispatcher.dispatch({
        category: "drift",
        severity: "critical",
        title: "Drift detected",
        message: "Security score regressed",
        context: { endpointId: "ep-1", scoreDelta: -18 },
      });

      expect(event.deliveries).toHaveLength(1);
      expect(event.deliveries[0]?.status).toBe("sent");
      expect(captures).toHaveLength(1);

      const payload = captures[0]?.body as { text?: string; blocks?: Array<{ type: string }> };
      expect(payload.text).toContain("Drift detected");
      expect(Array.isArray(payload.blocks)).toBe(true);
      expect(payload.blocks?.length).toBeGreaterThan(1);
    });
  });

  it("sends Teams message-card payloads to teams channels", async () => {
    await withCaptureServer(async (url, captures) => {
      const store = new InMemoryAlertStore();
      store.createChannel({ name: "Teams", type: "teams", target: url, enabled: true });
      const dispatcher = new AlertDispatcher(store);

      await dispatcher.dispatch({
        category: "test",
        severity: "warning",
        title: "Warning test",
        message: "This is a warning message",
        context: { tenantId: "t-1" },
      });

      expect(captures).toHaveLength(1);
      const payload = captures[0]?.body as {
        "@type"?: string;
        summary?: string;
        sections?: Array<{ facts?: Array<{ name: string }> }>;
      };
      expect(payload["@type"]).toBe("MessageCard");
      expect(payload.summary).toBe("Warning test");
      expect(payload.sections?.[0]?.facts?.some((f) => f.name === "tenantId")).toBe(true);
    });
  });

  it("marks email deliveries as simulated without network", async () => {
    const store = new InMemoryAlertStore();
    store.createChannel({ name: "Email", type: "email", target: "secops@example.com", enabled: true });
    const dispatcher = new AlertDispatcher(store);

    const event = await dispatcher.dispatch({
      category: "system",
      severity: "info",
      title: "Info",
      message: "Simulation",
    });

    expect(event.deliveries).toHaveLength(1);
    expect(event.deliveries[0]?.status).toBe("sent");
    expect(event.deliveries[0]?.detail).toBe("email_simulated");
  });

  it("sends configured auth header for webhook-compatible channels", async () => {
    await withCaptureServer(async (url, captures) => {
      const store = new InMemoryAlertStore();
      store.createChannel({
        name: "Webhook",
        type: "webhook",
        target: url,
        enabled: true,
        auth: { headerName: "X-Api-Key", token: "token-123" },
      });
      const dispatcher = new AlertDispatcher(store);

      await dispatcher.dispatch({
        category: "system",
        severity: "info",
        title: "Header test",
        message: "Uses custom auth header",
      });

      expect(captures).toHaveLength(1);
      expect(captures[0]?.headers["x-api-key"]).toBe("token-123");
    });
  });
});
