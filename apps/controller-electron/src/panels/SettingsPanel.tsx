import { useState } from "react";
import { Info, Monitor, Moon, Server, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { BACKEND_URL } from "@/lib/backend-url";
import { getStoredTheme, setTheme, type ThemePreference } from "@/lib/theme";

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
  icon: React.ElementType;
}> = [
  { value: "light", label: "Claro", description: "Fondo blanco, alto contraste diurno.", icon: Sun },
  { value: "dark", label: "Oscuro", description: "Tonos oscuros, ideal para uso prolongado.", icon: Moon },
  { value: "system", label: "Sistema", description: "Sigue el tema de Windows automáticamente.", icon: Monitor },
];

export function SettingsPanel() {
  const [theme, setThemeState] = useState<ThemePreference>(getStoredTheme());

  const choose = (value: ThemePreference) => {
    setThemeState(value);
    setTheme(value);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 text-slate-900">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Configuración</h2>
        <p className="mt-0.5 text-sm text-slate-600">Ajusta la apariencia y revisa la conexión.</p>
      </div>
      <section className="tv-panel p-5">
        <p className="mb-1 text-sm font-semibold text-slate-900">Apariencia</p>
        <p className="mb-4 text-xs text-slate-500">Elige cómo se ve la aplicación.</p>

        <div className="grid gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => choose(opt.value)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition",
                  active
                    ? "border-brand bg-blue-50 ring-1 ring-brand/40"
                    : "border-blue-100 bg-white hover:border-brand/40",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-xl",
                    active ? "bg-brand text-white" : "bg-blue-50 text-brand",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-slate-900">{opt.label}</span>
                <span className="text-[11px] leading-tight text-slate-500">{opt.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Conexión */}
      <section className="tv-panel p-5">
        <p className="mb-1 text-sm font-semibold text-slate-900">Conexión</p>
        <p className="mb-4 text-xs text-slate-500">A dónde apunta la aplicación para hablar con el backend.</p>

        <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
          <Server className="h-4 w-4 shrink-0 text-brand" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-600">Control-plane (backend)</p>
            <p className="truncate font-mono text-sm text-slate-900">{BACKEND_URL}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-tight text-slate-400">
          Se configura con la variable <code>VITE_BACKEND_URL</code>. Por defecto <code>http://localhost:3000</code> en desarrollo.
        </p>
      </section>

      {/* Acerca de */}
      <section className="tv-panel p-5">
        <p className="mb-1 text-sm font-semibold text-slate-900">Acerca de</p>
        <p className="mb-4 text-xs text-slate-500">Versión de la aplicación que estás ejecutando.</p>

        <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
          <Info className="h-4 w-4 shrink-0 text-brand" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-600">RemoteSupportPro Controller</p>
            <p className="font-mono text-sm text-slate-900">v{__APP_VERSION__}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
