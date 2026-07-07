import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, PlayCircle, Radio, Square, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/cn";

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

type SessionEvent = {
  seq: number;
  name: string;
  sessionId: string;
  endpointId: string;
  tenantId: string;
  status: SessionStatus;
  createdAt: string;
};

type SessionView = {
  sessionId: string;
  status: SessionStatus;
  endpointId: string;
  approvalMode?: string;
  routeMode?: string;
  updatedAt: string;
};

type SessionSignalMessageType =
  | "signal.offer"
  | "signal.answer"
  | "signal.ice-candidate"
  | "control.input"
  | "clipboard.sync"
  | "screen.frame.stub"
  | "screen.frame.data";

type SessionSignalMessage = {
  id: string;
  seq: number;
  sessionId: string;
  tenantId: string;
  senderType: "controller" | "host";
  messageType: SessionSignalMessageType;
  payload: Record<string, unknown>;
  createdAt: string;
};

type ControlInputAckPayload = {
  result?: "accepted" | "denied";
  action?: string;
  sessionStatus?: SessionStatus;
  handledAt?: string;
  denyCode?: string;
};

type ScreenFrameDataPayload = {
  frameData?: string;
  frameId?: number;
  capturedAt?: number;
  width?: number;
  height?: number;
  encodingQuality?: number;
  encodingFormat?: "jpeg";
  captureDurationMs?: number;
  encodeDurationMs?: number;
};

function asControlInputAck(
  msg: SessionSignalMessage | undefined,
): ControlInputAckPayload | null {
  if (!msg || msg.senderType !== "host" || msg.messageType !== "control.input") {
    return null;
  }

  const payload = msg.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return payload as ControlInputAckPayload;
}

function asScreenFrameData(
  msg: SessionSignalMessage | undefined,
): ScreenFrameDataPayload | null {
  if (!msg || msg.senderType !== "host" || msg.messageType !== "screen.frame.data") {
    return null;
  }

  const payload = msg.payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybe = payload as ScreenFrameDataPayload;
  if (typeof maybe.frameData !== "string" || maybe.frameData.length === 0) {
    return null;
  }

  return maybe;
}

const STATUS_COLOR: Record<SessionStatus, string> = {
  requested: "text-slate-300",
  pending_host: "text-slate-300",
  pending_approval: "text-warn",
  signaling: "text-brand",
  connecting_p2p: "text-brand",
  connected_p2p: "text-success",
  connected_relay: "text-accent",
  reconnecting: "text-warn",
  ended: "text-slate-500",
  failed: "text-danger",
};

export function SessionsPanel() {
  const [tenantId, setTenantId] = useState("tenant-1");
  const [endpointId, setEndpointId] = useState("endpoint-1");
  const [operatorId, setOperatorId] = useState("operator-1");
  const [accessMode, setAccessMode] = useState<"view" | "control">("control");
  const [unattended, setUnattended] = useState(false);

  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [signalWsConnected, setSignalWsConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signalBusy, setSignalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [signalMessages, setSignalMessages] = useState<SessionSignalMessage[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const signalWsRef = useRef<WebSocket | null>(null);

  const selected = useMemo(
    () => sessions.find((s) => s.sessionId === selectedId) ?? null,
    [sessions, selectedId],
  );

  const latestHostInputAck = useMemo(() => {
    for (const msg of signalMessages) {
      const parsed = asControlInputAck(msg);
      if (parsed) {
        return {
          message: msg,
          payload: parsed,
        };
      }
    }

    return null;
  }, [signalMessages]);

  const latestScreenFrame = useMemo(() => {
    for (const msg of signalMessages) {
      const parsed = asScreenFrameData(msg);
      if (parsed) {
        return {
          message: msg,
          payload: parsed,
          dataUrl: `data:image/jpeg;base64,${parsed.frameData}`,
        };
      }
    }

    return null;
  }, [signalMessages]);

  const screenFrameFpsEstimate = useMemo(() => {
    const frameSignals = signalMessages
      .filter((x) => x.senderType === "host" && x.messageType === "screen.frame.data")
      .slice(0, 20);

    if (frameSignals.length < 2) {
      return null;
    }

    const newest = new Date(frameSignals[0].createdAt).getTime();
    const oldest = new Date(frameSignals[frameSignals.length - 1].createdAt).getTime();
    const elapsedSec = Math.max(0.001, (newest - oldest) / 1000);
    const fps = (frameSignals.length - 1) / elapsedSec;
    return Number.isFinite(fps) ? fps.toFixed(1) : null;
  }, [signalMessages]);

  useEffect(() => {
    const ws = new WebSocket(
      `ws://localhost:3000/api/v1/sessions/events/ws?tenantId=${encodeURIComponent(tenantId)}`,
    );

    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);

    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string) as {
          type: string;
          event?: SessionEvent;
        };

        if (frame.type !== "session.event" || !frame.event) {
          return;
        }

        const evt = frame.event;
        setSessions((prev) => {
          const idx = prev.findIndex((x) => x.sessionId === evt.sessionId);
          const nextRecord: SessionView = {
            sessionId: evt.sessionId,
            status: evt.status,
            endpointId: evt.endpointId,
            updatedAt: evt.createdAt,
          };

          if (idx < 0) {
            return [nextRecord, ...prev].slice(0, 100);
          }

          const next = [...prev];
          next[idx] = {
            ...next[idx],
            status: evt.status,
            updatedAt: evt.createdAt,
          };
          return next;
        });
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
    };
  }, [tenantId]);

  useEffect(() => {
    setSignalMessages([]);
    setSignalError(null);
    setSignalWsConnected(false);

    signalWsRef.current?.close();
    signalWsRef.current = null;

    if (!selectedId) {
      return;
    }

    const ws = new WebSocket(
      `ws://localhost:3000/api/v1/sessions/${selectedId}/signal/ws?tenantId=${encodeURIComponent(tenantId)}&participantType=controller`,
    );

    signalWsRef.current = ws;
    ws.onopen = () => setSignalWsConnected(true);
    ws.onclose = () => setSignalWsConnected(false);
    ws.onerror = () => {
      setSignalWsConnected(false);
      setSignalError("signal websocket disconnected");
    };

    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string) as {
          type: string;
          message?: SessionSignalMessage;
        };

        if (frame.type !== "session.signal" || !frame.message) {
          return;
        }

        setSignalMessages((prev) => [frame.message!, ...prev].slice(0, 150));
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
    };
  }, [selectedId, tenantId]);

  const createSession = async () => {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("http://localhost:3000/api/v1/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-operator-role": "tech",
          "x-endpoint-status": "online",
          "x-endpoint-unattended": unattended ? "true" : "false",
        },
        body: JSON.stringify({
          tenantId,
          endpointId,
          operatorId,
          accessMode,
          requestedCapabilities:
            accessMode === "control"
              ? ["screen", "input", "clipboard"]
              : ["screen"],
        }),
      });

      const body = await res.json() as {
        sessionId?: string;
        status?: SessionStatus;
        approvalMode?: string;
        routeMode?: string;
        code?: string;
        reason?: string;
      };

      if (!res.ok || !body.sessionId || !body.status) {
        throw new Error(body.reason ?? body.code ?? `http_${res.status}`);
      }

      setSessions((prev) => [
        {
          sessionId: body.sessionId!,
          status: body.status!,
          endpointId,
          approvalMode: body.approvalMode,
          routeMode: body.routeMode,
          updatedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setSelectedId(body.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const approveSelected = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `http://localhost:3000/api/v1/sessions/${selected.sessionId}/approve`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json() as { code?: string; message?: string };
        throw new Error(body.message ?? body.code ?? `http_${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const endSelected = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `http://localhost:3000/api/v1/sessions/${selected.sessionId}/end`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json() as { code?: string; message?: string };
        throw new Error(body.message ?? body.code ?? `http_${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const transitionSelected = async (status: "connected_p2p" | "connected_relay") => {
    if (!selected) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `http://localhost:3000/api/v1/internal/sessions/${selected.sessionId}/state`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status,
            routeMode: status === "connected_relay" ? "relay" : "direct",
          }),
        },
      );

      if (!res.ok) {
        const body = await res.json() as { code?: string; message?: string };
        throw new Error(body.message ?? body.code ?? `http_${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendSignal = async (
    messageType: SessionSignalMessageType,
    payload: Record<string, unknown>,
  ) => {
    if (!selected) {
      return;
    }

    setSignalBusy(true);
    setSignalError(null);
    try {
      const res = await fetch(
        `http://localhost:3000/api/v1/sessions/${selected.sessionId}/signal`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-participant-type": "controller",
          },
          body: JSON.stringify({
            senderType: "controller",
            messageType,
            payload,
          }),
        },
      );

      if (!res.ok) {
        const body = await res.json() as { code?: string; message?: string };
        throw new Error(body.message ?? body.code ?? `http_${res.status}`);
      }
    } catch (e) {
      setSignalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSignalBusy(false);
    }
  };

  const isActiveSession =
    selected?.status !== undefined &&
    selected.status !== "ended" &&
    selected.status !== "failed";

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Sessions</h2>
          <p className="text-sm text-slate-400 mt-0.5">Create and control endpoint sessions</p>
        </div>
        <div className={cn("flex items-center gap-1.5 text-xs font-medium", wsConnected ? "text-success" : "text-slate-500")}>
          {wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {wsConnected ? "Session WS Connected" : "Session WS Disconnected"}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="tenantId"
          className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white"
        />
        <input
          value={endpointId}
          onChange={(e) => setEndpointId(e.target.value)}
          placeholder="endpointId"
          className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white"
        />
        <input
          value={operatorId}
          onChange={(e) => setOperatorId(e.target.value)}
          placeholder="operatorId"
          className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white"
        />
        <select
          value={accessMode}
          onChange={(e) => setAccessMode(e.target.value as "view" | "control")}
          className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="control">control</option>
          <option value="view">view</option>
        </select>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={unattended}
          onChange={(e) => setUnattended(e.target.checked)}
          className="accent-brand"
        />
        Unattended endpoint (skip host approval)
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={createSession}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-50"
        >
          <PlayCircle className="w-4 h-4" />
          Create Session
        </button>
        <button
          onClick={approveSelected}
          disabled={busy || !selected || selected.status !== "pending_approval"}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-success/20 border border-success/40 text-success text-sm font-semibold disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" />
          Approve Selected
        </button>
        <button
          onClick={endSelected}
          disabled={busy || !selected || selected.status === "ended" || selected.status === "failed"}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-danger/20 border border-danger/40 text-danger text-sm font-semibold disabled:opacity-50"
        >
          <Square className="w-4 h-4" />
          End Selected
        </button>
        <button
          onClick={() => transitionSelected("connected_p2p")}
          disabled={busy || !selected || !isActiveSession}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-success/15 border border-success/30 text-success text-sm font-semibold disabled:opacity-50"
        >
          Mark P2P Connected
        </button>
        <button
          onClick={() => transitionSelected("connected_relay")}
          disabled={busy || !selected || !isActiveSession}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/15 border border-accent/30 text-accent text-sm font-semibold disabled:opacity-50"
        >
          Mark Relay Connected
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-surface-800 bg-surface-900/70 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Session Signaling</h3>
            <p className="text-xs text-slate-400 mt-0.5">WS + HTTP channel for offer/ice/input/clipboard/screen</p>
          </div>
          <div className={cn("flex items-center gap-1.5 text-xs font-medium", signalWsConnected ? "text-success" : "text-slate-500")}>
            {signalWsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {signalWsConnected ? "Signal WS Connected" : "Signal WS Disconnected"}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() =>
              sendSignal("signal.offer", {
                sdp: "v=0\\no=- 0 0 IN IP4 127.0.0.1\\ns=RemoteSupportPro\\nt=0 0",
                media: "stub",
              })
            }
            disabled={signalBusy || !selected || !isActiveSession}
            className="px-3 py-1.5 rounded-lg bg-brand/20 border border-brand/40 text-brand text-xs font-semibold disabled:opacity-50"
          >
            Send Offer
          </button>
          <button
            onClick={() =>
              sendSignal("signal.ice-candidate", {
                candidate: "candidate:0 1 UDP 2122252543 192.168.1.10 55000 typ host",
                sdpMid: "0",
                sdpMLineIndex: 0,
              })
            }
            disabled={signalBusy || !selected || !isActiveSession}
            className="px-3 py-1.5 rounded-lg bg-accent/20 border border-accent/40 text-accent text-xs font-semibold disabled:opacity-50"
          >
            Send ICE
          </button>
          <button
            onClick={() =>
              sendSignal("control.input", {
                action: "mouse.move",
                x: 320,
                y: 180,
              })
            }
            disabled={signalBusy || !selected || !isActiveSession}
            className="px-3 py-1.5 rounded-lg bg-warn/20 border border-warn/40 text-warn text-xs font-semibold disabled:opacity-50"
          >
            Send Input
          </button>
          <button
            onClick={() =>
              sendSignal("clipboard.sync", {
                text: "controller-clipboard-stub",
                format: "text/plain",
              })
            }
            disabled={signalBusy || !selected || !isActiveSession}
            className="px-3 py-1.5 rounded-lg bg-success/20 border border-success/40 text-success text-xs font-semibold disabled:opacity-50"
          >
            Send Clipboard
          </button>
        </div>

        {signalError && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger mb-3">
            {signalError}
          </div>
        )}

        <div className="rounded-lg border border-surface-800 bg-surface-950/60 px-3 py-3 mb-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold text-white">Live Screen Frame (Host)</p>
            <p className="text-[11px] text-slate-500">
              {latestScreenFrame?.message.createdAt ?? "waiting"}
            </p>
          </div>

          {latestScreenFrame ? (
            <>
              <div className="rounded-lg border border-surface-800 overflow-hidden bg-black/70">
                <img
                  src={latestScreenFrame.dataUrl}
                  alt="Host live frame"
                  className="w-full max-h-[340px] object-contain"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs mt-2">
                <div>
                  <span className="text-slate-500">Frame:</span>{" "}
                  <span className="text-white">#{latestScreenFrame.payload.frameId ?? "n/a"}</span>
                </div>
                <div>
                  <span className="text-slate-500">Resolution:</span>{" "}
                  <span className="text-white">
                    {latestScreenFrame.payload.width ?? "?"}x{latestScreenFrame.payload.height ?? "?"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Encode:</span>{" "}
                  <span className="text-white">
                    {latestScreenFrame.payload.encodingFormat ?? "jpeg"} q{latestScreenFrame.payload.encodingQuality ?? "?"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">FPS (estimate):</span>{" "}
                  <span className="text-white">{screenFrameFpsEstimate ?? "n/a"}</span>
                </div>
                <div>
                  <span className="text-slate-500">Capture ms:</span>{" "}
                  <span className="text-white">{latestScreenFrame.payload.captureDurationMs ?? "n/a"}</span>
                </div>
                <div>
                  <span className="text-slate-500">Encode ms:</span>{" "}
                  <span className="text-white">{latestScreenFrame.payload.encodeDurationMs ?? "n/a"}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              Waiting for host screen frames (`screen.frame.data`) on this session.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-surface-800 bg-surface-950/60 px-3 py-3 mb-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-xs font-semibold text-white">Latest Host Input Ack</p>
            <p className="text-[11px] text-slate-500">
              {latestHostInputAck?.message.createdAt ?? "waiting"}
            </p>
          </div>

          {latestHostInputAck ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500">Result:</span>{" "}
                <span className={cn(
                  "font-semibold",
                  latestHostInputAck.payload.result === "accepted" ? "text-success" : "text-danger",
                )}>
                  {latestHostInputAck.payload.result ?? "unknown"}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Action:</span>{" "}
                <span className="text-white">{latestHostInputAck.payload.action ?? "n/a"}</span>
              </div>
              <div>
                <span className="text-slate-500">Session status:</span>{" "}
                <span className="text-white">{latestHostInputAck.payload.sessionStatus ?? "n/a"}</span>
              </div>
              <div>
                <span className="text-slate-500">Deny code:</span>{" "}
                <span className="text-white">{latestHostInputAck.payload.denyCode ?? "none"}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              No host acknowledgement received for control.input yet.
            </p>
          )}
        </div>

        {signalMessages.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 text-center border border-dashed border-surface-700 rounded-lg">
            No signaling messages for selected session.
          </div>
        ) : (
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {signalMessages.map((msg) => (
              <div key={msg.id} className="rounded-lg border border-surface-800 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-white">
                    #{msg.seq} {msg.messageType}
                  </p>
                  <p className="text-[11px] text-slate-500">{msg.senderType}</p>
                </div>
                <pre className="mt-1 text-[11px] text-slate-300 whitespace-pre-wrap break-all">
                  {JSON.stringify(msg.payload)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-600">
          <Radio className="w-10 h-10 mb-2" />
          <p className="text-sm">No sessions yet.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          <AnimatePresence initial={false}>
            {sessions.map((s) => (
              <motion.button
                key={s.sessionId}
                layout
                onClick={() => setSelectedId(s.sessionId)}
                className={cn(
                  "text-left px-4 py-3 rounded-xl border bg-surface-900 transition-colors",
                  selectedId === s.sessionId
                    ? "border-brand/60"
                    : "border-surface-800 hover:border-surface-600",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{s.sessionId}</p>
                    <p className="text-xs text-slate-500">endpoint: {s.endpointId}</p>
                  </div>
                  <div className={cn("text-xs font-semibold capitalize", STATUS_COLOR[s.status])}>
                    {s.status.replace("_", " ")}
                  </div>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
