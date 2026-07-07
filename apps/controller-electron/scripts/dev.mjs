import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const viteBinary = process.platform === "win32"
  ? path.join(appRoot, "node_modules", ".bin", "vite.cmd")
  : path.join(appRoot, "node_modules", ".bin", "vite");

function parseArgs(argv) {
  const parsed = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  if (positional[0] && !parsed.host) {
    parsed.host = positional[0];
  }

  if (positional[1] && !parsed.port) {
    parsed.port = positional[1];
  }

  return parsed;
}

function killChild(child) {
  if (!child || child.killed) {
    return;
  }

  child.kill("SIGTERM");
}

const args = parseArgs(process.argv.slice(2));
const host = args.host ?? "127.0.0.1";
const port = args.port ?? "5173";
const rendererUrl = `http://${host}:${port}`;

let shuttingDown = false;

const renderer = spawn(viteBinary, ["--host", host, "--port", String(port)], {
  cwd: appRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

const electron = spawn(npmCommand, ["run", "dev:electron", "--", "--url", rendererUrl], {
  cwd: appRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  killChild(renderer);
  killChild(electron);
  process.exit(code);
}

renderer.on("exit", (code) => {
  if (!shuttingDown && code !== 0) {
    shutdown(code ?? 1);
  }
});

renderer.on("error", (error) => {
  console.error(error);
  shutdown(1);
});

electron.on("exit", (code) => {
  shutdown(code ?? 0);
});

electron.on("error", (error) => {
  console.error(error);
  shutdown(1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));