import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import { buildApp } from "../app.js";

type WsFrame = {
  v: 1;
  type: string;
  message?: {
    sessionId: string;
    messageType: string;
    senderType: string;
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

describe("session signaling websocket", () => {
  it("streams signal messages to websocket subscribers", async () => {
    const app = buildApp();
    await app.listen({ host: "127.0.0.1", port: 0 });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to resolve listening port");
    }

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      headers: {
        "x-operator-role": "tech",
        "x-endpoint-status": "online",
        "x-endpoint-unattended": "true",
      },
      payload: {
        tenantId: "tenant-signal-ws",
        endpointId: "endpoint-1",
        operatorId: "operator-1",
      },
    });
    expect(create.statusCode).toBe(201);
    const sessionId = create.json().sessionId as string;

    const ws = await openSocket(
      `ws://127.0.0.1:${address.port}/api/v1/sessions/${sessionId}/signal/ws?tenantId=tenant-signal-ws&participantType=host`,
    );

    await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/signal`,
      payload: {
        senderType: "controller",
        messageType: "control.input",
        payload: {
          action: "mouse.move",
          x: 100,
          y: 140,
        },
      },
    });

    const frame = await waitForFrame(
      ws,
      (f) => f.type === "session.signal" && f.message?.messageType === "control.input",
    );

    expect(frame.message?.senderType).toBe("controller");
    expect(frame.message?.sessionId).toBe(sessionId);

    ws.ws.close();
    await app.close();
  });
});
