import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";

import { registerCommandRoutes } from "./api/command-routes.js";
import { registerSessionRoutes } from "./api/session-routes.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(websocket);
  app.after(() => {
    registerCommandRoutes(app);
    registerSessionRoutes(app);
  });

  app.get("/health", async () => {
    return { ok: true, service: "control-plane" };
  });

  return app;
}
