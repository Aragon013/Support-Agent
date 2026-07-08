import { useEffect, useState } from "react";
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
import { MonitorPanel } from "@/panels/MonitorPanel";
import { SessionsPanel } from "@/panels/SessionsPanel";
import { SupportPanel } from "@/panels/SupportPanel";
import { SettingsPanel } from "@/panels/SettingsPanel";

const PANELS: Record<NavTab, React.ElementType> = {
  support:    SupportPanel,
  commands:   CommandPanel,
  jobs:       JobsPanel,
  audit:      AuditPanel,
  secaudit:   SecAuditPanel,
  compliance: CompliancePanel,
  exceptions: ExceptionsPanel,
  alerts:     AlertsPanel,
  monitor:    MonitorPanel,
  sessions:   SessionsPanel,
  settings:   SettingsPanel,
};

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
  );
}
