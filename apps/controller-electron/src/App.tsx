import { useEffect, useState, Component, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar, type NavTab } from "@/components/Sidebar";
import { CommandPanel } from "@/panels/CommandPanel";
import { JobsPanel } from "@/panels/JobsPanel";
import { AuditPanel } from "@/panels/AuditPanel";
import { SecAuditPanel } from "@/panels/SecAuditPanel";
import { CompliancePanel } from "@/panels/CompliancePanel";
import { ExceptionsPanel } from "@/panels/ExceptionsPanel";
import { AlertsPanel } from "@/panels/AlertsPanel";
import { ResiliencePanel } from "@/panels/ResiliencePanel";
import { MonitorPanel } from "@/panels/MonitorPanel";
import { SessionsPanel } from "@/panels/SessionsPanel";
import { SupportPanel } from "@/panels/SupportPanel";
import { SettingsPanel } from "@/panels/SettingsPanel";
import { CybersecurityPanel } from "@/panels/CybersecurityPanel";

const PANELS: Record<NavTab, React.ElementType> = {
  support:    SupportPanel,
  commands:   CommandPanel,
  jobs:       JobsPanel,
  cybersecurity: CybersecurityPanel,
  audit:      AuditPanel,
  secaudit:   SecAuditPanel,
  compliance: CompliancePanel,
  exceptions: ExceptionsPanel,
  alerts:     AlertsPanel,
  resilience: ResiliencePanel,
  monitor:    MonitorPanel,
  sessions:   SessionsPanel,
  settings:   SettingsPanel,
};

// ── Error boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] uncaught render error:", error, info);
  }

  override render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-surface-950 p-8 text-center">
          <div className="rounded-2xl border border-danger/40 bg-danger/10 p-6 max-w-xl">
            <p className="text-sm font-semibold text-danger mb-2">Error al renderizar</p>
            <pre className="text-xs text-slate-300 text-left whitespace-pre-wrap break-words">
              {error.message}
              {"\n\n"}
              {error.stack}
            </pre>
            <button
              className="mt-4 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-dark transition-colors"
              onClick={() => this.setState({ error: null })}
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [tab, setTab] = useState<NavTab>("support");
  const Panel = PANELS[tab];

  useEffect(() => {
    const handleSupportSessionHandoff = () => {
      setTab("sessions");
    };

    window.addEventListener("rsp:navigate-sessions", handleSupportSessionHandoff);
    return () => {
      window.removeEventListener("rsp:navigate-sessions", handleSupportSessionHandoff);
    };
  }, []);

  return (
    <ErrorBoundary>
    <div className="relative flex h-screen flex-col overflow-hidden text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(76,198,255,0.14),transparent_38%),radial-gradient(circle_at_left,rgba(11,132,255,0.16),transparent_34%)]" />
      <TitleBar />
      <div className="relative flex flex-1 overflow-hidden">
        <Sidebar active={tab} onChange={setTab} />
        <main className="m-2 flex-1 overflow-y-auto rounded-2xl border border-surface-700/80 bg-surface-900/55 backdrop-blur-sm">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
    </ErrorBoundary>
  );
}
