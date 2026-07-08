/**
 * Central backend URL helper.
 * Lee VITE_BACKEND_URL desde variables de entorno (seteado en .env o dev server).
 * Fallback a http://localhost:3000 para desarrollo local.
 */
export const BACKEND_URL: string =
  (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:3000";

export function apiUrl(path: string): string {
  return `${BACKEND_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
