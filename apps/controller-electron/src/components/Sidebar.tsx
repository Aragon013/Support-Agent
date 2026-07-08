import { motion } from "framer-motion";
import {
  LifeBuoy,
  Terminal,
  LayoutList,
  ShieldCheck,
  Shield,
  ClipboardCheck,
  Activity,
  Radio,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/cn";

export type NavTab = "support" | "commands" | "jobs" | "audit" | "secaudit" | "compliance" | "monitor" | "sessions" | "settings";

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ElementType }[] = [
  { id: "support",  label: "Support",  icon: LifeBuoy },
  { id: "commands",  label: "Commands",  icon: Terminal },
  { id: "jobs",      label: "Jobs",      icon: LayoutList },
  { id: "audit",     label: "Audit",     icon: ShieldCheck },
  { id: "secaudit",    label: "SecAudit",    icon: Shield },
  { id: "compliance", label: "Compliance", icon: ClipboardCheck },
  { id: "monitor",    label: "Monitor",    icon: Activity },
  { id: "sessions",  label: "Sessions",  icon: Radio },
  { id: "settings",  label: "Settings",  icon: Settings },
];

interface SidebarProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}

export function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <nav className="flex w-[84px] shrink-0 flex-col items-center gap-1 border-r border-surface-700/80 bg-gradient-to-b from-surface-900 via-surface-900 to-surface-950 py-3">
      <div className="mb-2 mt-1 flex h-8 w-8 items-center justify-center rounded-xl border border-brand/40 bg-brand/20 text-[10px] font-bold tracking-wide text-blue-100">
        RSP
      </div>
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            aria-label={item.label}
            className={cn(
              "group relative flex h-14 w-14 flex-col items-center justify-center rounded-xl text-slate-400 transition-colors hover:text-white",
              isActive && "text-white",
            )}
          >
            {isActive && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute inset-0 rounded-xl border border-brand/50 bg-brand/25 shadow-[0_0_0_1px_rgba(11,132,255,0.2)]"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            {isActive && <span className="absolute -left-2 h-6 w-1 rounded-r-full bg-brand" />}
            <item.icon className="relative w-5 h-5" />
            <span className="relative mt-0.5 text-[9px] font-semibold tracking-wide">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
