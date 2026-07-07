import { motion } from "framer-motion";
import {
  Terminal,
  LayoutList,
  ShieldCheck,
  Activity,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/cn";

export type NavTab = "commands" | "jobs" | "audit" | "monitor" | "settings";

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ElementType }[] = [
  { id: "commands",  label: "Commands",  icon: Terminal },
  { id: "jobs",      label: "Jobs",      icon: LayoutList },
  { id: "audit",     label: "Audit",     icon: ShieldCheck },
  { id: "monitor",   label: "Monitor",   icon: Activity },
  { id: "settings",  label: "Settings",  icon: Settings },
];

interface SidebarProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}

export function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <nav className="flex flex-col w-[68px] bg-surface-900 border-r border-surface-800 py-3 items-center gap-1 shrink-0">
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            aria-label={item.label}
            className={cn(
              "relative group w-12 h-12 flex flex-col items-center justify-center rounded-xl text-slate-500 hover:text-white transition-colors",
              isActive && "text-white",
            )}
          >
            {isActive && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute inset-0 rounded-xl bg-brand/20 border border-brand/40"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <item.icon className="relative w-5 h-5" />
            <span className="relative text-[9px] mt-0.5 font-medium tracking-wide">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
