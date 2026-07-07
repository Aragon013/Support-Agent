import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import type { RunnerResult } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * diagnostic.system.info — read-only OS metadata, no params required.
 * Low-risk: no shell, no user input used in command construction.
 */
export async function runSystemInfo(
  _params: Record<string, unknown>,
): Promise<RunnerResult> {
  const output = {
    stdout: [] as string[],
    stderr: [] as string[],
    exitCode: 0,
  };

  try {
    const info = {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
      uptimeSeconds: Math.round(os.uptime()),
      nodeVersion: process.version,
    };

    output.stdout.push(JSON.stringify(info, null, 2));
    return { ok: true, output };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    output.stderr.push(msg);
    output.exitCode = 1;
    return { ok: false, reason: "runner_error", output };
  }
}

/**
 * security.firewall.status — read netsh firewall state for a profile.
 * Allowed profiles: domain | private | public (validated by dispatcher).
 */
export async function runFirewallStatus(
  params: Record<string, unknown>,
): Promise<RunnerResult> {
  const output = {
    stdout: [] as string[],
    stderr: [] as string[],
    exitCode: 0,
  };

  const allowedProfiles = ["domain", "private", "public"] as const;
  type Profile = (typeof allowedProfiles)[number];

  const rawProfile = params["profile"];
  const profile: Profile = allowedProfiles.includes(rawProfile as Profile)
    ? (rawProfile as Profile)
    : "public";

  try {
    if (os.platform() !== "win32") {
      output.stdout.push(
        JSON.stringify({
          platform: os.platform(),
          note: "firewall status only available on Windows",
        }),
      );
      return { ok: true, output };
    }

    const { stdout } = await execFileAsync(
      "netsh",
      ["advfirewall", "show", `${profile}profile`],
      { timeout: 8_000 },
    );

    output.stdout.push(stdout);
    return { ok: true, output };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    output.stderr.push(msg);
    output.exitCode = 1;
    return { ok: false, reason: "runner_error", output };
  }
}

/**
 * maintenance.service.restart — restart a pre-approved Windows service.
 * serviceId is validated against an allowlist to prevent injection.
 */
const ALLOWED_SERVICES = new Set([
  "Spooler",
  "wuauserv",
  "BITS",
  "WinRM",
  "EventLog",
  "Schedule",
]);

export async function runServiceRestart(
  params: Record<string, unknown>,
): Promise<RunnerResult> {
  const output = {
    stdout: [] as string[],
    stderr: [] as string[],
    exitCode: 0,
  };

  const serviceId = typeof params["serviceId"] === "string"
    ? params["serviceId"].trim()
    : "";

  if (!serviceId) {
    output.stderr.push("serviceId is required");
    output.exitCode = 1;
    return { ok: false, reason: "invalid_params", output };
  }

  if (!ALLOWED_SERVICES.has(serviceId)) {
    output.stderr.push(`service '${serviceId}' is not in the allowed list`);
    output.exitCode = 1;
    return { ok: false, reason: "policy_denied", output };
  }

  try {
    if (os.platform() !== "win32") {
      output.stdout.push(
        JSON.stringify({
          platform: os.platform(),
          note: "service restart only available on Windows",
          wouldRestart: serviceId,
        }),
      );
      return { ok: true, output };
    }

    const { stdout: stopOut } = await execFileAsync(
      "sc",
      ["stop", serviceId],
      { timeout: 10_000 },
    );
    output.stdout.push(stopOut);

    await new Promise<void>((r) => setTimeout(r, 1_500));

    const { stdout: startOut } = await execFileAsync(
      "sc",
      ["start", serviceId],
      { timeout: 10_000 },
    );
    output.stdout.push(startOut);

    return { ok: true, output };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    output.stderr.push(msg);
    output.exitCode = 1;
    return { ok: false, reason: "runner_error", output };
  }
}
