import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import { buildApp } from "../app.js";

type WsFrame = {
  v: 1;
  type: string;
  event?: {
    seq: number;
    name: string;
    tenantId: string;
  };
};

type WsClient = {
  ws: WebSocket;
  frames: WsFrame[];
};

async function openSocket(url: string): Promise<WsClient> {
  return await new Promise<WsClient>((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames: WsFrame[] = [];
    ws.on("message", (raw) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      frames.push(JSON.parse(text) as WsFrame);
    });
    ws.on("open", () => resolve({ ws, frames }));
    ws.on("error", (err) => reject(err));
  });
}

async function waitForFrame(
  client: WsClient,
  predicate: (frame: WsFrame) => boolean,
  timeoutMs = 2000,
): Promise<WsFrame> {
  return await new Promise<WsFrame>((resolve, reject) => {
    const preexisting = client.frames.find(predicate);
    if (preexisting) {
      resolve(preexisting);
      return;
    }

    const timeout = setTimeout(() => {
      client.ws.off("message", onMessage);
      reject(new Error("timeout waiting for websocket frame"));
    }, timeoutMs);

    const onMessage = (raw: WebSocket.RawData) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      const frame = JSON.parse(text) as WsFrame;
      client.frames.push(frame);
      if (!predicate(frame)) {
        return;
      }

      clearTimeout(timeout);
      client.ws.off("message", onMessage);
      resolve(frame);
    };

    client.ws.on("message", onMessage);
  });
}

describe("command events websocket pipeline", () => {
  it("streams filtered command events for tenant subscribers", async () => {
    const app = buildApp();
    await app.listen({ host: "127.0.0.1", port: 0 });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve listening port");
    }

    const ws = await openSocket(
      `ws://127.0.0.1:${address.port}/api/v1/commands/events/ws?tenantId=tenant-live`,
    );

    await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-other",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-live",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });

    const eventFrame = await waitForFrame(
      ws,
      (frame) =>
        frame.type === "command.job.event" &&
        frame.event?.tenantId === "tenant-live" &&
        frame.event?.name === "command.job.queued",
    );

    expect(eventFrame.v).toBe(1);
    expect(eventFrame.event?.seq).toBeGreaterThan(0);

    ws.ws.close();
    await app.close();
  });

  it("replays events using sinceSeq cursor", async () => {
    const app = buildApp();
    await app.listen({ host: "127.0.0.1", port: 0 });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve listening port");
    }

    await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-replay",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });

    const baseline = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-replay",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });

    const baselineBody = baseline.json();
    const events = await app.inject({
      method: "GET",
      url: `/api/v1/commands/jobs/${baselineBody.id}/events`,
    });
    const eventsBody = events.json();
    const lastSeq = eventsBody.items.at(-1)?.seq ?? 0;

    await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-replay",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });

    const ws = await openSocket(
      `ws://127.0.0.1:${address.port}/api/v1/commands/events/ws?tenantId=tenant-replay&sinceSeq=${lastSeq}`,
    );
    const replayed = await waitForFrame(
      ws,
      (frame) =>
        frame.type === "command.job.event" &&
        typeof frame.event?.seq === "number" &&
        frame.event.seq > lastSeq,
    );

    expect(replayed.event?.seq).toBeGreaterThan(lastSeq);

    ws.ws.close();
    await app.close();
  });

  it("streams running and completed events from simulated runner", async () => {
    const app = buildApp();
    await app.listen({ host: "127.0.0.1", port: 0 });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve listening port");
    }

    const ws = await openSocket(
      `ws://127.0.0.1:${address.port}/api/v1/commands/events/ws?tenantId=tenant-live-runner`,
    );

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/commands/jobs",
      payload: {
        tenantId: "tenant-live-runner",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
        catalogCommandId: "diagnostic.system.info",
      },
    });
    const created = create.json();

    await app.inject({
      method: "POST",
      url: `/api/v1/internal/commands/jobs/${created.id}/run`,
      payload: {
        outcome: "completed",
      },
    });

    const running = await waitForFrame(
      ws,
      (frame) => frame.type === "command.job.event" && frame.event?.name === "command.job.running",
    );
    const completed = await waitForFrame(
      ws,
      (frame) =>
        frame.type === "command.job.event" &&
        frame.event?.name === "command.job.completed" &&
        typeof frame.event?.seq === "number" &&
        frame.event.seq > (running.event?.seq ?? 0),
    );

    expect(running.event?.tenantId).toBe("tenant-live-runner");
    expect(completed.event?.tenantId).toBe("tenant-live-runner");

    ws.ws.close();
    await app.close();
  });
});
