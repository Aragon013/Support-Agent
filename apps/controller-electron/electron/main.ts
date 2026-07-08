import { app, BrowserWindow, ipcMain } from "electron";
import { execFile } from "node:child_process";
import fs from "fs";
import path from "path";

type ClientAuditRequest = {
  moduleId: string;
  targetHost?: string;
};

type ClientAuditResponse = {
  moduleId: string;
  ok: boolean;
  findings: Record<string, unknown>;
  evidence: string[];
  error?: string;
};

const isDev = process.env.NODE_ENV !== "production";
const RENDERER_URL = process.env.RSP_RENDERER_URL ?? "http://localhost:5173";
const APP_DISPLAY_NAME = "RemoteSupportPro";

app.setName(APP_DISPLAY_NAME);

const userDataPath = path.join(app.getPath("appData"), APP_DISPLAY_NAME);
const sessionDataPath = path.join(userDataPath, "session-data");

for (const targetPath of [userDataPath, sessionDataPath]) {
  fs.mkdirSync(targetPath, { recursive: true });
}

app.setPath("userData", userDataPath);
app.setPath("sessionData", sessionDataPath);

let mainWindow: BrowserWindow | null = null;

function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.toString() || error.message));
          return;
        }
        resolve(stdout.toString());
      },
    );
  });
}

async function runClientAudit(input: ClientAuditRequest): Promise<ClientAuditResponse> {
  const host = input.targetHost && input.targetHost.trim().length > 0 ? input.targetHost.trim() : "8.8.8.8";

  if (input.moduleId !== "net.client-health") {
    return {
      moduleId: input.moduleId,
      ok: false,
      findings: {
        status: "unsupported",
      },
      evidence: [],
      error: "unsupported_client_module",
    };
  }

  try {
    const pingRaw = await runPowerShell(`Test-Connection -ComputerName ${host} -Count 1 -ErrorAction SilentlyContinue | Select-Object -First 1 | ConvertTo-Json -Compress`);
    const routeRaw = await runPowerShell("Get-NetRoute -AddressFamily IPv4 | Sort-Object RouteMetric | Select-Object -First 5 DestinationPrefix,NextHop,InterfaceAlias,RouteMetric | ConvertTo-Json -Compress");
    const dnsRaw = await runPowerShell("Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object -First 4 InterfaceAlias,ServerAddresses | ConvertTo-Json -Compress");

    const ping = pingRaw.trim() ? JSON.parse(pingRaw) : null;
    const routes = routeRaw.trim() ? JSON.parse(routeRaw) : [];
    const dns = dnsRaw.trim() ? JSON.parse(dnsRaw) : [];

    const latencyMs = typeof ping?.ResponseTime === "number" ? ping.ResponseTime : null;

    return {
      moduleId: input.moduleId,
      ok: true,
      findings: {
        status: latencyMs !== null && latencyMs < 150 ? "ok" : "degraded",
        targetHost: host,
        latencyMs,
        routeCount: Array.isArray(routes) ? routes.length : 0,
        dnsInterfaces: Array.isArray(dns) ? dns.length : 0,
      },
      evidence: [
        `ping=${latencyMs ?? "n/a"}ms`,
        `routes=${Array.isArray(routes) ? routes.length : 0}`,
        `dnsIfaces=${Array.isArray(dns) ? dns.length : 0}`,
      ],
    };
  } catch (error) {
    return {
      moduleId: input.moduleId,
      ok: false,
      findings: {
        status: "error",
      },
      evidence: [],
      error: error instanceof Error ? error.message : "client_audit_error",
    };
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#090d17",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist-renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle("window:close", () => mainWindow?.close());
ipcMain.handle("secaudit:client-run", async (_event, payload: ClientAuditRequest) => runClientAudit(payload));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
