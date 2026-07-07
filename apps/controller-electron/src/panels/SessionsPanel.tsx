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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const selected = useMemo(
    () => sessions.find((s) => s.sessionId === selectedId) ?? null,
    [sessions, selectedId],
  );

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
      </div>

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

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
