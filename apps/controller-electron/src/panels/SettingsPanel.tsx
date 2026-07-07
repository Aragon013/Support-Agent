import { Settings } from "lucide-react";

export function SettingsPanel() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-600">
      <Settings className="w-10 h-10 mb-3 animate-spin" style={{ animationDuration: "6s" }} />
      <p className="text-sm">Settings — coming soon.</p>
    </div>
  );
}
