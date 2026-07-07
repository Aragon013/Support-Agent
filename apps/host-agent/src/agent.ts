import { CommandDispatcher } from "./dispatcher/command-dispatcher.js";
import { AgentWsClient } from "./ws/agent-ws-client.js";
import { SessionWsClient } from "./ws/session-ws-client.js";
import { loadAgentConfig } from "./config.js";

const config = loadAgentConfig(process.argv.slice(2), process.env);

const dispatcher = new CommandDispatcher(config.maxConcurrent, config.timeoutMs);

const commandClient = new AgentWsClient(
  {
    controlPlaneUrl: config.controlPlaneUrl,
    tenantId: config.tenantId,
    endpointId: config.endpointId,
    reconnectBaseMs: 1_000,
    reconnectMaxMs: 30_000,
  },
  dispatcher,
);

const sessionClient = new SessionWsClient({
  controlPlaneUrl: config.controlPlaneUrl,
  tenantId: config.tenantId,
  endpointId: config.endpointId,
  autoApproveSessions: config.autoApproveSessions,
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
});

process.on("SIGTERM", () => {
  console.log("[agent] SIGTERM — shutting down");
  commandClient.stop();
  sessionClient.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[agent] SIGINT — shutting down");
  commandClient.stop();
  sessionClient.stop();
  process.exit(0);
});

console.log(`[agent] session auto-approve: ${config.autoApproveSessions}`);

console.log(
  `[agent] starting — control-plane: ${config.controlPlaneUrl} tenant: ${config.tenantId} endpoint: ${config.endpointId}`,
);

commandClient.start();
sessionClient.start();
