import { WebSocket } from "ws";

export type SessionSignalClientConfig = {
  controlPlaneUrl: string;
  tenantId: string;
  endpointId: string;
  allowRemoteInput: boolean;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

type SessionStatus =
  | "requested"
  | "pending_host"
  | "pending_approval"
  | "signaling"
  | "connecting_p2p"
  | "connected_p2p"
  | "connected_relay"
  | "reconnecting"
  | "ended"
  | "failed";

type SessionRecord = {
  id: string;
  tenantId: string;
  endpointId: string;
  status: SessionStatus;
  accessMode: "view" | "control";
  requestedCapabilities: Array<"screen" | "input" | "clipboard">;
};

type SignalMessage = {
  sessionId: string;
  senderType: "controller" | "host";
  messageType:
    | "signal.offer"
    | "signal.answer"
    | "signal.ice-candidate"
    | "control.input"
    | "clipboard.sync"
    | "screen.frame.stub";
  payload: Record<string, unknown>;
};

type SignalFrame = {
  v: 1;
  type: "session.signal";
  message: SignalMessage;
};

type SystemFrame = {
  v: 1;
  type: "system.hello" | "system.error";
};

type WsFrame = SignalFrame | SystemFrame;

export type ControlInputDenyCode =
  | "feature_disabled"
  | "session_not_control_mode"
  | "input_capability_missing"
  | "session_not_active"
  | "invalid_payload"
  | "sender_not_controller";

export function buildSessionSignalWsUrl(
  cfg: Pick<SessionSignalClientConfig, "controlPlaneUrl" | "tenantId">,
  sessionId: string,
  sinceSeq = 0,
): string {
  const base = cfg.controlPlaneUrl
    .replace(/^http/, "ws")
    .replace(/\/$/, "");

  const params = new URLSearchParams({
    tenantId: cfg.tenantId,
    participantType: "host",
    sinceSeq: String(Math.max(0, Math.floor(sinceSeq))),
  });

  return `${base}/api/v1/sessions/${sessionId}/signal/ws?${params.toString()}`;
}

export function evaluateControlInputPolicy(
  session: SessionRecord,
  allowRemoteInput: boolean,
): { ok: true } | { ok: false; code: ControlInputDenyCode } {
  if (!allowRemoteInput) {
    return { ok: false, code: "feature_disabled" };
  }

  if (session.status === "ended" || session.status === "failed") {
    return { ok: false, code: "session_not_active" };
  }

  if (session.accessMode !== "control") {
    return { ok: false, code: "session_not_control_mode" };
  }

  if (!session.requestedCapabilities.includes("input")) {
    return { ok: false, code: "input_capability_missing" };
  }

  return { ok: true };
}

function isControlInputPayload(payload: Record<string, unknown>): boolean {
  return typeof payload.action === "string" && payload.action.trim().length > 0;
}

export class SessionSignalClient {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly reconnectDelays = new Map<string, number>();
  private stopping = false;

  constructor(
    private readonly cfg: SessionSignalClientConfig,
    private readonly log: (msg: string) => void = console.log,
  ) {}

  startSession(sessionId: string): void {
    if (this.stopping || this.sockets.has(sessionId)) {
      return;
    }

    void this.connect(sessionId);
  }

  stopSession(sessionId: string): void {
    const ws = this.sockets.get(sessionId);
    if (!ws) {
      return;
    }

    this.sockets.delete(sessionId);
    ws.close();
  }

  stop(): void {
    this.stopping = true;
    for (const ws of this.sockets.values()) {
      ws.close();
    }
    this.sockets.clear();
  }

  private async connect(sessionId: string): Promise<void> {
    const session = await this.fetchSession(sessionId);
    if (!session) {
      this.log(`[agent/signal] skipping ${sessionId}: session not available`);
      return;
    }

    if (session.endpointId !== this.cfg.endpointId || session.tenantId !== this.cfg.tenantId) {
      this.log(`[agent/signal] skipping ${sessionId}: tenant/endpoint mismatch`);
      return;
    }

    if (session.status === "ended" || session.status === "failed") {
      this.log(`[agent/signal] skipping ${sessionId}: terminal session`);
      return;
    }

    const wsUrl = buildSessionSignalWsUrl(this.cfg, sessionId, 0);
    this.log(`[agent/signal] connecting to ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    this.sockets.set(sessionId, ws);

    ws.on("open", () => {
      this.log(`[agent/signal] WS connected for ${sessionId}`);
      this.reconnectDelays.set(sessionId, this.cfg.reconnectBaseMs ?? 1_000);
    });

    ws.on("message", (raw) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(raw.toString()) as WsFrame;
      } catch {
        return;
      }

      if (frame.type !== "session.signal") {
        return;
      }

      void this.handleSignal(session, frame.message);
    });

    ws.on("error", (err) => {
      this.log(`[agent/signal] WS error for ${sessionId}: ${err.message}`);
    });

    ws.on("close", () => {
      this.sockets.delete(sessionId);
      this.log(`[agent/signal] WS closed for ${sessionId}`);
      if (!this.stopping) {
        this.scheduleReconnect(sessionId);
      }
    });
  }

  private scheduleReconnect(sessionId: string): void {
    const current = this.reconnectDelays.get(sessionId) ?? (this.cfg.reconnectBaseMs ?? 1_000);
    const maxMs = this.cfg.reconnectMaxMs ?? 30_000;
    this.reconnectDelays.set(sessionId, Math.min(current * 2, maxMs));
    this.log(`[agent/signal] reconnecting ${sessionId} in ${current}ms`);
    setTimeout(() => {
      if (!this.stopping && !this.sockets.has(sessionId)) {
        void this.connect(sessionId);
      }
    }, current);
  }

  private async handleSignal(session: SessionRecord, msg: SignalMessage): Promise<void> {
    if (msg.senderType !== "controller") {
      return;
    }

    if (msg.messageType !== "control.input") {
      return;
    }

    const deniedBySender = msg.senderType !== "controller";
    if (deniedBySender) {
      await this.postInputResult(session.id, false, "sender_not_controller");
      return;
    }

    if (!isControlInputPayload(msg.payload)) {
      await this.postInputResult(session.id, false, "invalid_payload");
      return;
    }

    const policy = evaluateControlInputPolicy(session, this.cfg.allowRemoteInput);
    if (!policy.ok) {
      this.log(
        `[agent/signal] denied control.input for ${session.id}: ${policy.code}`,
      );
      await this.postInputResult(session.id, false, policy.code);
      return;
    }

    const action = String(msg.payload.action);
    this.log(`[agent/signal] accepted control.input for ${session.id}: ${action}`);
    await this.postInputResult(session.id, true);
  }

  private async postInputResult(
    sessionId: string,
    accepted: boolean,
    denyCode?: ControlInputDenyCode,
  ): Promise<void> {
    const base = this.cfg.controlPlaneUrl.replace(/\/$/, "");
    const payload: Record<string, unknown> = accepted
      ? { result: "accepted" }
      : {
          result: "denied",
          denyCode,
        };

    try {
      const response = await fetch(`${base}/api/v1/sessions/${sessionId}/signal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          senderType: "host",
          messageType: "control.input",
          payload,
        }),
      });

      if (!response.ok) {
        this.log(
          `[agent/signal] failed to post control.input result for ${sessionId}: ${response.status}`,
        );
      }
    } catch (e) {
      this.log(
        `[agent/signal] error posting control.input result for ${sessionId}: ${String(e)}`,
      );
    }
  }

  private async fetchSession(sessionId: string): Promise<SessionRecord | null> {
    const base = this.cfg.controlPlaneUrl.replace(/\/$/, "");

    try {
      const response = await fetch(`${base}/api/v1/sessions/${sessionId}`);
      if (!response.ok) {
        return null;
      }

      return (await response.json()) as SessionRecord;
    } catch {
      return null;
    }
  }
}
