import { CommandDispatcher } from "./dispatcher/command-dispatcher.js";
import { AgentWsClient } from "./ws/agent-ws-client.js";
import { SessionWsClient } from "./ws/session-ws-client.js";
import { SessionSignalClient } from "./ws/session-signal-client.js";
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

const allowRemoteInput = process.env.ALLOW_REMOTE_INPUT === "true";

const signalClient = new SessionSignalClient({
  controlPlaneUrl: config.controlPlaneUrl,
  tenantId: config.tenantId,
  endpointId: config.endpointId,
  allowRemoteInput,
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
});

const sessionClient = new SessionWsClient({
  controlPlaneUrl: config.controlPlaneUrl,
  tenantId: config.tenantId,
  endpointId: config.endpointId,
  autoApproveSessions: config.autoApproveSessions,
  onEvent: (event) => {
    signalClient.syncSessionState(event.sessionId, event.status as Parameters<typeof signalClient.syncSessionState>[1]);

    const activeStatuses = new Set([
      "signaling",
      "connecting_p2p",
      "connected_p2p",
      "connected_relay",
      "reconnecting",
    ]);

    if (activeStatuses.has(event.status)) {
      signalClient.startSession(event.sessionId);
      return;
    }

    if (event.status === "ended" || event.status === "failed") {
      signalClient.stopSession(event.sessionId);
    }
  },
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
});

process.on("SIGTERM", () => {
  console.log("[agent] SIGTERM — shutting down");
  commandClient.stop();
  sessionClient.stop();
  signalClient.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[agent] SIGINT — shutting down");
  commandClient.stop();
  sessionClient.stop();
  signalClient.stop();
  process.exit(0);
});

console.log(`[agent] session auto-approve: ${config.autoApproveSessions}`);
console.log(`[agent] remote input enabled: ${allowRemoteInput}`);

console.log(
  `[agent] starting — control-plane: ${config.controlPlaneUrl} tenant: ${config.tenantId} endpoint: ${config.endpointId}`,
);

commandClient.start();
sessionClient.start();
