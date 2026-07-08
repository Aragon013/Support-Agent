import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow:    () => ipcRenderer.invoke("window:close"),
  runClientSecAudit: (payload: { moduleId: string; targetHost?: string }) =>
    ipcRenderer.invoke("secaudit:client-run", payload),
  // SecAudit backend lifecycle
  backendStart:  (): Promise<{ ok: boolean; running: boolean }> => ipcRenderer.invoke("backend:start"),
  backendStop:   (): Promise<{ running: boolean }>              => ipcRenderer.invoke("backend:stop"),
  backendStatus: (): Promise<{ running: boolean }>              => ipcRenderer.invoke("backend:status"),
  onBackendStopped: (cb: () => void) => {
    ipcRenderer.on("backend:status-changed", (_e, s) => { if (s === "stopped") cb(); });
  },
});
