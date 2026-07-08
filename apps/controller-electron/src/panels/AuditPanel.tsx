import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { apiUrl } from "@/lib/backend-url";
import { z } from "zod";

const TenantQuerySchema = z.string().trim().min(1, "Tenant ID is required");

const AuditRecordSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  tenantId: z.string(),
  operatorId: z.string(),
  code: z.string(),
  details: z.record(z.unknown()),
  endpointId: z.string().optional(),
  jobId: z.string().optional(),
});

const AuditResponseSchema = z.object({
  items: z.array(AuditRecordSchema),
  retentionDays: z.number().int().nonnegative().optional(),
});

type AuditRecord = z.infer<typeof AuditRecordSchema>;

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
  const [tenantId, setTenantId] = useState("");
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const parsedTenant = TenantQuerySchema.safeParse(tenantId);
    if (!parsedTenant.success) {
      setError(parsedTenant.error.issues[0]?.message ?? "Tenant ID is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        apiUrl(`/api/v1/audit?tenantId=${encodeURIComponent(parsedTenant.data)}`),
      );
      if (!res.ok) {
        setError(`Failed to load records (HTTP ${res.status}).`);
        return;
      }
      const parsed = AuditResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Unexpected response format from server.");
        return;
      }
      setRecords(parsed.data.items);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-6 text-slate-900">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Audit Log</h2>
        <p className="mt-0.5 text-sm text-slate-600">
          View security and action records.
        </p>
      </div>

      <div className="flex gap-2">
        <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Tenant ID" className="tv-input flex-1" />
        <button
          onClick={load}
          disabled={loading}
          className="tv-button-primary rounded-lg disabled:opacity-40"
        >
          {loading ? "Loading Records..." : "Load Records"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {!error && records.length === 0 ? (
        <div className="tv-empty flex flex-col items-center justify-center py-16">
          <ShieldCheck className="w-10 h-10 mb-3" />
          <p className="text-sm">Enter a tenant ID and click Load Records.</p>
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
                className="tv-card flex items-start gap-3 px-4 py-3"
              >
                <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", color)} />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm font-medium text-slate-900">{rec.code}</p>
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
