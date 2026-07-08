"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_child_process_1 = require("node:child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const isDev = process.env.NODE_ENV !== "production";
const RENDERER_URL = process.env.RSP_RENDERER_URL ?? "http://localhost:5173";
const APP_DISPLAY_NAME = "RemoteSupportPro";
electron_1.app.setName(APP_DISPLAY_NAME);
const userDataPath = path_1.default.join(electron_1.app.getPath("appData"), APP_DISPLAY_NAME);
const sessionDataPath = path_1.default.join(userDataPath, "session-data");
for (const targetPath of [userDataPath, sessionDataPath]) {
    fs_1.default.mkdirSync(targetPath, { recursive: true });
}
electron_1.app.setPath("userData", userDataPath);
electron_1.app.setPath("sessionData", sessionDataPath);
let mainWindow = null;
function runPowerShell(command) {
    return new Promise((resolve, reject) => {
        (0, node_child_process_1.execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr?.toString() || error.message));
                return;
            }
            resolve(stdout.toString());
        });
    });
}
async function runClientAudit(input) {
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
    }
    catch (error) {
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
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 640,
        frame: false,
        titleBarStyle: "hidden",
        backgroundColor: "#090d17",
        webPreferences: {
            preload: path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    if (isDev) {
        mainWindow.loadURL(RENDERER_URL);
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, "../dist-renderer/index.html"));
    }
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
electron_1.ipcMain.handle("window:minimize", () => mainWindow?.minimize());
electron_1.ipcMain.handle("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    }
    else {
        mainWindow?.maximize();
    }
});
electron_1.ipcMain.handle("window:close", () => mainWindow?.close());
electron_1.ipcMain.handle("secaudit:client-run", async (_event, payload) => runClientAudit(payload));
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
