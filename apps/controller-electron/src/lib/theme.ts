/**
 * Theme manager: light / dark / system.
 * Persiste la preferencia en localStorage y aplica la clase `dark`
 * sobre <html> (Tailwind darkMode: "class").
 */

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "rsp.theme.v1";

export function getStoredTheme(): ThemePreference {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") {
    return raw;
  }
  return "system";
}

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** Resuelve la preferencia a un modo concreto (light | dark). */
export function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") {
    return prefersDark() ? "dark" : "light";
  }
  return pref;
}

/** Aplica la clase `dark` sobre <html> según la preferencia. */
export function applyTheme(pref: ThemePreference): void {
  const mode = resolveTheme(pref);
  document.documentElement.classList.toggle("dark", mode === "dark");
}

/** Guarda la preferencia y la aplica de inmediato. */
export function setTheme(pref: ThemePreference): void {
  localStorage.setItem(STORAGE_KEY, pref);
  applyTheme(pref);
}

/** Inicializa el tema al arrancar y se suscribe a cambios del sistema. */
export function initTheme(): void {
  applyTheme(getStoredTheme());
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (getStoredTheme() === "system") {
      applyTheme("system");
    }
  });
}
