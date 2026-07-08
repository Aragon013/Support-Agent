/**
 * Copies the compiled control-plane dist into dist-electron/backend/
 * so Electron can spawn it as a bundled process in production.
 *
 * Run automatically as part of: npm run build
 */

import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const src = path.resolve(__dirname, "..", "..", "control-plane", "dist");
const dest = path.resolve(__dirname, "..", "dist-electron", "backend");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

// Also copy node_modules needed at runtime by the backend.
// We only copy production deps — devDeps are excluded automatically
// because control-plane is a separate package with its own node_modules.
const srcModules = path.resolve(__dirname, "..", "..", "control-plane", "node_modules");
const destModules = path.resolve(dest, "..", "backend_modules");
rmSync(destModules, { recursive: true, force: true });
mkdirSync(destModules, { recursive: true });
cpSync(srcModules, destModules, { recursive: true });

console.log(`[copy-backend] Copied control-plane dist → ${path.relative(repoRoot, dest)}`);
console.log(`[copy-backend] Copied control-plane node_modules → ${path.relative(repoRoot, destModules)}`);
