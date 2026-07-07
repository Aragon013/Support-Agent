import { WebSocket } from "ws";

export type SessionClientConfig = {
  controlPlaneUrl: string;
  tenantId: string;
  endpointId: string;
  autoApproveSessions?: boolean;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

type SessionEvent = {
  name: string;
  sessionId: string;
  endpointId: string;
};

type WsSessionFrame = {
  v: 1;
  type: "session.event";
  event: SessionEvent;
};

type WsSystemFrame = {
  v: 1;
  type: "system.hello" | "system.error";
};

type WsFrame = WsSessionFrame | WsSystemFrame;

export function buildSessionWsUrl(cfg: SessionClientConfig): string {
  const base = cfg.controlPlaneUrl
    .replace(/^http/, "ws")
    .replace(/\/$/, "");

  const params = new URLSearchParams({
    tenantId: cfg.tenantId,
    endpointId: cfg.endpointId,
  });

  return `${base}/api/v1/sessions/events/ws?${params.toString()}`;
}

export function shouldAutoApproveSession(
  eventName: string,
  autoApproveSessions: boolean,
): boolean {
  return autoApproveSessions && eventName === "session.approval.required";
}

export class SessionWsClient {
  private ws: WebSocket | null = null;
  private stopping = false;
  private reconnectDelay: number;

  constructor(
    private readonly cfg: SessionClientConfig,
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

    const wsUrl = buildSessionWsUrl(this.cfg);
    this.log(`[agent/session] connecting to ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.log("[agent/session] WS connected");
      this.reconnectDelay = this.cfg.reconnectBaseMs ?? 1_000;
    });

    ws.on("message", (raw) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(raw.toString()) as WsFrame;
      } catch {
        return;
      }

      if (frame.type !== "session.event") {
        return;
      }

      const evt = frame.event;
      if (evt.endpointId !== this.cfg.endpointId) {
        return;
      }

      if (shouldAutoApproveSession(evt.name, this.cfg.autoApproveSessions ?? false)) {
        void this.approveSession(evt.sessionId);
      }
    });

    ws.on("error", (err) => {
      this.log(`[agent/session] WS error: ${err.message}`);
    });

    ws.on("close", () => {
      this.log("[agent/session] WS closed");
      if (!this.stopping) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelay;
    const maxMs = this.cfg.reconnectMaxMs ?? 30_000;
    this.reconnectDelay = Math.min(delay * 2, maxMs);
    this.log(`[agent/session] reconnecting in ${delay}ms`);
    setTimeout(() => this.connect(), delay);
  }

  private async approveSession(sessionId: string): Promise<void> {
    const base = this.cfg.controlPlaneUrl.replace(/\/$/, "");
    try {
      const response = await fetch(`${base}/api/v1/sessions/${sessionId}/approve`, {
        method: "POST",
      });

      if (!response.ok) {
        this.log(
          `[agent/session] failed to approve session ${sessionId}: ${response.status}`,
        );
        return;
      }

      this.log(`[agent/session] approved session ${sessionId}`);
    } catch (e) {
      this.log(`[agent/session] approve error ${sessionId}: ${String(e)}`);
    }
  }
}
