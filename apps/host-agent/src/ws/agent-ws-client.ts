import { WebSocket } from "ws";
import { createHash } from "node:crypto";
import type { CommandInitEnvelope } from "../types.js";
import type { CommandDispatcher } from "../dispatcher/command-dispatcher.js";

export type AgentClientConfig = {
  controlPlaneUrl: string;
  tenantId: string;
  endpointId: string;
  operatorId?: string;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

type WsJobEventFrame = {
  v: 1;
  type: "command.job.event";
  event: {
    name: string;
    jobId: string;
    status: string;
  };
};

type WsSystemFrame = {
  v: 1;
  type: "system.hello" | "system.error";
};

type WsFrame = WsJobEventFrame | WsSystemFrame;

/**
 * Connects to the control-plane WS, listens for command.init envelopes
 * on the HTTP events endpoint (polled after each new queued event), and
 * drives the CommandDispatcher end-to-end.
 *
 * Note: the control-plane current impl pushes job lifecycle events over WS,
 * and exposes channel-messages (envelopes) via HTTP GET. This client
 * subscribes to WS for triggers, then fetches the init envelope and runs it.
 */
export class AgentWsClient {
  private ws: WebSocket | null = null;
  private stopping = false;
  private reconnectDelay: number;

  constructor(
    private readonly cfg: AgentClientConfig,
    private readonly dispatcher: CommandDispatcher,
    private readonly log: (msg: string) => void = console.log,
  ) {
    this.reconnectDelay = cfg.reconnectBaseMs ?? 1_000;
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopping = true;
    this.ws?.close();
  }

  private connect(): void {
    if (this.stopping) return;

    const wsUrl = buildWsUrl(this.cfg);
    this.log(`[agent] connecting to ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.log("[agent] WS connected");
      this.reconnectDelay = this.cfg.reconnectBaseMs ?? 1_000;
    });

    ws.on("message", (raw) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(raw.toString()) as WsFrame;
      } catch {
        return;
      }

      if (frame.type !== "command.job.event") {
        return;
      }

      const evt = (frame as WsJobEventFrame).event;
      if (evt.name !== "command.job.queued") {
        return;
      }

      void this.handleQueued(evt.jobId);
    });

    ws.on("error", (err) => {
      this.log(`[agent] WS error: ${err.message}`);
    });

    ws.on("close", () => {
      this.log("[agent] WS closed");
      if (!this.stopping) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelay;
    const maxMs = this.cfg.reconnectMaxMs ?? 30_000;
    this.reconnectDelay = Math.min(delay * 2, maxMs);
    this.log(`[agent] reconnecting in ${delay}ms`);
    setTimeout(() => this.connect(), delay);
  }

  private async handleQueued(jobId: string): Promise<void> {
    if (!this.dispatcher.hasCapacity()) {
      this.log(`[agent] slot full, skipping job ${jobId}`);
      return;
    }

    const base = this.cfg.controlPlaneUrl.replace(/\/$/, "");

    let envelope: CommandInitEnvelope | undefined;
    try {
      const res = await fetch(
        `${base}/api/v1/commands/jobs/${jobId}/channel-messages`,
      );
      if (!res.ok) {
        this.log(`[agent] failed to fetch envelope for ${jobId}: ${res.status}`);
        return;
      }
      const body = await res.json() as { items: CommandInitEnvelope[] };
      envelope = body.items.find((e) => e.kind === "command.init");
    } catch (e) {
      this.log(`[agent] fetch error for ${jobId}: ${String(e)}`);
      return;
    }

    if (!envelope) {
      this.log(`[agent] no command.init envelope for job ${jobId}`);
      return;
    }

    this.log(`[agent] dispatching ${envelope.commandId} (job ${jobId})`);

    const outcome = await this.dispatcher.dispatch(envelope);

    const reportBody = toRunReportBody(outcome);

    try {
      await fetch(`${base}/api/v1/internal/commands/jobs/${jobId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reportBody),
      });
    } catch (e) {
      this.log(`[agent] failed to report outcome for ${jobId}: ${String(e)}`);
    }

    this.log(`[agent] job ${jobId} → ${outcome.status}`);
  }
}

function buildWsUrl(cfg: AgentClientConfig): string {
  const base = cfg.controlPlaneUrl
    .replace(/^http/, "ws")
    .replace(/\/$/, "");

  const params = new URLSearchParams({ tenantId: cfg.tenantId });
  if (cfg.endpointId) params.set("endpointId", cfg.endpointId);
  return `${base}/api/v1/commands/events/ws?${params.toString()}`;
}

function toRunReportBody(outcome: Awaited<ReturnType<CommandDispatcher["dispatch"]>>): {
  status: "completed" | "failed" | "cancelled";
  failReason?: string;
  output?: {
    stdout: string[];
    stderr: string[];
    exitCode: number;
  };
  digestSha256?: string;
  outputBytes?: number;
  truncated?: boolean;
} {
  if (outcome.status === "completed" || outcome.status === "failed") {
    const digest = digestOutput(outcome.output.stdout, outcome.output.stderr);
    const truncated =
      outcome.output.stdout.some((x) => x.includes("[output truncated: cap exceeded]")) ||
      outcome.output.stderr.some((x) => x.includes("[output truncated: cap exceeded]"));

    return {
      status: outcome.status,
      ...(outcome.status === "failed" ? { failReason: outcome.reason } : {}),
      output: {
        stdout: outcome.output.stdout,
        stderr: outcome.output.stderr,
        exitCode: outcome.output.exitCode,
      },
      digestSha256: digest.sha256,
      outputBytes: digest.bytes,
      truncated,
    };
  }

  if (outcome.status === "cancelled") {
    return {
      status: "cancelled",
      failReason: outcome.reason,
    };
  }

  return {
    status: "failed",
    failReason: "unknown_command",
  };
}

function digestOutput(stdout: string[], stderr: string[]): { sha256: string; bytes: number } {
  const hash = createHash("sha256");
  let bytes = 0;

  for (const line of stdout) {
    const payload = `stdout:${line}\n`;
    hash.update(payload);
    bytes += Buffer.byteLength(line, "utf8");
  }

  for (const line of stderr) {
    const payload = `stderr:${line}\n`;
    hash.update(payload);
    bytes += Buffer.byteLength(line, "utf8");
  }

  return {
    sha256: hash.digest("hex"),
    bytes,
  };
}
