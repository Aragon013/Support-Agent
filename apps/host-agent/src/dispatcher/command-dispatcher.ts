import type { CommandInitEnvelope, RunnerResult } from "../types.js";
import { MAX_OUTPUT_BYTES } from "../types.js";
import { findRunner } from "../runners/runner-registry.js";
import { withWatchdog } from "../watchdog.js";

export type DispatchOutcome =
  | { status: "completed"; output: RunnerResult["output"] }
  | { status: "failed";    reason: string; output: RunnerResult["output"] }
  | { status: "cancelled"; reason: string }
  | { status: "unknown_command" };

type ActiveSlot = {
  jobId: string;
  cancel: (reason?: string) => void;
};

export class CommandDispatcher {
  private readonly slots = new Map<string, ActiveSlot>();

  constructor(
    private readonly maxConcurrent: number = 3,
    private readonly defaultTimeoutMs: number = 30_000,
  ) {}

  get activeCount(): number {
    return this.slots.size;
  }

  hasCapacity(): boolean {
    return this.slots.size < this.maxConcurrent;
  }

  cancel(jobId: string, reason = "cancelled_by_operator"): boolean {
    const slot = this.slots.get(jobId);
    if (!slot) return false;
    slot.cancel(reason);
    return true;
  }

  async dispatch(env: CommandInitEnvelope): Promise<DispatchOutcome> {
    const runner = findRunner(env.commandId);
    if (!runner) {
      return { status: "unknown_command" };
    }

    const { promise, handle } = withWatchdog(
      runner(env.params),
      this.defaultTimeoutMs,
    );

    this.slots.set(env.jobId, {
      jobId: env.jobId,
      cancel: handle.cancel,
    });

    let result: RunnerResult;
    try {
      result = await promise;
    } finally {
      this.slots.delete(env.jobId);
    }

    const output = capOutput(result.output);

    if (result.ok) {
      return { status: "completed", output };
    }

    return {
      status: result.reason === "cancelled_by_operator" ? "cancelled" : "failed",
      reason: result.reason,
      output,
    };
  }
}

function capOutput(
  raw: RunnerResult["output"],
): RunnerResult["output"] {
  let totalBytes = 0;
  const cappedStdout: string[] = [];
  const cappedStderr: string[] = [];

  for (const line of raw.stdout) {
    const bytes = Buffer.byteLength(line, "utf8");
    if (totalBytes + bytes > MAX_OUTPUT_BYTES) {
      cappedStdout.push("[output truncated: cap exceeded]");
      break;
    }
    totalBytes += bytes;
    cappedStdout.push(line);
  }

  for (const line of raw.stderr) {
    const bytes = Buffer.byteLength(line, "utf8");
    if (totalBytes + bytes > MAX_OUTPUT_BYTES) {
      cappedStderr.push("[output truncated: cap exceeded]");
      break;
    }
    totalBytes += bytes;
    cappedStderr.push(line);
  }

  return { stdout: cappedStdout, stderr: cappedStderr, exitCode: raw.exitCode };
}
