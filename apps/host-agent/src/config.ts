import { readFileSync } from "node:fs";

export type AgentConfig = {
  controlPlaneUrl: string;
  tenantId: string;
  endpointId: string;
  maxConcurrent: number;
  timeoutMs: number;
};

type PartialConfig = Partial<AgentConfig>;

export function loadAgentConfig(
  argv: string[],
  env: NodeJS.ProcessEnv,
): AgentConfig {
  const filePath = parseConfigPath(argv);
  const fileConfig = filePath ? readConfigFile(filePath) : {};

  const controlPlaneUrl =
    env["CONTROL_PLANE_URL"]
    ?? fileConfig.controlPlaneUrl
    ?? "http://localhost:3000";

  const tenantId =
    env["TENANT_ID"]
    ?? fileConfig.tenantId
    ?? "tenant-1";

  const endpointId =
    env["ENDPOINT_ID"]
    ?? fileConfig.endpointId
    ?? "endpoint-local";

  const maxConcurrent = parsePositiveInt(
    env["MAX_CONCURRENT"] ?? asString(fileConfig.maxConcurrent) ?? "3",
    "MAX_CONCURRENT",
  );

  const timeoutMs = parsePositiveInt(
    env["TIMEOUT_MS"] ?? asString(fileConfig.timeoutMs) ?? "30000",
    "TIMEOUT_MS",
  );

  if (!isHttpUrl(controlPlaneUrl)) {
    throw new Error("CONTROL_PLANE_URL must be an http/https URL");
  }

  return {
    controlPlaneUrl,
    tenantId,
    endpointId,
    maxConcurrent,
    timeoutMs,
  };
}

function parseConfigPath(argv: string[]): string | undefined {
  const flagIndex = argv.findIndex((a) => a === "--config");
  if (flagIndex < 0) return undefined;
  const path = argv[flagIndex + 1];
  if (!path) {
    throw new Error("--config flag requires a file path");
  }
  return path;
}

function readConfigFile(path: string): PartialConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`failed to read config file '${path}': ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid JSON in config file '${path}': ${msg}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`config file '${path}' must be a JSON object`);
  }

  return parsed as PartialConfig;
}

function parsePositiveInt(raw: string, field: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
