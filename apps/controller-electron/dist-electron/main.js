"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
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
