/**
 * Copies the compiled control-plane dist into dist-electron/backend/
 * so Electron can spawn it as a bundled Node process in production.
 *
 * Run automatically as part of: npm run build
 *
 * Layout produced (all under dist-electron/backend/, kept unpacked from asar):
 *   backend/server.js, app.js, ...        (compiled control-plane dist)
 *   backend/package.json                  ({ "type": "module" }) so Node treats
 *                                          the ESM output correctly
 *   backend/node_modules/                 (control-plane production deps) so ESM
 *                                          bare imports (fastify, ws, ...) resolve
 */

import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const src = path.resolve(__dirname, "..", "..", "control-plane", "dist");
const dest = path.resolve(__dirname, "..", "dist-electron", "backend");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

// The control-plane is ESM ("type": "module"). The bundled backend/ folder has
// no package.json of its own, so Node would default .js files to CommonJS and
// the ESM `import` statements would fail. Emit a minimal package.json.
writeFileSync(
  path.resolve(dest, "package.json"),
  JSON.stringify({ name: "rsp-backend-bundle", private: true, type: "module" }, null, 2),
);

// Copy the control-plane production node_modules INTO backend/node_modules so
// ESM bare-specifier resolution finds them next to server.js.
const srcModules = path.resolve(__dirname, "..", "..", "control-plane", "node_modules");
const destModules = path.resolve(dest, "node_modules");
rmSync(destModules, { recursive: true, force: true });
mkdirSync(destModules, { recursive: true });
cpSync(srcModules, destModules, { recursive: true });

console.log(`[copy-backend] Copied control-plane dist → ${path.relative(repoRoot, dest)}`);
console.log(`[copy-backend] Wrote backend/package.json ({ type: module })`);
console.log(`[copy-backend] Copied control-plane node_modules → ${path.relative(repoRoot, destModules)}`);
