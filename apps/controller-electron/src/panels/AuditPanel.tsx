import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface AuditRecord {
  id: string;
  createdAt: string;
  tenantId: string;
  operatorId: string;
  code: string;
  details: Record<string, unknown>;
}

const CODE_ICON: Record<string, React.ElementType> = {
  "command.job.blocked": AlertTriangle,
  "command.mfa.challenge.failed": X,
};

const CODE_COLOR: Record<string, string> = {
  "command.job.blocked": "text-warn",
  "command.mfa.challenge.failed": "text-danger",
  "command.job.completed": "text-success",
  "command.job.cancelled": "text-slate-400",
};

export function AuditPanel() {
  const [tenantId, setTenantId] = useState("tenant-1");
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!tenantId.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `http://localhost:3000/api/v1/audit?tenantId=${encodeURIComponent(tenantId)}`,
      );
      if (res.ok) {
        const body = await res.json() as { items: AuditRecord[] };
        setRecords(body.items ?? []);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Audit Trail</h2>
        <p className="text-sm text-slate-400 mt-0.5">
          90-day retention · sensitive fields redacted
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="Tenant ID"
          className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-brand"
        />
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 bg-brand hover:bg-brand-dark text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-40"
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-600">
          <ShieldCheck className="w-10 h-10 mb-3" />
          <p className="text-sm">Enter a tenant ID and click Load.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {records.map((rec, i) => {
            const Icon = CODE_ICON[rec.code] ?? ShieldCheck;
            const color = CODE_COLOR[rec.code] ?? "text-accent";
            return (
              <motion.div
                key={rec.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-start gap-3 px-4 py-3 bg-surface-900 border border-surface-800 rounded-xl"
              >
                <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", color)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-medium text-white">{rec.code}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(rec.createdAt).toLocaleString()} · op: {rec.operatorId}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
