import { useEffect, useState } from "react";
import { BellRing, Send, Plus, CheckCircle2, XCircle, RefreshCcw } from "lucide-react";
import { apiUrl } from "@/lib/backend-url";
import { cn } from "@/lib/cn";

type AlertChannelType = "slack" | "teams" | "webhook" | "email";

type AlertChannel = {
  id: string;
  name: string;
  type: AlertChannelType;
  target: string;
  auth?: {
    headerName: string;
    tokenMasked: string;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type AlertDelivery = {
  channelId: string;
  status: "sent" | "failed";
  detail?: string;
  sentAt: string;
};

type AlertEvent = {
  id: string;
  category: "drift" | "test" | "system";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  createdAt: string;
  deliveries: AlertDelivery[];
};

const TYPE_OPTIONS: AlertChannelType[] = ["slack", "teams", "webhook", "email"];

export function AlertsPanel() {
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AlertChannelType>("webhook");
  const [newTarget, setNewTarget] = useState("");
  const [newAuthHeaderName, setNewAuthHeaderName] = useState("Authorization");
  const [newAuthToken, setNewAuthToken] = useState("");
  const [creating, setCreating] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const readAdminApiKey = () => {
    const envKey = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_ADMIN_API_KEY;
    if (envKey && envKey.trim().length > 0) return envKey.trim();
    const localKey = window.localStorage.getItem("adminApiKey");
    return localKey && localKey.trim().length > 0 ? localKey.trim() : "";
  };

  const authHeaders = (includeJson = false): Record<string, string> => {
    const headers: Record<string, string> = includeJson ? { "content-type": "application/json" } : {};
    const apiKey = readAdminApiKey();
    if (apiKey) headers["x-api-key"] = apiKey;
    return headers;
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [chRes, evRes] = await Promise.all([
        fetch(apiUrl("/api/v1/alerts/channels"), { headers: authHeaders() }),
        fetch(apiUrl("/api/v1/alerts/events"), { headers: authHeaders() }),
      ]);
      if (!chRes.ok) throw new Error(`channels_http_${chRes.status}`);
      if (!evRes.ok) throw new Error(`events_http_${evRes.status}`);
      const chBody = (await chRes.json()) as { items: AlertChannel[] };
      const evBody = (await evRes.json()) as { items: AlertEvent[] };
      setChannels(chBody.items ?? []);
      setEvents(evBody.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const createChannel = async () => {
    if (!newName.trim() || !newTarget.trim()) {
      setError("Name and target are required.");
      return;
    }
    if ((newAuthHeaderName.trim() && !newAuthToken.trim()) || (!newAuthHeaderName.trim() && newAuthToken.trim())) {
      setError("Auth header and token must be provided together.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: newName.trim(),
        type: newType,
        target: newTarget.trim(),
        enabled: true,
      };
      if (newAuthHeaderName.trim() && newAuthToken.trim()) {
        payload.authHeaderName = newAuthHeaderName.trim();
        payload.authToken = newAuthToken.trim();
      }

      const res = await fetch(apiUrl("/api/v1/alerts/channels"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`create_http_${res.status}`);
      setNewName("");
      setNewTarget("");
      setNewAuthToken("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create channel");
    } finally {
      setCreating(false);
    }
  };

  const toggleChannel = async (channel: AlertChannel) => {
    try {
      const res = await fetch(apiUrl(`/api/v1/alerts/channels/${channel.id}`), {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ enabled: !channel.enabled }),
      });
      if (!res.ok) throw new Error(`patch_http_${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update channel");
    }
  };

  const sendTest = async () => {
    setSendingTest(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/alerts/test"), { method: "POST", headers: authHeaders() });
      if (!res.ok) throw new Error(`test_http_${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send test alert");
    } finally {
      setSendingTest(false);
    }
  };

  const rotateToken = async (channel: AlertChannel) => {
    if (channel.type === "email") return;
    const nextToken = window.prompt(`Rotate token for ${channel.name}`, "");
    if (!nextToken || !nextToken.trim()) return;
    const nextHeaderRaw = window.prompt("Header name", channel.auth?.headerName ?? "Authorization");
    const nextHeader = nextHeaderRaw && nextHeaderRaw.trim().length > 0 ? nextHeaderRaw.trim() : undefined;
    try {
      const res = await fetch(apiUrl(`/api/v1/alerts/channels/${channel.id}/rotate-token`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          authToken: nextToken.trim(),
          ...(nextHeader !== undefined ? { authHeaderName: nextHeader } : {}),
        }),
      });
      if (!res.ok) throw new Error(`rotate_http_${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rotate token");
    }
  };

  return (
    <div className="flex flex-col gap-5 p-6 text-slate-900">
      <section className="tv-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-danger/30 bg-danger/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-danger">
              <BellRing className="h-3.5 w-3.5" />
              Alerts
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Drift Alerting</h2>
            <p className="mt-1 text-sm text-slate-600">Manage channels and verify proactive alerts for critical regressions.</p>
          </div>
          <button
            onClick={sendTest}
            disabled={sendingTest}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-sm font-semibold text-brand transition hover:bg-brand/20 disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {sendingTest ? "Sending..." : "Send Test Alert"}
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </section>

      <section className="tv-panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Alert Channels</h3>

        <div className="grid gap-2 md:grid-cols-[1.2fr_0.8fr_1.8fr_1fr_1fr_auto]">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Channel name"
            className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm outline-none focus:border-brand"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as AlertChannelType)}
            className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm outline-none focus:border-brand"
          >
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            placeholder={newType === "email" ? "secops@example.com" : "https://..."}
            className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            value={newAuthHeaderName}
            onChange={(e) => setNewAuthHeaderName(e.target.value)}
            placeholder="Auth header (optional)"
            className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            value={newAuthToken}
            onChange={(e) => setNewAuthToken(e.target.value)}
            placeholder="Auth token (optional)"
            className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={createChannel}
            disabled={creating}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>

        {loading ? <p className="text-xs text-slate-500">Loading channels...</p> : null}

        <div className="space-y-2">
          {channels.length === 0 ? (
            <p className="text-xs text-slate-500">No channels configured.</p>
          ) : channels.map((ch) => (
            <div key={ch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-white px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">{ch.name}</p>
                <p className="text-[11px] text-slate-500">{ch.type} · {ch.target}</p>
                {ch.auth ? <p className="text-[11px] text-slate-400">{ch.auth.headerName}: {ch.auth.tokenMasked}</p> : null}
              </div>
              <div className="flex items-center gap-1.5">
                {ch.type !== "email" ? (
                  <button
                    onClick={() => rotateToken(ch)}
                    className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand"
                    title="Rotate auth token"
                  >
                    <RefreshCcw className="h-3 w-3" />
                    rotate
                  </button>
                ) : null}
                <button
                  onClick={() => toggleChannel(ch)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                    ch.enabled
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-slate-300 bg-slate-100 text-slate-600",
                  )}
                >
                  {ch.enabled ? "enabled" : "disabled"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="tv-panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Recent Alert Events</h3>
        <div className="space-y-2 max-h-80 overflow-auto">
          {events.length === 0 ? (
            <p className="text-xs text-slate-500">No alert events yet.</p>
          ) : events.map((ev) => (
            <div key={ev.id} className="rounded-lg border border-blue-100 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{ev.title}</p>
                <span className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px]",
                  ev.severity === "critical" ? "border-danger/30 bg-danger/10 text-danger" :
                  ev.severity === "warning" ? "border-warn/30 bg-warn/10 text-warn" :
                  "border-brand/30 bg-brand/10 text-brand",
                )}>{ev.severity}</span>
              </div>
              <p className="text-[11px] text-slate-600">{ev.message}</p>
              <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-500">
                <span>{ev.category}</span>
                <span>{new Date(ev.createdAt).toLocaleString()}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ev.deliveries.map((d, idx) => (
                  <span key={`${ev.id}-${idx}`} className={cn(
                    "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px]",
                    d.status === "sent" ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger",
                  )}>
                    {d.status === "sent" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {d.channelId.slice(0, 12)}
                    {d.detail ? `(${d.detail})` : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
