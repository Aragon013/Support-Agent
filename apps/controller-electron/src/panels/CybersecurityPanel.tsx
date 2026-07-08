import { useState } from "react";
import { Shield, ShieldCheck, ClipboardCheck, ShieldOff, Bell, Target, Radar } from "lucide-react";
import { cn } from "@/lib/cn";
import { SecAuditPanel } from "@/panels/SecAuditPanel";
import { CompliancePanel } from "@/panels/CompliancePanel";
import { ExceptionsPanel } from "@/panels/ExceptionsPanel";
import { AlertsPanel } from "@/panels/AlertsPanel";
import { ResiliencePanel } from "@/panels/ResiliencePanel";
import { AuditPanel } from "@/panels/AuditPanel";

type CyberTab = "secaudit" | "compliance" | "exceptions" | "alerts" | "resilience" | "audit";

const CYBER_TABS: {
  id: CyberTab;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  { id: "secaudit", label: "SecAudit", description: "Plan, run and compare audits", icon: Shield },
  { id: "compliance", label: "Compliance", description: "Framework mapping and scores", icon: ClipboardCheck },
  { id: "exceptions", label: "Exceptions", description: "Risk acceptance workflow", icon: ShieldOff },
  { id: "alerts", label: "Alerts", description: "Drift and incident notifications", icon: Bell },
  { id: "resilience", label: "Resilience", description: "Defensive dry-run planning", icon: Target },
  { id: "audit", label: "Audit Log", description: "Evidence and action timeline", icon: ShieldCheck },
];

const PANEL_BY_TAB: Record<CyberTab, React.ElementType> = {
  secaudit: SecAuditPanel,
  compliance: CompliancePanel,
  exceptions: ExceptionsPanel,
  alerts: AlertsPanel,
  resilience: ResiliencePanel,
  audit: AuditPanel,
};

export function CybersecurityPanel() {
  const [activeTab, setActiveTab] = useState<CyberTab>("secaudit");
  const ActivePanel = PANEL_BY_TAB[activeTab];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <section className="border-b border-surface-700/80 bg-surface-900/60 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
              <Radar className="h-3.5 w-3.5" />
              Cybersecurity Center
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-100">Unified Security Operations</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              All cybersecurity workflows are centralized here: run assessments, validate compliance, manage
              exceptions, trigger alerts and track evidence from one place.
            </p>
          </div>

          <div className="grid gap-1 rounded-xl border border-surface-700 bg-surface-900/80 px-3 py-2 text-[11px] text-slate-300">
            <span className="font-semibold text-slate-200">Suggested flow</span>
            <span>1. SecAudit -&gt; 2. Compliance -&gt; 3. Exceptions -&gt; 4. Alerts</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {CYBER_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left transition",
                  "min-w-[180px]",
                  isActive
                    ? "border-brand/50 bg-brand/15 text-slate-100"
                    : "border-surface-700 bg-surface-900/70 text-slate-400 hover:border-brand/30 hover:text-slate-200",
                )}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </div>
                <p className="mt-0.5 text-xs opacity-80">{tab.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex-1 overflow-y-auto">
        <ActivePanel />
      </section>
    </div>
  );
}
