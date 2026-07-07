import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import { buildApp } from "../app.js";

type WsFrame = {
  v: 1;
  type: string;
  event?: {
    name: string;
    tenantId: string;
    seq: number;
  };
};

async function openSocket(url: string): Promise<{ ws: WebSocket; frames: WsFrame[] }> {
  return await new Promise((resolve, reject) => {
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
  client: { ws: WebSocket; frames: WsFrame[] },
  predicate: (frame: WsFrame) => boolean,
  timeoutMs = 2000,
): Promise<WsFrame> {
  return await new Promise((resolve, reject) => {
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

describe("session events websocket", () => {
  it("streams session.created events filtered by tenant", async () => {
    const app = buildApp();
    await app.listen({ host: "127.0.0.1", port: 0 });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve listening port");
    }

    const ws = await openSocket(
      `ws://127.0.0.1:${address.port}/api/v1/sessions/events/ws?tenantId=tenant-live-s`,
    );

    await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
      },
      payload: {
        tenantId: "tenant-other",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
      },
      payload: {
        tenantId: "tenant-live-s",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });

    const created = await waitForFrame(
      ws,
      (frame) =>
        frame.type === "session.event" &&
        frame.event?.tenantId === "tenant-live-s" &&
        frame.event?.name === "session.created",
    );

    expect(created.v).toBe(1);
    expect((created.event?.seq ?? 0) > 0).toBe(true);

    ws.ws.close();
    await app.close();
  });
});
