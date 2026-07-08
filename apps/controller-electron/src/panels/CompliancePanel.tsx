import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
  HelpCircle,
  BarChart2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { apiUrl } from "@/lib/backend-url";

type ControlStatus = "passed" | "failed" | "partial" | "not_applicable" | "not_evaluated";

type ControlResult = {
  controlId: string;
  name: string;
  status: ControlStatus;
  score: number;
  modulesCovered: string[];
  evidence: string[];
};

type ComplianceReport = {
  packId: string;
  packName: string;
  generatedAt: string;
  overallScore: number;
  controlsPassed: number;
  controlsFailed: number;
  controlsPartial: number;
  controlsNotApplicable: number;
  controlsNotEvaluated: number;
  controls: ControlResult[];
};

type PackSummary = {
  id: string;
  name: string;
  shortName: string;
  version: string;
  controlCount: number;
};

const PACKS: PackSummary[] = [
  { id: "cis", name: "CIS Controls", shortName: "CIS", version: "v8", controlCount: 14 },
  { id: "nist-csf", name: "NIST Cybersecurity Framework", shortName: "NIST CSF", version: "2.0", controlCount: 11 },
  { id: "iso-27001", name: "ISO/IEC 27001", shortName: "ISO 27001", version: "2022", controlCount: 12 },
  { id: "soc2", name: "SOC 2 Trust Services Criteria", shortName: "SOC 2", version: "2017", controlCount: 8 },
  { id: "pci-dss", name: "PCI DSS", shortName: "PCI DSS", version: "v4.0", controlCount: 10 },
];

const STATUS_ICON: Record<ControlStatus, React.ElementType> = {
  passed: CheckCircle2,
  failed: XCircle,
  partial: MinusCircle,
  not_applicable: MinusCircle,
  not_evaluated: HelpCircle,
};

const STATUS_CLASS: Record<ControlStatus, string> = {
  passed: "text-success",
  failed: "text-danger",
  partial: "text-warn",
  not_applicable: "text-slate-500",
  not_evaluated: "text-slate-400",
};

const STATUS_BADGE: Record<ControlStatus, string> = {
  passed: "border-success/30 bg-success/10 text-success",
  failed: "border-danger/30 bg-danger/10 text-danger",
  partial: "border-warn/30 bg-warn/10 text-warn",
  not_applicable: "border-slate-600 bg-slate-800 text-slate-400",
  not_evaluated: "border-slate-700 bg-slate-900 text-slate-500",
};

function ScoreRing({ score, size = 60 }: { score: number; size?: number }) {
  const r = size / 2 - 6;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text
        x="50%" y="50%"
        dominantBaseline="middle" textAnchor="middle"
        className="rotate-90 text-[12px] font-bold fill-white"
        style={{ transform: `rotate(90deg)`, transformOrigin: "center" }}
        fontSize={size * 0.22}
        fill="white"
      >
        {score}
      </text>
    </svg>
  );
}

export function CompliancePanel() {
  const [planId, setPlanId] = useState("");
  const [activePack, setActivePack] = useState<string>("cis");
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [allReports, setAllReports] = useState<ComplianceReport[]>([]);
  const [loading, setLoading] = useState<"idle" | "single" | "all">("idle");
  const [error, setError] = useState<string | null>(null);
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());

  const toggleControl = (id: string) => {
    setExpandedControls((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const evaluate = async (packId: string) => {
    if (!planId.trim()) { setError("Enter a SecAudit plan ID to evaluate."); return; }
    setError(null);
    setLoading("single");
    setReport(null);
    try {
      const res = await fetch(apiUrl(`/api/v1/compliance/plans/${planId.trim()}/evaluate/${packId}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ComplianceReport;
      setReport(data);
      setActivePack(packId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to evaluate compliance");
    } finally {
      setLoading("idle");
    }
  };

  const evaluateAll = async () => {
    if (!planId.trim()) { setError("Enter a SecAudit plan ID to evaluate."); return; }
    setError(null);
    setLoading("all");
    setAllReports([]);
    setReport(null);
    try {
      const res = await fetch(apiUrl(`/api/v1/compliance/plans/${planId.trim()}/evaluate`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { planId: string; reports: ComplianceReport[] };
      setAllReports(data.reports);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to evaluate all frameworks");
    } finally {
      setLoading("idle");
    }
  };

  const activeReport = report ?? allReports.find((r) => r.packId === activePack) ?? null;

  return (
    <div className="flex flex-col gap-5 p-6 text-slate-900">
      {/* Header */}
      <section className="tv-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
              <ClipboardCheck className="h-3.5 w-3.5" />
              Compliance
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Compliance Packs</h2>
            <p className="mt-1 text-sm text-slate-600">
              Map a SecAudit plan against CIS, NIST CSF, ISO 27001, SOC 2 and PCI-DSS controls.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 items-end">
          <label className="grid gap-1 min-w-[260px] flex-1">
            <span className="text-xs font-medium text-slate-600">SecAudit Plan ID</span>
            <input
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              placeholder="secaudit_plan_1"
              className="rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand"
            />
          </label>
          <button
            onClick={evaluateAll}
            disabled={loading !== "idle"}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading === "all" ? "Evaluating..." : "Evaluate All Frameworks"}
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
        {/* Pack selector */}
        <div className="space-y-2">
          {PACKS.map((pack) => {
            const summary = allReports.find((r) => r.packId === pack.id);
            const isActive = activePack === pack.id;
            return (
              <button
                key={pack.id}
                onClick={() => {
                  setActivePack(pack.id);
                  if (!allReports.length) evaluate(pack.id);
                  else setReport(null);
                }}
                className={cn(
                  "w-full rounded-xl border px-3 py-3 text-left transition",
                  isActive ? "border-brand/40 bg-brand/10" : "border-blue-100 bg-white hover:border-brand/30",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-slate-900">{pack.shortName}</p>
                    <p className="text-[11px] text-slate-500">{pack.version} · {pack.controlCount} controls</p>
                  </div>
                  {summary ? (
                    <div className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold border",
                      summary.overallScore >= 80 ? "border-success/30 bg-success/10 text-success" :
                      summary.overallScore >= 60 ? "border-warn/30 bg-warn/10 text-warn" :
                      "border-danger/30 bg-danger/10 text-danger",
                    )}>
                      {summary.overallScore}
                    </div>
                  ) : null}
                </div>
                {loading === "single" && isActive ? (
                  <p className="mt-1 text-[10px] text-brand">Loading...</p>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Report */}
        <div className="space-y-4">
          {/* All-framework overview when evaluateAll ran */}
          {allReports.length > 0 && !report ? (
            <div className="tv-panel p-4">
              <div className="mb-3 flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-brand" />
                <h3 className="text-sm font-semibold text-slate-900">All Frameworks Overview</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {allReports.map((r) => (
                  <button
                    key={r.packId}
                    onClick={() => setActivePack(r.packId)}
                    className="flex flex-col items-center gap-1 rounded-xl border border-blue-100 bg-white p-3 transition hover:border-brand/30"
                  >
                    <ScoreRing score={r.overallScore} size={56} />
                    <p className="text-[10px] font-semibold text-slate-700">{PACKS.find((p) => p.id === r.packId)?.shortName}</p>
                    <div className="flex gap-1 text-[9px]">
                      <span className="text-success">✓{r.controlsPassed}</span>
                      <span className="text-danger">✗{r.controlsFailed}</span>
                      <span className="text-warn">~{r.controlsPartial}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Per-pack detail */}
          {activeReport ? (
            <div className="tv-panel p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{activeReport.packName}</h3>
                  <p className="text-[11px] text-slate-500">
                    {new Date(activeReport.generatedAt).toLocaleString()}
                  </p>
                </div>
                <ScoreRing score={activeReport.overallScore} size={64} />
              </div>

              {/* Buckets */}
              <div className="mb-4 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-5">
                {[
                  { label: "Passed", val: activeReport.controlsPassed, cls: "text-success border-success/30 bg-success/10" },
                  { label: "Failed", val: activeReport.controlsFailed, cls: "text-danger border-danger/30 bg-danger/10" },
                  { label: "Partial", val: activeReport.controlsPartial, cls: "text-warn border-warn/30 bg-warn/10" },
                  { label: "N/A", val: activeReport.controlsNotApplicable, cls: "text-slate-400 border-slate-600 bg-slate-800" },
                  { label: "Pending", val: activeReport.controlsNotEvaluated, cls: "text-slate-400 border-slate-700 bg-slate-900" },
                ].map(({ label, val, cls }) => (
                  <div key={label} className={cn("rounded-lg border px-2 py-1.5 text-center font-semibold", cls)}>
                    <div className="text-base font-bold">{val}</div>
                    <div className="text-[9px] font-normal">{label}</div>
                  </div>
                ))}
              </div>

              {/* Controls list */}
              <div className="space-y-1.5 max-h-[520px] overflow-auto">
                <AnimatePresence initial={false}>
                  {activeReport.controls.map((ctrl) => {
                    const Icon = STATUS_ICON[ctrl.status];
                    const isOpen = expandedControls.has(ctrl.controlId);
                    return (
                      <div key={ctrl.controlId} className="rounded-lg border border-blue-100 bg-white">
                        <button
                          onClick={() => toggleControl(ctrl.controlId)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left"
                        >
                          <Icon className={cn("h-4 w-4 shrink-0", STATUS_CLASS[ctrl.status])} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-slate-900">{ctrl.name}</p>
                            <p className="text-[10px] text-slate-500">{ctrl.controlId}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", STATUS_BADGE[ctrl.status])}>
                              {ctrl.status.replace("_", " ")}
                            </span>
                            <span className="text-[10px] font-bold text-slate-600">{ctrl.score}</span>
                            {isOpen
                              ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                              : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                          </div>
                        </button>

                        {isOpen ? (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <div className="border-t border-blue-100 px-3 py-2 text-[11px] text-slate-600">
                              {ctrl.modulesCovered.length ? (
                                <div className="mb-1.5 flex flex-wrap gap-1">
                                  {ctrl.modulesCovered.map((m) => (
                                    <span key={m} className="rounded border border-brand/20 bg-brand/10 px-1.5 py-0.5 text-brand">{m}</span>
                                  ))}
                                </div>
                              ) : (
                                <p className="mb-1 text-slate-400 italic">No modules covered — run relevant audit modules first.</p>
                              )}
                              {ctrl.evidence.length ? (
                                <div className="rounded bg-slate-950 p-2 text-[10px] text-slate-300 space-y-0.5 max-h-24 overflow-auto">
                                  {ctrl.evidence.map((ev, i) => <p key={i}>{ev}</p>)}
                                </div>
                              ) : null}
                            </div>
                          </motion.div>
                        ) : null}
                      </div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
          ) : allReports.length === 0 && loading === "idle" ? (
            <div className="tv-panel flex flex-col items-center justify-center gap-3 p-12 text-center">
              <ClipboardCheck className="h-10 w-10 text-slate-600" />
              <p className="text-sm text-slate-600">Enter a SecAudit plan ID and click<br /><strong>Evaluate All Frameworks</strong> to see compliance scores.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
