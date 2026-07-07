import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";

import type { SessionRecord } from "../domain/session-store.js";
import type { InMemorySessionSignalStore, SessionSignalMessage } from "../domain/session-signal-store.js";

type IdParams = {
  id: string;
};

type WsQuery = {
  tenantId?: string;
  participantType?: "controller" | "host";
  sinceSeq?: string;
};

type WsClient = {
  socket: WebSocket;
  sessionId: string;
  tenantId: string;
  participantType?: "controller" | "host";
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSinceSeq(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

export class SessionSignalWsHub {
  private readonly clients = new Set<WsClient>();

  constructor(private readonly signalStore: InMemorySessionSignalStore) {}

  publish(message: SessionSignalMessage): void {
    const frame = JSON.stringify({ v: 1, type: "session.signal", message });
    for (const client of this.clients) {
      if (client.sessionId !== message.sessionId || client.tenantId !== message.tenantId) {
        continue;
      }
      if (client.participantType && client.participantType === message.senderType) {
        continue;
      }
      if (client.socket.readyState === 1) {
        client.socket.send(frame);
      }
    }
  }

  addClient(
    socket: WebSocket,
    opts: {
      sessionId: string;
      tenantId: string;
      participantType?: "controller" | "host";
      sinceSeq: number;
    },
  ): void {
    const client: WsClient = {
      socket,
      sessionId: opts.sessionId,
      tenantId: opts.tenantId,
      ...(opts.participantType ? { participantType: opts.participantType } : {}),
    };

    this.clients.add(client);

    socket.send(
      JSON.stringify({
        v: 1,
        type: "system.hello",
        now: new Date().toISOString(),
      }),
    );

    const replay = this.signalStore.list(opts.sessionId, opts.sinceSeq);
    for (const msg of replay) {
      if (msg.tenantId !== opts.tenantId) {
        continue;
      }
      if (opts.participantType && opts.participantType === msg.senderType) {
        continue;
      }
      socket.send(JSON.stringify({ v: 1, type: "session.signal", message: msg }));
    }

    socket.on("close", () => {
      this.clients.delete(client);
    });
  }
}

export function registerSessionSignalWsRoute(
  app: FastifyInstance,
  hub: SessionSignalWsHub,
  findSession: (id: string) => SessionRecord | undefined,
): void {
  app.route({
    method: "GET",
    url: "/api/v1/sessions/:id/signal/ws",
    handler: async (_req, reply) => {
      return reply.code(426).send({
        code: "upgrade_required",
        message: "use websocket upgrade for this endpoint",
      });
    },
    wsHandler: (
      socket: WebSocket,
      req: FastifyRequest<{ Params: IdParams; Querystring: WsQuery }>,
    ) => {
      const session = findSession(req.params.id);
      if (!session) {
        socket.send(
          JSON.stringify({
            v: 1,
            type: "system.error",
            code: "not_found",
            message: "session not found",
          }),
        );
        socket.close();
        return;
      }

      const rawQuery = req.query && typeof req.query === "object" ? req.query : undefined;
      const parsed = new URL(req.raw.url ?? "/", "http://localhost");
      const tenantId = rawQuery?.tenantId ?? parsed.searchParams.get("tenantId") ?? undefined;
      const participantTypeRaw =
        rawQuery?.participantType ?? parsed.searchParams.get("participantType") ?? undefined;

      if (!isNonEmptyString(tenantId) || tenantId !== session.tenantId) {
        socket.send(
          JSON.stringify({
            v: 1,
            type: "system.error",
            code: "validation_error",
            message: "tenantId is required and must match session tenant",
          }),
        );
        socket.close();
        return;
      }

      const participantType =
        participantTypeRaw === "controller" || participantTypeRaw === "host"
          ? participantTypeRaw
          : undefined;

      hub.addClient(socket, {
        sessionId: session.id,
        tenantId,
        ...(participantType ? { participantType } : {}),
        sinceSeq: parseSinceSeq(
          rawQuery?.sinceSeq ?? parsed.searchParams.get("sinceSeq"),
        ),
      });
    },
  });
}
