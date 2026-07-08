import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/cn";

declare global {
  interface Window {
    electronAPI?: {
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      runClientSecAudit?: (payload: { moduleId: string; targetHost?: string }) => Promise<{
        moduleId: string;
        ok: boolean;
        findings: Record<string, unknown>;
        evidence: string[];
        error?: string;
      }>;
    };
  }
}

export function TitleBar() {
  const api = window.electronAPI;

  return (
    <div className="drag-region flex h-11 shrink-0 items-center justify-between border-b border-brand/30 bg-gradient-to-r from-brand/95 via-brand-dark to-surface-900 px-4 select-none">
      <div className="flex items-center gap-2 no-drag">
        <div className="h-2.5 w-2.5 rounded-full bg-white/90" />
        <span className="text-xs font-semibold tracking-[0.18em] uppercase text-blue-50/90">
          RemoteSupportPro
        </span>
        <span className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-50/90">
          Control Center
        </span>
      </div>
      <div className="flex items-center gap-1 no-drag">
        <TitleButton onClick={() => api?.minimizeWindow()} label="Minimize">
          <Minus className="w-3 h-3" />
        </TitleButton>
        <TitleButton onClick={() => api?.maximizeWindow()} label="Maximize">
          <Square className="w-3 h-3" />
        </TitleButton>
        <TitleButton
          onClick={() => api?.closeWindow()}
          label="Close"
          className="hover:bg-danger/80"
        >
          <X className="w-3 h-3" />
        </TitleButton>
      </div>
    </div>
  );
}

function TitleButton({
  onClick,
  label,
  children,
  className,
}: {
  onClick?: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded text-blue-100/75 transition-colors hover:bg-white/15 hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}
