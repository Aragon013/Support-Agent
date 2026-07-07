import { describe, expect, it } from "vitest";
import { withWatchdog } from "./watchdog.js";
import type { RunnerResult } from "./types.js";

const successResult: RunnerResult = {
  ok: true,
  output: { stdout: ["done"], stderr: [], exitCode: 0 },
};

describe("withWatchdog", () => {
  it("resolves with runner result when it completes in time", async () => {
    const { promise } = withWatchdog(Promise.resolve(successResult), 1_000);
    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it("resolves with timeout failure when runner exceeds limit", async () => {
    const never = new Promise<RunnerResult>(() => undefined);
    const { promise } = withWatchdog(never, 50);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("runtime_timeout");
    }
  });

  it("resolves with cancelled reason when cancel is called", async () => {
    const never = new Promise<RunnerResult>(() => undefined);
    const { promise, handle } = withWatchdog(never, 5_000);

    setTimeout(() => handle.cancel("cancelled_by_operator"), 20);

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cancelled_by_operator");
    }
  });
});
