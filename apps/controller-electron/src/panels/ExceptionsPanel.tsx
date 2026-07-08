import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldOff,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { apiUrl } from "@/lib/backend-url";

type ExceptionStatus = "pending" | "approved" | "rejected" | "expired";

type ExceptionRecord = {
  id: string;
  tenantId: string;
  planId: string;
  moduleId: string;
  controlId?: string;
  justification: string;
  requestedBy: string;
  approvedBy?: string;
  status: ExceptionStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
};

const STATUS_STYLE: Record<ExceptionStatus, string> = {
  pending:  "border-warn/30 bg-warn/10 text-warn",
  approved: "border-success/30 bg-success/10 text-success",
  rejected: "border-danger/30 bg-danger/10 text-danger",
  expired:  "border-slate-600 bg-slate-800 text-slate-400",
};

const STATUS_ICON: Record<ExceptionStatus, React.ElementType> = {
  pending:  Clock,
  approved: CheckCircle2,
  rejected: XCircle,
  expired:  AlertTriangle,
};

const DEFAULT_TENANT = "default";
const THIRTY_DAYS = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

export function ExceptionsPanel() {
  const [exceptions, setExceptions] = useState<ExceptionRecord[]>([]);
  const [query, setQuery] = useState<"tenant" | "plan">("tenant");
  const [queryValue, setQueryValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    planId: "",
    moduleId: "",
    controlId: "",
    justification: "",
    requestedBy: "operator-ui",
    expiresAt: THIRTY_DAYS,
  });
  const [creating, setCreating] = useState(false);

  // Review
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  const load = async () => {
    const val = queryValue.trim() || DEFAULT_TENANT;
    setLoading(true);
    setError(null);
    try {
      const param = query === "plan" ? `planId=${encodeURIComponent(val)}` : `tenantId=${encodeURIComponent(val)}`;
      const res = await fetch(apiUrl(`/api/v1/exceptions?${param}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: ExceptionRecord[] };
      setExceptions(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load exceptions");
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!form.planId.trim() || !form.moduleId.trim() || !form.justification.trim()) {
      setError("Plan ID, Module ID and Justification are required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/exceptions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: DEFAULT_TENANT,
          planId: form.planId.trim(),
          moduleId: form.moduleId.trim(),
          controlId: form.controlId.trim() || undefined,
          justification: form.justification.trim(),
          requestedBy: form.requestedBy.trim() || "operator-ui",
          expiresAt: new Date(form.expiresAt).toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowCreate(false);
      setForm({ planId: "", moduleId: "", controlId: "", justification: "", requestedBy: "operator-ui", expiresAt: THIRTY_DAYS });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create exception");
    } finally {
      setCreating(false);
    }
  };

  const review = async (id: string, status: "approved" | "rejected") => {
    setReviewBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/v1/exceptions/${id}/review`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, approvedBy: "operator-ui", notes: reviewNotes.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReviewingId(null);
      setReviewNotes("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit review");
    } finally {
      setReviewBusy(false);
    }
  };

  const daysUntilExpiry = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="flex flex-col gap-5 p-6 text-slate-900">
      {/* Header */}
      <section className="tv-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-warn/30 bg-warn/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-warn">
              <ShieldOff className="h-3.5 w-3.5" />
              Exceptions
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Exception Workflow</h2>
            <p className="mt-1 text-sm text-slate-600">
              Request, review and track time-limited exceptions for audit findings.
            </p>
          </div>

          <button
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-sm font-semibold text-brand transition hover:bg-brand/20"
          >
            <Plus className="h-4 w-4" />
            New Exception
          </button>
        </div>

        {/* Create form */}
        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-700">Request New Exception</p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] font-medium text-slate-600">Plan ID *</span>
                    <input value={form.planId} onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value }))}
                      placeholder="secaudit_plan_1"
                      className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] font-medium text-slate-600">Module ID *</span>
                    <input value={form.moduleId} onChange={(e) => setForm((f) => ({ ...f, moduleId: e.target.value }))}
                      placeholder="host.firewall-edr"
                      className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] font-medium text-slate-600">Control ID (optional)</span>
                    <input value={form.controlId} onChange={(e) => setForm((f) => ({ ...f, controlId: e.target.value }))}
                      placeholder="cis.10"
                      className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] font-medium text-slate-600">Expires At *</span>
                    <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                      className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] font-medium text-slate-600">Requested By *</span>
                    <input value={form.requestedBy} onChange={(e) => setForm((f) => ({ ...f, requestedBy: e.target.value }))}
                      className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand" />
                  </label>
                </div>

                <label className="grid gap-1">
                  <span className="text-[11px] font-medium text-slate-600">Justification *</span>
                  <textarea
                    value={form.justification}
                    onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))}
                    rows={3}
                    placeholder="Describe why this finding should be temporarily excepted…"
                    className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand resize-none"
                  />
                </label>

                <div className="flex gap-2">
                  <button
                    onClick={create}
                    disabled={creating}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
                  >
                    {creating ? "Submitting..." : "Submit Exception"}
                  </button>
                  <button
                    onClick={() => setShowCreate(false)}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Query bar */}
      <section className="tv-panel p-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex rounded-lg border border-blue-100 bg-white overflow-hidden text-xs font-semibold">
            <button
              onClick={() => setQuery("tenant")}
              className={cn("px-3 py-2 transition", query === "tenant" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50")}
            >
              By Tenant
            </button>
            <button
              onClick={() => setQuery("plan")}
              className={cn("px-3 py-2 transition", query === "plan" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50")}
            >
              By Plan
            </button>
          </div>
          <input
            value={queryValue}
            onChange={(e) => setQueryValue(e.target.value)}
            placeholder={query === "plan" ? "secaudit_plan_1" : "default"}
            className="flex-1 min-w-[180px] rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand"
          />
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {loading ? "Loading..." : "Load"}
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </section>

      {/* Exceptions list */}
      {exceptions.length === 0 ? (
        <div className="tv-panel flex flex-col items-center justify-center gap-3 p-12 text-center">
          <ShieldOff className="h-10 w-10 text-slate-600" />
          <p className="text-sm text-slate-600">No exceptions found. Use <strong>Load</strong> to fetch or <strong>New Exception</strong> to create one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {exceptions.map((exc) => {
              const Icon = STATUS_ICON[exc.status];
              const days = daysUntilExpiry(exc.expiresAt);
              const isReviewing = reviewingId === exc.id;
              return (
                <motion.div
                  key={exc.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="tv-panel p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", STATUS_STYLE[exc.status].split(" ").pop())} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{exc.moduleId}</p>
                        {exc.controlId ? (
                          <p className="text-[11px] text-slate-500">Control: {exc.controlId}</p>
                        ) : null}
                        <p className="text-[11px] text-slate-500">Plan: {exc.planId}</p>
                        <p className="mt-1 text-xs text-slate-700">{exc.justification}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", STATUS_STYLE[exc.status])}>
                        {exc.status}
                      </span>
                      <span className={cn(
                        "text-[10px]",
                        days <= 7 && exc.status === "approved" ? "text-danger font-semibold" : "text-slate-400",
                      )}>
                        {exc.status === "expired" ? "Expired" : days > 0 ? `${days}d left` : "Expiring"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                    <span>Requested by <strong className="text-slate-700">{exc.requestedBy}</strong></span>
                    {exc.approvedBy ? <span>Reviewed by <strong className="text-slate-700">{exc.approvedBy}</strong></span> : null}
                    {exc.notes ? <span className="italic text-slate-500">{exc.notes}</span> : null}
                    <span>{new Date(exc.createdAt).toLocaleDateString()}</span>
                  </div>

                  {/* Review actions */}
                  {exc.status === "pending" && (
                    <div className="mt-3">
                      {isReviewing ? (
                        <div className="space-y-2">
                          <textarea
                            value={reviewNotes}
                            onChange={(e) => setReviewNotes(e.target.value)}
                            rows={2}
                            placeholder="Optional notes for this review decision…"
                            className="w-full rounded-lg border border-blue-100 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-brand resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => review(exc.id, "approved")}
                              disabled={reviewBusy}
                              className="rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success transition hover:bg-success/20 disabled:opacity-60"
                            >
                              {reviewBusy ? "…" : "Approve"}
                            </button>
                            <button
                              onClick={() => review(exc.id, "rejected")}
                              disabled={reviewBusy}
                              className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/20 disabled:opacity-60"
                            >
                              {reviewBusy ? "…" : "Reject"}
                            </button>
                            <button
                              onClick={() => { setReviewingId(null); setReviewNotes(""); }}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setReviewingId(exc.id)}
                          className="rounded-lg border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand/20"
                        >
                          Review
                        </button>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
