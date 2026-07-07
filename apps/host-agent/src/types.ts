export type RiskLevel = "low" | "medium" | "high" | "critical";

export type CommandInitEnvelope = {
  v: 1;
  kind: "command.init";
  seq: number;
  jobId: string;
  commandId: string;
  commandVersion: string;
  requestedAt: string;
  params: Record<string, unknown>;
};

export type RunnerOutput = {
  stdout: string[];
  stderr: string[];
  exitCode: number;
};

export type RunnerResult =
  | { ok: true;  output: RunnerOutput }
  | { ok: false; reason: string; output: RunnerOutput };

export type SlotStatus = "idle" | "running";

export const MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB cap
export const DEFAULT_TIMEOUT_MS = 30_000;
