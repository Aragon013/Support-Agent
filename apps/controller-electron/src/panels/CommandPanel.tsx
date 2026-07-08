import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, ChevronDown, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { apiUrl } from "@/lib/backend-url";
import { z } from "zod";

const DispatchResultSchema = z.object({
  id: z.string(),
  status: z.string(),
  requiresMfa: z.boolean().optional(),
  riskLevel: z.string().optional(),
  mfaRequired: z.boolean().optional(),
  reason: z.string().optional(),
});

type DispatchResult = z.infer<typeof DispatchResultSchema>;

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
      const res = await fetch(apiUrl("/api/v1/commands/jobs"), {
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
      const parsed = DispatchResultSchema.safeParse(await res.json());
      if (!parsed.success) {
        setError("Unexpected response from server.");
        return;
      }
      setResult(parsed.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5 p-6 text-slate-900">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Run Command</h2>
        <p className="mt-0.5 text-sm text-slate-600">
          Choose a command and run it on the selected device.
        </p>
      </div>

      {/* Command selector */}
      <div className="grid gap-2">
        {CATALOG.map((cmd) => (
          <button
            key={cmd.id}
            onClick={() => { setSelected(cmd.id); setParams({}); setResult(null); setError(null); }}
            className={cn(
              "flex items-center justify-between rounded-xl border px-4 py-3 text-left shadow-sm transition-all",
              selected === cmd.id
                ? "border-brand/50 bg-brand/10 text-slate-900"
                : "border-blue-100 bg-white text-slate-600 hover:border-brand/30 hover:text-slate-900",
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
                      className="tv-input w-full appearance-none pr-8"
                    >
                      <option value="">Select…</option>
                      {(p as { options: readonly string[] }).options.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
              ) : (
                <div key={p.key}>
                  <label className="mb-1 block text-xs capitalize text-slate-500">{p.key}</label>
                  <input
                    type="text"
                    placeholder={"placeholder" in p ? p.placeholder : ""}
                    value={params[p.key] ?? ""}
                    onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                    className="tv-input w-full"
                  />
                </div>
              ),
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* MFA warning */}
      {command.risk === "high" && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger shadow-sm">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          This command requires MFA before run.
        </div>
      )}

      {/* Dispatch button */}
      <button
        onClick={handleDispatch}
        disabled={loading}
        className={cn(
          "tv-button-primary w-full py-3 transition-all",
          loading
            ? "cursor-not-allowed bg-brand/40 text-white/50"
            : "shadow-lg shadow-brand/20",
        )}
      >
        {loading ? (
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
        {loading ? "Running Command..." : "Run Command"}
      </button>

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "rounded-xl border px-4 py-3 text-sm font-mono shadow-sm",
              result.requiresMfa
                ? "bg-warn/10 border-warn/30 text-warn"
                : "bg-success/10 border-success/30 text-success",
            )}
          >
            <div className="font-semibold mb-1">
              {result.requiresMfa ? "⚠ MFA Required" : "✓ Command Started"}
            </div>
            <div className="text-xs break-all text-slate-500">
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
            className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger shadow-sm"
          >
            ✕ {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
