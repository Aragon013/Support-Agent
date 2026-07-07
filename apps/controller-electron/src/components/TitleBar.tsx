import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/cn";

declare global {
  interface Window {
    electronAPI?: {
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
    };
  }
}

export function TitleBar() {
  const api = window.electronAPI;

  return (
    <div className="drag-region h-10 flex items-center justify-between px-4 bg-surface-950 border-b border-surface-800 select-none shrink-0">
      <div className="flex items-center gap-2 no-drag">
        <div className="w-2.5 h-2.5 rounded-full bg-brand" />
        <span className="text-xs font-semibold tracking-widest uppercase text-slate-400">
          RemoteSupportPro
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
        "w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-surface-700 transition-colors",
        className,
      )}
    >
      {children}
    </button>
  );
}
