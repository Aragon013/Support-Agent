import type { RunnerResult } from "./types.js";
import { DEFAULT_TIMEOUT_MS } from "./types.js";

export type WatchdogHandle = {
  cancel: (reason?: string) => void;
};

/**
 * Wraps a runner promise with:
 *  - hard timeout (timeoutMs)
 *  - external cancel via handle.cancel()
 *
 * On timeout/cancel the returned RunnerResult has ok=false and the
 * partial output collected so far.
 */
export function withWatchdog(
  runnerPromise: Promise<RunnerResult>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): { promise: Promise<RunnerResult>; handle: WatchdogHandle } {
  let cancelFn: (reason: string) => void = () => undefined;

  const cancelPromise = new Promise<RunnerResult>((resolve) => {
    cancelFn = (reason: string) => {
      resolve({
        ok: false,
        reason,
        output: { stdout: [], stderr: [`watchdog: ${reason}`], exitCode: 1 },
      });
    };
  });

  const timeoutPromise = new Promise<RunnerResult>((resolve) => {
    const t = setTimeout(() => {
      resolve({
        ok: false,
        reason: "runtime_timeout",
        output: {
          stdout: [],
          stderr: [`watchdog: timed out after ${timeoutMs}ms`],
          exitCode: 1,
        },
      });
    }, timeoutMs);
    t.unref();
  });

  const promise = Promise.race([runnerPromise, cancelPromise, timeoutPromise]);

  return {
    promise,
    handle: { cancel: (reason = "cancelled_by_operator") => cancelFn(reason) },
  };
}
