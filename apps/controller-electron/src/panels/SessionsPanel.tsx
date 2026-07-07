import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, PlayCircle, Radio, Square, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  computeSessionActionPermissions,
  type SessionCapability,
} from "./sessions-capabilities";
import { resolveInstallProfile, type InstallProfile } from "./install-profile";

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
  requestedCapabilities?: SessionCapability[];
  updatedAt: string;
};

type SessionSignalMessageType =
  | "signal.offer"
  | "signal.answer"
  | "signal.ice-candidate"
  | "control.input"
  | "clipboard.sync"
  | "screen.frame.stub"
  | "screen.frame.data"
  | "screen.frame.feedback";

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

type ScreenFrameFeedbackPayload = {
  targetFps?: number;
  targetQuality?: number;
  maxInFlight?: number;
  measuredRttMs?: number;
  reason?: string;
};

type StreamProfile = "low-latency" | "balanced" | "quality";
type AutoTuneMode = "conservative" | "balanced" | "aggressive";

type AutoTuneThresholds = {
  warnRttMs: number;
  criticalRttMs: number;
  fpsPenalty: number;
  qualityPenalty: number;
};

type EndpointSessionPolicy = {
  endpointId: string;
  unattendedEnabled: boolean;
  requiresUserConsent: boolean;
  maxActiveControlSessions: number;
  installProfile?: InstallProfile;
};

type SessionHandoffDraft = {
  tenantId?: string;
  endpointId?: string;
  operatorId?: string;
  accessMode?: "view" | "control";
  unattended?: boolean;
  selectedSessionId?: string;
  sessionRecord?: SessionView;
  createdAt?: string;
};

const STREAM_PREFS_VERSION = 1;
const SESSION_HANDOFF_KEY = "rsp.sessions.handoff.v1";

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
  const [tenantId, setTenantId] = useState("");
  const [endpointId, setEndpointId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [accessMode, setAccessMode] = useState<"view" | "control">("control");
  const [unattended, setUnattended] = useState(false);
  const [installProfile, setInstallProfile] = useState<InstallProfile>("support_full");
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [signalWsConnected, setSignalWsConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signalBusy, setSignalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [signalMessages, setSignalMessages] = useState<SessionSignalMessage[]>([]);
  const [targetFps, setTargetFps] = useState("");
  const [targetQuality, setTargetQuality] = useState("");
  const [maxInFlight, setMaxInFlight] = useState("1");
  const [autoStreamFeedback, setAutoStreamFeedback] = useState(true);
  const [autoTuneMode, setAutoTuneMode] = useState<AutoTuneMode>("balanced");
  const [autoIntervalMs, setAutoIntervalMs] = useState("");
  const [streamProfile, setStreamProfile] = useState<StreamProfile>("balanced");
  const [warnRttMs, setWarnRttMs] = useState("");
  const [criticalRttMs, setCriticalRttMs] = useState("");
  const [fpsPenalty, setFpsPenalty] = useState("");
  const [qualityPenalty, setQualityPenalty] = useState("");
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const signalWsRef = useRef<WebSocket | null>(null);

  const selected = useMemo(
    () => sessions.find((s) => s.sessionId === selectedId) ?? null,
    [sessions, selectedId],
  );

  const isActiveSession =
    selected?.status !== undefined &&
    selected.status !== "ended" &&
    selected.status !== "failed";

  const sessionPhase = useMemo(() => {
    if (!selected) {
      return sessions.length > 0 ? "queue_ready" : "idle";
    }
    return selected.status;
  }, [selected, sessions.length]);

  const selectedPermissions = useMemo(
    () => computeSessionActionPermissions(selected?.requestedCapabilities),
    [selected?.requestedCapabilities],
  );

  useEffect(() => {
    const applyHandoff = () => {
      const raw = localStorage.getItem(SESSION_HANDOFF_KEY);
      if (!raw) {
        return;
      }

      try {
        const draft = JSON.parse(raw) as SessionHandoffDraft;
        if (draft.tenantId) setTenantId(draft.tenantId);
        if (draft.endpointId) setEndpointId(draft.endpointId);
        if (draft.operatorId) setOperatorId(draft.operatorId);
        if (draft.accessMode) setAccessMode(draft.accessMode);
        if (typeof draft.unattended === "boolean") setUnattended(draft.unattended);

        if (draft.sessionRecord) {
          setSessions((prev) => {
            const existing = prev.find((session) => session.sessionId === draft.sessionRecord?.sessionId);
            if (existing) {
              return prev.map((session) =>
                session.sessionId === draft.sessionRecord?.sessionId ? { ...session, ...draft.sessionRecord } : session,
              );
            }

            return [draft.sessionRecord!, ...prev];
          });
        }

        if (draft.selectedSessionId) {
          setSelectedId(draft.selectedSessionId);
        }

        if (draft.endpointId) {
          setHandoffNotice(`Ready from Support for ${draft.endpointId}. ${draft.selectedSessionId ? "Session selected." : "Review mode and create the session."}`);
        }
      } catch {
        // ignore malformed handoff state
      } finally {
        localStorage.removeItem(SESSION_HANDOFF_KEY);
      }
    };

    applyHandoff();
    window.addEventListener("rsp:navigate-sessions", applyHandoff);
    return () => {
      window.removeEventListener("rsp:navigate-sessions", applyHandoff);
    };
  }, []);

  useEffect(() => {
    const applyHandoff = () => {
      const raw = localStorage.getItem(SESSION_HANDOFF_KEY);
      if (!raw) {
        return;
      }

      try {
        const draft = JSON.parse(raw) as SessionHandoffDraft;
        if (draft.tenantId) {
          setTenantId(draft.tenantId);
        }
        if (draft.endpointId) {
          setEndpointId(draft.endpointId);
        }
        if (draft.operatorId) {
          setOperatorId(draft.operatorId);
        }
        if (draft.accessMode) {
          setAccessMode(draft.accessMode);
        }
        if (typeof draft.unattended === "boolean") {
          setUnattended(draft.unattended);
        }

        if (draft.endpointId) {
          setHandoffNotice(`Prefilled from Support for ${draft.endpointId}. Review mode and create the session.`);
        }
      } catch {
        // ignore malformed handoff state
      } finally {
        localStorage.removeItem(SESSION_HANDOFF_KEY);
      }
    };

    applyHandoff();
    window.addEventListener("rsp:navigate-sessions", applyHandoff);
    return () => {
      window.removeEventListener("rsp:navigate-sessions", applyHandoff);
    };
  }, []);

  useEffect(() => {
    const endpoint = endpointId.trim();
    if (!endpoint) {
      setPolicyError(null);
      return;
    }

    const controller = new AbortController();

    const loadPolicy = async () => {
      setPolicyLoading(true);
      setPolicyError(null);

      try {
        const res = await fetch(
          `http://localhost:3000/api/v1/endpoints/${encodeURIComponent(endpoint)}/session-policy`,
          { signal: controller.signal },
        );

        if (!res.ok) {
          throw new Error(`policy_http_${res.status}`);
        }

        const body = await res.json() as EndpointSessionPolicy;
        setInstallProfile(resolveInstallProfile(body.installProfile));
      } catch (e) {
        if (controller.signal.aborted) {
          return;
        }
        setPolicyError(e instanceof Error ? e.message : String(e));
        setInstallProfile(resolveInstallProfile(undefined));
      } finally {
        if (!controller.signal.aborted) {
          setPolicyLoading(false);
        }
      }
    };

    void loadPolicy();

    return () => {
      controller.abort();
    };
  }, [endpointId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    const controller = new AbortController();

    const loadSelectedSession = async () => {
      try {
        const res = await fetch(
          `http://localhost:3000/api/v1/sessions/${selectedId}`,
          { signal: controller.signal },
        );

        if (!res.ok) {
          return;
        }

        const body = await res.json() as {
          id: string;
          requestedCapabilities?: SessionCapability[];
          approvalMode?: string;
          routeMode?: string;
        };

        if (controller.signal.aborted) {
          return;
        }

        setSessions((prev) => {
          const idx = prev.findIndex((session) => session.sessionId === selectedId);
          if (idx < 0) {
            return prev;
          }

          const next = [...prev];
          next[idx] = {
            ...next[idx],
            requestedCapabilities: Array.isArray(body.requestedCapabilities)
              ? body.requestedCapabilities
              : next[idx].requestedCapabilities,
            approvalMode: body.approvalMode ?? next[idx].approvalMode,
            routeMode: body.routeMode ?? next[idx].routeMode,
          };
          return next;
        });
      } catch {
        // keep existing UI state when read fails
      }
    };

    void loadSelectedSession();

    return () => {
      controller.abort();
    };
  }, [selectedId]);

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

  const latestControllerFrameFeedback = useMemo(() => {
    for (const msg of signalMessages) {
      if (msg.senderType === "controller" && msg.messageType === "screen.frame.feedback") {
        return msg.payload as ScreenFrameFeedbackPayload;
      }
    }

    return null;
  }, [signalMessages]);

  const liveFrameAgeMs = useMemo(() => {
    const capturedAt = latestScreenFrame?.payload.capturedAt;
    if (!capturedAt) {
      return null;
    }

    return Math.max(0, Date.now() - capturedAt);
  }, [latestScreenFrame]);

  const latencyBadge = useMemo(() => {
    const age = liveFrameAgeMs;
    if (age === null) {
      return { label: "n/a", className: "text-slate-400" };
    }

    if (age > 1500) {
      return { label: `high (${Math.round(age)}ms)`, className: "text-danger" };
    }
    if (age > 900) {
      return { label: `medium (${Math.round(age)}ms)`, className: "text-warn" };
    }

    return { label: `low (${Math.round(age)}ms)`, className: "text-success" };
  }, [liveFrameAgeMs]);

  const thresholds = useMemo<AutoTuneThresholds>(() => {
    const parsedWarn = Number(warnRttMs);
    const parsedCritical = Number(criticalRttMs);
    const parsedFpsPenalty = Number(fpsPenalty);
    const parsedQualityPenalty = Number(qualityPenalty);

    const safeWarn = Number.isFinite(parsedWarn) && parsedWarn >= 200
      ? Math.floor(parsedWarn)
      : 900;
    const safeCriticalRaw = Number.isFinite(parsedCritical) && parsedCritical >= safeWarn + 100
      ? Math.floor(parsedCritical)
      : 1500;
    const safeCritical = Math.max(safeWarn + 100, safeCriticalRaw);

    return {
      warnRttMs: safeWarn,
      criticalRttMs: safeCritical,
      fpsPenalty: Number.isFinite(parsedFpsPenalty)
        ? Math.max(1, Math.min(8, Math.floor(parsedFpsPenalty)))
        : 2,
      qualityPenalty: Number.isFinite(parsedQualityPenalty)
        ? Math.max(5, Math.min(60, Math.floor(parsedQualityPenalty)))
        : 20,
    };
  }, [criticalRttMs, fpsPenalty, qualityPenalty, warnRttMs]);

  useEffect(() => {
    const key = `rsp.streamPrefs.v${STREAM_PREFS_VERSION}.${tenantId}.${operatorId}`;
    const value = JSON.stringify({
      targetFps,
      targetQuality,
      maxInFlight,
      autoStreamFeedback,
      autoTuneMode,
      autoIntervalMs,
      streamProfile,
      warnRttMs,
      criticalRttMs,
      fpsPenalty,
      qualityPenalty,
    });
    localStorage.setItem(key, value);
  }, [
    autoIntervalMs,
    autoStreamFeedback,
    autoTuneMode,
    criticalRttMs,
    fpsPenalty,
    maxInFlight,
    operatorId,
    qualityPenalty,
    streamProfile,
    targetFps,
    targetQuality,
    tenantId,
    warnRttMs,
  ]);

  const applyStreamProfile = (profile: StreamProfile) => {
    setStreamProfile(profile);

    if (profile === "low-latency") {
      setTargetFps("12");
      setTargetQuality("45");
      setMaxInFlight("1");
      return;
    }

    if (profile === "quality") {
      setTargetFps("6");
      setTargetQuality("75");
      setMaxInFlight("2");
      return;
    }

    setTargetFps("8");
    setTargetQuality("60");
    setMaxInFlight("1");
  };

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

  useEffect(() => {
    if (!autoStreamFeedback || !selected || !isActiveSession || !latestScreenFrame?.payload.capturedAt) {
      return;
    }

    const parsedInterval = Number(autoIntervalMs);
    const tickMs = Number.isFinite(parsedInterval) && parsedInterval >= 1000
      ? Math.min(10_000, Math.floor(parsedInterval))
      : 2500;

    const timer = setInterval(() => {
      const capturedAt = latestScreenFrame.payload.capturedAt;
      if (!capturedAt) {
        return;
      }

      const frameAgeMs = Math.max(0, Date.now() - capturedAt);
      const baseFps = Number(targetFps);
      const baseQuality = Number(targetQuality);
      const baseMaxInFlight = Number(maxInFlight);
      const desiredFps = Number.isFinite(baseFps) && baseFps > 0 ? Math.max(1, Math.min(30, baseFps)) : 8;
      const desiredQuality = Number.isFinite(baseQuality) && baseQuality > 0
        ? Math.max(10, Math.min(100, baseQuality))
        : 60;
      const desiredMaxInFlight = Number.isFinite(baseMaxInFlight) && baseMaxInFlight > 0
        ? Math.max(1, Math.min(2, Math.floor(baseMaxInFlight)))
        : 1;

      let adaptedFps = desiredFps;
      let adaptedQuality = desiredQuality;
      let adaptedMaxInFlight = desiredMaxInFlight;

      const modeMultiplier =
        autoTuneMode === "aggressive"
          ? 1.3
          : autoTuneMode === "conservative"
            ? 0.75
            : 1;
      const pressure = {
        high: thresholds.warnRttMs,
        critical: thresholds.criticalRttMs,
        fpsPenalty: Math.max(1, Math.round(thresholds.fpsPenalty * modeMultiplier)),
        qualityPenalty: Math.max(5, Math.round(thresholds.qualityPenalty * modeMultiplier)),
      };

      if (frameAgeMs > pressure.critical) {
        adaptedFps = Math.max(2, desiredFps - pressure.fpsPenalty);
        adaptedQuality = Math.max(20, desiredQuality - pressure.qualityPenalty);
        adaptedMaxInFlight = 1;
      } else if (frameAgeMs > pressure.high) {
        adaptedFps = Math.max(2, desiredFps - 1);
        adaptedQuality = Math.max(30, desiredQuality - Math.max(10, Math.floor(pressure.qualityPenalty / 2)));
      }

      void sendSignal("screen.frame.feedback", {
        targetFps: adaptedFps,
        targetQuality: adaptedQuality,
        maxInFlight: adaptedMaxInFlight,
        measuredRttMs: frameAgeMs,
        reason: `controller.auto.${autoTuneMode}`,
      }, { silent: true });
    }, tickMs);

    return () => {
      clearInterval(timer);
    };
  }, [
    autoStreamFeedback,
    autoIntervalMs,
    autoTuneMode,
    isActiveSession,
    latestScreenFrame,
    maxInFlight,
    selected,
    targetFps,
    targetQuality,
    thresholds,
  ]);

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
          "x-endpoint-install-profile": installProfile,
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
        requestedCapabilities?: SessionCapability[];
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
          requestedCapabilities: body.requestedCapabilities,
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
    opts?: { silent?: boolean },
  ) => {
    if (!selected) {
      return;
    }

    if (!opts?.silent) {
      setSignalBusy(true);
    }
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
      if (!opts?.silent) {
        setSignalBusy(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-5 text-slate-900">
      <section className="tv-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Remote Sessions</h2>
            <p className="mt-1 text-sm text-slate-600">Start a remote session, approve it, and track connection status.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold", wsConnected ? "border-success/40 bg-success/10 text-success" : "border-slate-200 bg-slate-50 text-slate-500")}>
              {wsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {wsConnected ? "Live" : "Disconnected"}
            </span>
            <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-slate-700">
              {policyLoading ? "syncing policy" : installProfile}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[1.5fr_1fr_1fr_0.8fr]">
          <input
            value={endpointId}
            onChange={(e) => setEndpointId(e.target.value)}
            placeholder="Endpoint ID"
            className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand"
          />
          <input
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="Tenant ID"
            className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand"
          />
          <input
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
            placeholder="Operator ID"
            className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand"
          />
          <select
            value={accessMode}
            onChange={(e) => setAccessMode(e.target.value as "view" | "control")}
            className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand"
          >
            <option value="control">Control</option>
            <option value="view">View only</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={createSession}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            <PlayCircle className="w-4 h-4" />
            Start Session
          </button>
          <button
            onClick={approveSelected}
            disabled={busy || !selected || selected.status !== "pending_approval"}
            className="inline-flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-4 py-2 text-sm font-semibold text-success disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            Approve Session
          </button>
          <button
            onClick={endSelected}
            disabled={busy || !selected || selected.status === "ended" || selected.status === "failed"}
            className="inline-flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-sm font-semibold text-danger disabled:opacity-50"
          >
            <Square className="w-4 h-4" />
            End Session
          </button>
          <button
            onClick={() => transitionSelected("connected_p2p")}
            disabled={busy || !selected || !isActiveSession}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-50"
          >
            Set Direct Route
          </button>
          <button
            onClick={() => transitionSelected("connected_relay")}
            disabled={busy || !selected || !isActiveSession}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-50"
          >
            Set Relay Route
          </button>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 ml-2">
            <input type="checkbox" checked={unattended} onChange={(e) => setUnattended(e.target.checked)} className="accent-brand" />
            Unattended
          </label>
          <button
            onClick={() => setShowAdvancedTools((v) => !v)}
            className="tv-button-soft"
          >
            {showAdvancedTools ? "Switch to Basic" : "Switch to Advanced"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-slate-700">
            Status: {sessionPhase.replaceAll("_", " ")}
          </span>
          <span className={cn("rounded-full border px-2.5 py-1", wsConnected ? "border-success/40 bg-success/10 text-success" : "border-slate-200 bg-slate-50 text-slate-500")}>
            Events: {wsConnected ? "live" : "offline"}
          </span>
          <span className={cn("rounded-full border px-2.5 py-1", signalWsConnected ? "border-success/40 bg-success/10 text-success" : "border-slate-200 bg-slate-50 text-slate-500")}>
            Signal: {signalWsConnected ? "live" : "offline"}
          </span>
          <span className="rounded-full border border-blue-100 bg-white px-2.5 py-1 text-slate-700">
            Mode: {showAdvancedTools ? "advanced" : "basic"}
          </span>
        </div>

        {selected && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Capabilities:</span>
            {(selected.requestedCapabilities && selected.requestedCapabilities.length > 0
              ? selected.requestedCapabilities : ["unknown"]).map((cap) => (
              <span key={cap} className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-slate-700">{cap}</span>
            ))}
          </div>
        )}

        {handoffNotice && (
          <div className="mt-3 rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-xs text-brand">
            {handoffNotice}
          </div>
        )}
        {policyError && (
          <div className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            {policyError}
          </div>
        )}
        {error && (
          <div className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
      <div className="tv-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Live Session Feed</h3>
            <p className="text-xs text-slate-600 mt-0.5">Send test input and review screen updates from the remote device.</p>
          </div>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", signalWsConnected ? "border-success/40 bg-success/10 text-success" : "border-slate-200 bg-slate-50 text-slate-500")}>
            {signalWsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {signalWsConnected ? "Signal Live" : "Signal Off"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {showAdvancedTools && (
            <>
              <button
                onClick={() =>
                  sendSignal("signal.offer", {
                    sdp: "v=0\\no=- 0 0 IN IP4 127.0.0.1\\ns=RemoteSupportPro\\nt=0 0",
                    media: "stub",
                  })
                }
                disabled={signalBusy || !selected || !isActiveSession}
                className="rounded-lg border border-blue-100 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm disabled:opacity-50"
              >
                Send Offer Signal
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
                className="rounded-lg border border-blue-100 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm disabled:opacity-50"
              >
                Send ICE Signal
              </button>
            </>
          )}
          <button
            onClick={() =>
              sendSignal("control.input", {
                action: "mouse.move",
                x: 320,
                y: 180,
              })
            }
            disabled={signalBusy || !selected || !isActiveSession || !selectedPermissions.canSendInput}
            className="rounded-lg border border-blue-100 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm disabled:opacity-50"
            title={!selectedPermissions.canSendInput ? "Input not allowed by this session." : undefined}
          >
            Send Input Test
          </button>
          <button
            onClick={() =>
              sendSignal("clipboard.sync", {
                text: "controller-clipboard-stub",
                format: "text/plain",
              })
            }
            disabled={signalBusy || !selected || !isActiveSession || !selectedPermissions.canSendClipboard}
            className="rounded-lg border border-blue-100 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm disabled:opacity-50"
            title={!selectedPermissions.canSendClipboard ? "Clipboard not allowed by this session." : undefined}
          >
            Send Clipboard Test
          </button>
        </div>

        {signalError && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger mb-3">
            {signalError}
          </div>
        )}

        <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-3 mb-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold text-slate-900">Live Screen Frame (Host)</p>
            <p className="text-[11px] text-slate-500">
              {latestScreenFrame?.message.createdAt ?? "waiting"}
            </p>
          </div>

          {latestScreenFrame ? (
            <>
              <div className="rounded-lg border border-blue-100 overflow-hidden bg-black">
                <img
                  src={latestScreenFrame.dataUrl}
                  alt="Host live frame"
                  className="w-full max-h-[340px] object-contain"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs mt-2">
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-2 py-1.5">
                  <span className="text-slate-500">Frame</span>{" "}
                  <span className="font-semibold text-slate-900">#{latestScreenFrame.payload.frameId ?? "n/a"}</span>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-2 py-1.5">
                  <span className="text-slate-500">Resolution</span>{" "}
                  <span className="font-semibold text-slate-900">
                    {latestScreenFrame.payload.width ?? "?"}x{latestScreenFrame.payload.height ?? "?"}
                  </span>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-2 py-1.5">
                  <span className="text-slate-500">Encode</span>{" "}
                  <span className="font-semibold text-slate-900">
                    {latestScreenFrame.payload.encodingFormat ?? "jpeg"} q{latestScreenFrame.payload.encodingQuality ?? "?"}
                  </span>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-2 py-1.5">
                  <span className="text-slate-500">FPS</span>{" "}
                  <span className="font-semibold text-slate-900">{screenFrameFpsEstimate ?? "n/a"}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">Waiting for screen data from this session.</p>
          )}
        </div>

        {showAdvancedTools && (
        <div className="rounded-lg border border-blue-100 bg-white px-3 py-3 mb-3 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold text-slate-900">Video Quality Controls</p>
            <p className="text-[11px] text-slate-500">Controller to host</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              Target FPS
              <input
                value={targetFps}
                onChange={(e) => setTargetFps(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-brand"
                placeholder="8"
              />
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              JPEG Quality
              <input
                value={targetQuality}
                onChange={(e) => setTargetQuality(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-brand"
                placeholder="60"
              />
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              Max In-Flight
              <select
                value={maxInFlight}
                onChange={(e) => setMaxInFlight(e.target.value)}
                className="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-brand"
              >
                <option value="1">1 (safe)</option>
                <option value="2">2 (higher throughput)</option>
              </select>
            </label>
            <button
              onClick={() => {
                const parsedFps = Number(targetFps);
                const parsedQuality = Number(targetQuality);
                const parsedMaxInFlight = Number(maxInFlight);
                const feedbackPayload: ScreenFrameFeedbackPayload = {
                  reason: "controller.manual",
                };

                if (Number.isFinite(parsedFps) && parsedFps > 0) {
                  feedbackPayload.targetFps = Math.max(1, Math.min(30, parsedFps));
                }
                if (Number.isFinite(parsedQuality) && parsedQuality > 0) {
                  feedbackPayload.targetQuality = Math.max(10, Math.min(100, parsedQuality));
                }
                if (Number.isFinite(parsedMaxInFlight) && parsedMaxInFlight > 0) {
                  feedbackPayload.maxInFlight = Math.max(1, Math.min(2, Math.floor(parsedMaxInFlight)));
                }

                void sendSignal("screen.frame.feedback", feedbackPayload as Record<string, unknown>);
              }}
              disabled={signalBusy || !selected || !isActiveSession || !selectedPermissions.canControlStream}
              className="mt-5 px-3 py-1.5 rounded-lg bg-brand/20 border border-brand/40 text-brand text-xs font-semibold disabled:opacity-50 md:col-span-3"
              title={!selectedPermissions.canControlStream ? "This session does not allow screen capability." : undefined}
            >
              Apply Video Targets
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-2">
            <button
              onClick={() => applyStreamProfile("low-latency")}
              title="Prioriza respuesta visual (mas FPS, menos calidad)"
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] border",
                streamProfile === "low-latency"
                  ? "border-success/60 text-success bg-success/10"
                  : "border-blue-100 text-slate-700 bg-white",
              )}
            >
              Low Latency
            </button>
            <button
              onClick={() => applyStreamProfile("balanced")}
              title="Balance entre fluidez y nitidez"
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] border",
                streamProfile === "balanced"
                  ? "border-brand/60 text-brand bg-brand/10"
                  : "border-blue-100 text-slate-700 bg-white",
              )}
            >
              Balanced
            </button>
            <button
              onClick={() => applyStreamProfile("quality")}
              title="Prioriza nitidez (menos FPS, mas calidad)"
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] border",
                streamProfile === "quality"
                  ? "border-accent/60 text-accent bg-accent/10"
                  : "border-blue-100 text-slate-700 bg-white",
              )}
            >
              Quality
            </button>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 mb-2">
            <input
              type="checkbox"
              checked={autoStreamFeedback}
              onChange={(e) => setAutoStreamFeedback(e.target.checked)}
              className="accent-brand"
            />
            Auto-adjust by latency
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              Auto Tune Mode
              <select
                value={autoTuneMode}
                onChange={(e) => setAutoTuneMode(e.target.value as AutoTuneMode)}
                className="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-900"
              >
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              Auto Interval (ms)
              <input
                value={autoIntervalMs}
                onChange={(e) => setAutoIntervalMs(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-900"
                placeholder="2500"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              Warn RTT (ms)
              <input
                value={warnRttMs}
                onChange={(e) => setWarnRttMs(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-900"
                placeholder="900"
              />
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              Critical RTT (ms)
              <input
                value={criticalRttMs}
                onChange={(e) => setCriticalRttMs(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-900"
                placeholder="1500"
              />
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              FPS Penalty
              <input
                value={fpsPenalty}
                onChange={(e) => setFpsPenalty(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-900"
                placeholder="2"
              />
            </label>
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              Quality Penalty
              <input
                value={qualityPenalty}
                onChange={(e) => setQualityPenalty(e.target.value)}
                inputMode="numeric"
                className="rounded-lg border border-blue-100 bg-white px-2 py-1.5 text-xs text-slate-900"
                placeholder="20"
              />
            </label>
          </div>

          <p className="text-[11px] text-slate-500">
            Last sent: fps {latestControllerFrameFeedback?.targetFps ?? "n/a"}, q{latestControllerFrameFeedback?.targetQuality ?? "n/a"}, inFlight {latestControllerFrameFeedback?.maxInFlight ?? "n/a"}
          </p>
          <p className={cn("text-[11px] mt-1", latencyBadge.className)}>
            Live frame latency: {latencyBadge.label}
          </p>
        </div>
        )}

        {showAdvancedTools && (
        <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-3 mb-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-xs font-semibold text-slate-900">Latest Host Response</p>
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
                <span className="text-slate-900">{latestHostInputAck.payload.action ?? "n/a"}</span>
              </div>
              <div>
                <span className="text-slate-500">Session status:</span>{" "}
                <span className="text-slate-900">{latestHostInputAck.payload.sessionStatus ?? "n/a"}</span>
              </div>
              <div>
                <span className="text-slate-500">Deny code:</span>{" "}
                <span className="text-slate-900">{latestHostInputAck.payload.denyCode ?? "none"}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              No host response received yet.
            </p>
          )}
        </div>
        )}

        {showAdvancedTools && (
          signalMessages.length === 0 ? (
            <div className="text-xs text-slate-500 py-4 text-center border border-dashed border-blue-100 rounded-lg">
              No signaling messages for selected session.
            </div>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
              {signalMessages.map((msg) => (
                <div key={msg.id} className="rounded-lg border border-blue-100 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-900">
                      #{msg.seq} {msg.messageType}
                    </p>
                    <p className="text-[11px] text-slate-500">{msg.senderType}</p>
                  </div>
                  <pre className="mt-1 text-[11px] text-slate-700 whitespace-pre-wrap break-all">
                    {JSON.stringify(msg.payload)}
                  </pre>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <aside className="tv-panel p-4 xl:sticky xl:top-4 xl:self-start">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Session List</h3>
          <span className="text-xs text-slate-500">{sessions.length} total</span>
        </div>
        {sessions.length === 0 ? (
          <div className="tv-empty flex flex-col items-center justify-center py-12">
            <Radio className="w-9 h-9 mb-2" />
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
                    "text-left px-4 py-3 rounded-xl border bg-white transition-colors",
                    selectedId === s.sessionId
                      ? "border-brand/60 bg-brand/5"
                      : "border-blue-100 hover:border-brand/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{s.sessionId}</p>
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
      </aside>
      </div>
    </div>
  );
}
