import { app, BrowserWindow, ipcMain } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
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

const isDev = !app.isPackaged && process.env.NODE_ENV !== "production";
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
let backendProcess: ChildProcess | null = null;

// ---------------------------------------------------------------------------
// On-demand backend (control-plane) — only started when user activates SecAudit.
// In dev mode, dev.mjs already handles the backend process.
// ---------------------------------------------------------------------------
const BACKEND_HOST = "127.0.0.1";
const BACKEND_PORT = 3000;

function startBackend(): boolean {
  if (isDev) return true; // dev.mjs handles it
  if (backendProcess && !backendProcess.killed) return true;

  // In the packaged app the backend ships as an extraResource (copied verbatim,
  // node_modules preserved) under resources/backend. In an unpackaged run
  // (e.g. `electron dist-electron/main.js`) fall back to the local build output.
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, "backend", "server.js")
    : path.join(__dirname, "backend", "server.js");
  if (!fs.existsSync(serverPath)) {
    console.error("[backend] server.js not found at", serverPath);
    return false;
  }

  const logPath = path.join(userDataPath, "backend.log");
  const logLine = (msg: string) => {
    try {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {
      /* ignore logging failures */
    }
  };

  backendProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      // Run the Electron binary as plain Node so it executes server.js instead
      // of launching another GUI instance.
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: BACKEND_HOST,
      PORT: String(BACKEND_PORT),
      ADMIN_API_KEY: process.env.ADMIN_API_KEY ?? "rsp-prod-key-change-me",
    },
    stdio: "pipe",
    windowsHide: true,
  });

  backendProcess.stdout?.on("data", (d: Buffer) => logLine(`[out] ${d.toString().trim()}`));
  backendProcess.stderr?.on("data", (d: Buffer) => logLine(`[err] ${d.toString().trim()}`));
  backendProcess.on("error", (err) => logLine(`[spawn-error] ${err.message}`));
  backendProcess.on("exit", (code) => {
    logLine(`[exit] code=${code}`);
    backendProcess = null;
    mainWindow?.webContents.send("backend:status-changed", "stopped");
  });

  logLine(`[start] pid=${backendProcess.pid} server=${serverPath}`);
  return true;
}

/** Resolves true once the backend is accepting TCP connections, or false on timeout. */
function waitForBackendReady(timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      if (!backendProcess || backendProcess.killed) {
        resolve(false);
        return;
      }
      const socket = net.connect(BACKEND_PORT, BACKEND_HOST);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          resolve(false);
        } else {
          setTimeout(attempt, 250);
        }
      });
    };
    attempt();
  });
}

function stopBackend(): void {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function backendRunning(): boolean {
  if (isDev) return true;
  return backendProcess !== null && !backendProcess.killed;
}

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

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[renderer] failed to load ${url} — ${code} ${desc}`);
  });

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

// SecAudit backend lifecycle — triggered on-demand from the renderer
ipcMain.handle("backend:start", async () => {
  const ok = startBackend();
  if (!ok) return { ok: false, running: false };
  const running = isDev ? true : await waitForBackendReady();
  return { ok, running };
});
ipcMain.handle("backend:stop", () => {
  stopBackend();
  return { running: false };
});
ipcMain.handle("backend:status", () => ({ running: backendRunning() }));

app.whenReady().then(() => {
  // Backend is NOT started here — user activates it from the SecAudit panel.
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
