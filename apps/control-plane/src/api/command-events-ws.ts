import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";

import type {
  CommandJobEvent,
  InMemoryCommandEventBus,
} from "../domain/command-event-bus.js";

type WsQuery = {
  tenantId?: string;
  endpointId?: string;
  operatorId?: string;
  sinceSeq?: string;
};

type WsEventEnvelope = {
  v: 1;
  type: "command.job.event";
  event: CommandJobEvent;
};

type WsHelloEnvelope = {
  v: 1;
  type: "system.hello";
  now: string;
};

type WsFilter = {
  tenantId: string;
  endpointId?: string;
  operatorId?: string;
  sinceSeq: number;
};

type WsClient = {
  socket: WebSocket;
  filter: WsFilter;
};

export class CommandEventsWsHub {
  private readonly clients = new Set<WsClient>();
  private readonly recent: CommandJobEvent[] = [];
  private readonly seenEventIds = new Set<string>();

  constructor(private readonly maxRecent = 500) {}

  attach(eventBus: InMemoryCommandEventBus): () => void {
    return eventBus.subscribe((event) => {
      this.publish(event);
    });
  }

  addClient(socket: WebSocket, filter: WsFilter): void {
    const client: WsClient = { socket, filter };
    this.clients.add(client);

    socket.send(
      JSON.stringify({
        v: 1,
        type: "system.hello",
        now: new Date().toISOString(),
      } satisfies WsHelloEnvelope),
    );

    for (const event of this.recent) {
      if (event.seq <= filter.sinceSeq) {
        continue;
      }
      if (!matchesFilter(event, filter)) {
        continue;
      }

      socket.send(
        JSON.stringify({
          v: 1,
          type: "command.job.event",
          event,
        } satisfies WsEventEnvelope),
      );
    }

    socket.on("close", () => {
      this.clients.delete(client);
    });
  }

  publish(event: CommandJobEvent): void {
    if (this.seenEventIds.has(event.id)) {
      return;
    }

    this.seenEventIds.add(event.id);
    this.recent.push(event);
    if (this.recent.length > this.maxRecent) {
      const dropped = this.recent.shift();
      if (dropped) {
        this.seenEventIds.delete(dropped.id);
      }
    }

    const message = JSON.stringify({
      v: 1,
      type: "command.job.event",
      event,
    } satisfies WsEventEnvelope);

    for (const client of this.clients) {
      if (!matchesFilter(event, client.filter)) {
        continue;
      }

      if (client.socket.readyState === 1) {
        client.socket.send(message);
      }
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function matchesFilter(event: CommandJobEvent, filter: WsFilter): boolean {
  if (event.tenantId !== filter.tenantId) {
    return false;
  }
  if (filter.endpointId && event.endpointId !== filter.endpointId) {
    return false;
  }
  if (filter.operatorId && event.operatorId !== filter.operatorId) {
    return false;
  }
  return true;
}

function parseSinceSeq(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

export function registerCommandEventsWsRoute(
  app: FastifyInstance,
  hub: CommandEventsWsHub,
): void {
  app.route({
    method: "GET",
    url: "/api/v1/commands/events/ws",
    handler: async (_req, reply) => {
      return reply.code(426).send({
        code: "upgrade_required",
        message: "use websocket upgrade for this endpoint",
      });
    },
    wsHandler: (socket: WebSocket, req: FastifyRequest<{ Querystring: WsQuery }>) => {
      const rawQuery =
        req.query && typeof req.query === "object" ? req.query : undefined;
      const parsed = new URL(req.raw.url ?? "/", "http://localhost");
      const tenantId =
        rawQuery?.tenantId ?? parsed.searchParams.get("tenantId") ?? undefined;
      if (!isNonEmptyString(tenantId)) {
        socket.send(
          JSON.stringify({
            v: 1,
            type: "system.error",
            code: "validation_error",
            message: "tenantId is required",
          }),
        );
        socket.close();
        return;
      }

      const filter: WsFilter = {
        tenantId,
        sinceSeq: parseSinceSeq(
          rawQuery?.sinceSeq ?? parsed.searchParams.get("sinceSeq"),
        ),
        ...(isNonEmptyString(
          rawQuery?.endpointId ?? parsed.searchParams.get("endpointId"),
        )
          ? {
              endpointId:
                (rawQuery?.endpointId ??
                  parsed.searchParams.get("endpointId")) as string,
            }
          : {}),
        ...(isNonEmptyString(
          rawQuery?.operatorId ?? parsed.searchParams.get("operatorId"),
        )
          ? {
              operatorId:
                (rawQuery?.operatorId ??
                  parsed.searchParams.get("operatorId")) as string,
            }
          : {}),
      };

      hub.addClient(socket, filter);
    },
  });
}
