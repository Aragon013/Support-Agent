import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar, type NavTab } from "@/components/Sidebar";
import { CommandPanel } from "@/panels/CommandPanel";
import { JobsPanel } from "@/panels/JobsPanel";
import { AuditPanel } from "@/panels/AuditPanel";
import { MonitorPanel } from "@/panels/MonitorPanel";
import { SettingsPanel } from "@/panels/SettingsPanel";

const PANELS: Record<NavTab, React.ElementType> = {
  commands: CommandPanel,
  jobs:     JobsPanel,
  audit:    AuditPanel,
  monitor:  MonitorPanel,
  settings: SettingsPanel,
};

export default function App() {
  const [tab, setTab] = useState<NavTab>("commands");
  const Panel = PANELS[tab];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-950 text-white">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={tab} onChange={setTab} />
        <main className="flex-1 overflow-y-auto">
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
