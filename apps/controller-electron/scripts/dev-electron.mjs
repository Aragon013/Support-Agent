import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

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

  if (positional[0] && !parsed.url) {
    parsed.url = positional[0];
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  const fallbackUrl = url.includes("localhost")
    ? url.replace("localhost", "127.0.0.1")
    : url.includes("127.0.0.1")
      ? url.replace("127.0.0.1", "localhost")
      : null;
  const candidates = fallbackUrl ? [url, fallbackUrl] : [url];

  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, { method: "GET" });
        if (response.ok) {
          return;
        }
      } catch {
        // Renderer not ready yet.
      }
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for renderer at ${url}`);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "null"} signal ${signal ?? "none"}`));
    });
  });
}

const args = parseArgs(process.argv.slice(2));
const rendererUrl = args.url ?? process.env.RSP_RENDERER_URL ?? "http://localhost:5173";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBinary = process.platform === "win32"
  ? path.join(appRoot, "node_modules", ".bin", "electron.cmd")
  : path.join(appRoot, "node_modules", ".bin", "electron");

try {
  await waitForUrl(rendererUrl);
  await runCommand(npmCommand, ["run", "build:electron"]);

  const electron = spawn(electronBinary, ["dist-electron/main.js"], {
    cwd: appRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      NODE_ENV: "development",
      RSP_RENDERER_URL: rendererUrl,
    },
  });

  electron.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  electron.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}