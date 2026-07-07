import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, ChevronDown, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";

const CATALOG = [
  { id: "diagnostic.system.info",   label: "System Info",       risk: "low",      params: [] },
  { id: "security.firewall.status", label: "Firewall Status",   risk: "low",      params: [{ key: "profile", type: "select", options: ["domain", "private", "public"] }] },
  { id: "maintenance.service.restart", label: "Restart Service", risk: "medium", params: [{ key: "serviceId", type: "text", placeholder: "e.g. Spooler" }] },
  { id: "maintenance.network.reset",   label: "Network Reset",   risk: "high",   params: [{ key: "mode", type: "select", options: ["soft", "full"] }] },
] as const;

type RiskLevel = "low" | "medium" | "high";

const RISK_BADGE: Record<RiskLevel, string> = {
  low:    "bg-success/15 text-success border-success/30",
  medium: "bg-warn/15 text-warn border-warn/30",
  high:   "bg-danger/15 text-danger border-danger/30",
};

interface DispatchResult {
  id: string;
  status: string;
  requiresMfa?: boolean;
}

export function CommandPanel() {
  const [selected, setSelected] = useState(CATALOG[0].id);
  const [params, setParams] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const command = CATALOG.find((c) => c.id === selected)!;

  const handleDispatch = async () => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("http://localhost:3000/api/v1/commands/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: "tenant-1",
          endpointId: "endpoint-1",
          operatorId: "operator-1",
          catalogCommandId: command.id,
          requestedParams: params,
        }),
      });
      const body = await res.json() as DispatchResult;
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Dispatch Command</h2>
        <p className="text-sm text-slate-400 mt-0.5">
          Select a command from the catalog and execute it on the target endpoint.
        </p>
      </div>

      {/* Command selector */}
      <div className="grid gap-2">
        {CATALOG.map((cmd) => (
          <button
            key={cmd.id}
            onClick={() => { setSelected(cmd.id); setParams({}); setResult(null); setError(null); }}
            className={cn(
              "flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all",
              selected === cmd.id
                ? "bg-brand/10 border-brand/50 text-white"
                : "bg-surface-900 border-surface-700 text-slate-400 hover:border-surface-500 hover:text-white",
            )}
          >
            <span className="text-sm font-medium">{cmd.label}</span>
            <span
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide",
                RISK_BADGE[cmd.risk as RiskLevel],
              )}
            >
              {cmd.risk}
            </span>
          </button>
        ))}
      </div>

      {/* Params */}
      <AnimatePresence mode="wait">
        {command.params.length > 0 && (
          <motion.div
            key={command.id}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="grid gap-3"
          >
            {command.params.map((p) =>
              p.type === "select" ? (
                <div key={p.key} className="relative">
                  <label className="text-xs text-slate-400 mb-1 block capitalize">{p.key}</label>
                  <div className="relative">
                    <select
                      value={params[p.key] ?? ""}
                      onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                      className="w-full appearance-none bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand pr-8"
                    >
                      <option value="">Select…</option>
                      {(p as { options: readonly string[] }).options.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              ) : (
                <div key={p.key}>
                  <label className="text-xs text-slate-400 mb-1 block capitalize">{p.key}</label>
                  <input
                    type="text"
                    placeholder={"placeholder" in p ? p.placeholder : ""}
                    value={params[p.key] ?? ""}
                    onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-brand"
                  />
                </div>
              ),
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* MFA warning */}
      {command.risk === "high" && (
        <div className="flex items-center gap-2 px-4 py-3 bg-danger/10 border border-danger/30 rounded-xl text-sm text-danger">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          This command requires MFA step-up before dispatch.
        </div>
      )}

      {/* Dispatch button */}
      <button
        onClick={handleDispatch}
        disabled={loading}
        className={cn(
          "flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-sm transition-all",
          loading
            ? "bg-brand/40 text-white/50 cursor-not-allowed"
            : "bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20",
        )}
      >
        {loading ? (
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
        {loading ? "Dispatching…" : "Dispatch"}
      </button>

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "rounded-xl border px-4 py-3 text-sm font-mono",
              result.requiresMfa
                ? "bg-warn/10 border-warn/30 text-warn"
                : "bg-success/10 border-success/30 text-success",
            )}
          >
            <div className="font-semibold mb-1">
              {result.requiresMfa ? "⚠ MFA Required" : "✓ Dispatched"}
            </div>
            <div className="text-slate-400 text-xs break-all">
              Job ID: {result.id}<br />
              Status: {result.status}
            </div>
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border px-4 py-3 text-sm bg-danger/10 border-danger/30 text-danger"
          >
            ✕ {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
