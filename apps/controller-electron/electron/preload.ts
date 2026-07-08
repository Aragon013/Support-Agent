import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow:    () => ipcRenderer.invoke("window:close"),
  runClientSecAudit: (payload: { moduleId: string; targetHost?: string }) =>
    ipcRenderer.invoke("secaudit:client-run", payload),
});
