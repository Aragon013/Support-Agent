import { Settings } from "lucide-react";

export function SettingsPanel() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-slate-500">
      <div className="tv-panel px-10 py-12 text-center">
        <Settings className="mb-3 h-10 w-10 animate-spin text-brand" style={{ animationDuration: "6s" }} />
        <p className="text-base font-semibold text-slate-900">Settings</p>
        <p className="mt-1 text-sm text-slate-500">Settings panel coming soon.</p>
      </div>
    </div>
  );
}
