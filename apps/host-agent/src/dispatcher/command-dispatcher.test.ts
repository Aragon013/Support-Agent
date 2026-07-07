import { describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../dispatcher/command-dispatcher.js";
import type { CommandInitEnvelope } from "../types.js";

function makeEnvelope(
  commandId: string,
  params: Record<string, unknown> = {},
): CommandInitEnvelope {
  return {
    v: 1,
    kind: "command.init",
    seq: 1,
    jobId: `job-${Math.random().toString(36).slice(2)}`,
    commandId,
    commandVersion: "1.0.0",
    requestedAt: new Date().toISOString(),
    params,
  };
}

describe("CommandDispatcher", () => {
  it("returns unknown_command for unregistered commandId", async () => {
    const d = new CommandDispatcher();
    const result = await d.dispatch(makeEnvelope("unknown.command"));
    expect(result.status).toBe("unknown_command");
  });

  it("completes diagnostic.system.info successfully", async () => {
    const d = new CommandDispatcher();
    const result = await d.dispatch(makeEnvelope("diagnostic.system.info"));
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.output.exitCode).toBe(0);
      expect(result.output.stdout.length).toBeGreaterThan(0);
    }
  });

  it("enforces slot concurrency limit", async () => {
    const d = new CommandDispatcher(1);
    expect(d.hasCapacity()).toBe(true);

    let resolveRunner!: () => void;
    vi.spyOn(
      await import("../runners/runner-registry.js"),
      "findRunner",
    ).mockReturnValueOnce(
      async () =>
        new Promise((resolve) => {
          resolveRunner = () =>
            resolve({ ok: true, output: { stdout: [], stderr: [], exitCode: 0 } });
        }),
    );

    const slowEnv = makeEnvelope("diagnostic.system.info");
    const dispatchPromise = d.dispatch(slowEnv);

    await new Promise<void>((r) => setTimeout(r, 10));
    expect(d.hasCapacity()).toBe(false);

    resolveRunner();
    await dispatchPromise;
    expect(d.hasCapacity()).toBe(true);
  });

  it("cancel stops an in-flight job", async () => {
    const d = new CommandDispatcher(1, 10_000);

    let resolveRunner!: () => void;
    vi.spyOn(
      await import("../runners/runner-registry.js"),
      "findRunner",
    ).mockReturnValueOnce(
      async () =>
        new Promise((resolve) => {
          resolveRunner = () =>
            resolve({ ok: true, output: { stdout: [], stderr: [], exitCode: 0 } });
        }),
    );

    const env = makeEnvelope("diagnostic.system.info");
    const dispatchPromise = d.dispatch(env);

    await new Promise<void>((r) => setTimeout(r, 10));
    const cancelled = d.cancel(env.jobId, "cancelled_by_operator");
    expect(cancelled).toBe(true);

    const result = await dispatchPromise;
    expect(result.status).toBe("cancelled");
    resolveRunner();
  });

  it("caps output at MAX_OUTPUT_BYTES", async () => {
    const d = new CommandDispatcher(1, 5_000);
    vi.spyOn(
      await import("../runners/runner-registry.js"),
      "findRunner",
    ).mockReturnValueOnce(async () => ({
      ok: true as const,
      output: {
        stdout: Array.from({ length: 1000 }, (_, i) => "x".repeat(600) + i),
        stderr: [],
        exitCode: 0,
      },
    }));

    const result = await d.dispatch(makeEnvelope("diagnostic.system.info"));
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      const totalBytes = result.output.stdout
        .join("")
        .length;
      expect(totalBytes).toBeLessThan(600 * 1024);
      const last = result.output.stdout.at(-1) ?? "";
      expect(last).toContain("[output truncated");
    }
  });
});
