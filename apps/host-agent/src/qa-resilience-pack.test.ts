import { describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "./dispatcher/command-dispatcher.js";
import type { CommandInitEnvelope, RunnerResult } from "./types.js";
import { AgentWsClient } from "./ws/agent-ws-client.js";

function makeEnvelope(commandId: string): CommandInitEnvelope {
  return {
    v: 1,
    kind: "command.init",
    seq: 1,
    jobId: `job-${Math.random().toString(36).slice(2)}`,
    commandId,
    commandVersion: "1.0.0",
    requestedAt: new Date().toISOString(),
    params: {},
  };
}

describe("QA-02 resilience pack", () => {
  it("releases slot after runtime timeout", async () => {
    const dispatcher = new CommandDispatcher(1, 25);

    vi.spyOn(await import("./runners/runner-registry.js"), "findRunner").mockReturnValueOnce(
      async () => new Promise<RunnerResult>(() => undefined),
    );

    expect(dispatcher.hasCapacity()).toBe(true);

    const result = await dispatcher.dispatch(makeEnvelope("diagnostic.system.info"));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toBe("runtime_timeout");
    }
    expect(dispatcher.hasCapacity()).toBe(true);
  });

  it("keeps coherent final status under cancel-finish race", async () => {
    const dispatcher = new CommandDispatcher(1, 5_000);

    vi.spyOn(await import("./runners/runner-registry.js"), "findRunner").mockReturnValueOnce(
      async () =>
        await new Promise<RunnerResult>((resolve) => {
          setTimeout(() => {
            resolve({ ok: true, output: { stdout: ["ok"], stderr: [], exitCode: 0 } });
          }, 25);
        }),
    );

    const env = makeEnvelope("diagnostic.system.info");
    const task = dispatcher.dispatch(env);

    setTimeout(() => {
      dispatcher.cancel(env.jobId, "cancelled_by_operator");
    }, 10);

    const result = await task;

    expect(["completed", "cancelled"]).toContain(result.status);
    expect(dispatcher.hasCapacity()).toBe(true);
  });

  it("applies reconnect backoff and cap correctly", () => {
    const dispatcherStub = {
      hasCapacity: () => true,
      dispatch: async () => ({ status: "unknown_command" as const }),
    } as unknown as CommandDispatcher;

    const client = new AgentWsClient(
      {
        controlPlaneUrl: "http://localhost:3000",
        tenantId: "tenant-1",
        endpointId: "endpoint-1",
        reconnectBaseMs: 10,
        reconnectMaxMs: 30,
      },
      dispatcherStub,
      () => undefined,
    ) as unknown as {
      reconnectDelay: number;
      scheduleReconnect: () => void;
      connect: () => void;
    };

    const connectSpy = vi.fn();
    client.connect = connectSpy;

    const delays: number[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...args: unknown[]) => void, ms?: number) => {
      delays.push(Number(ms ?? 0));
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    try {
      client.scheduleReconnect();
      client.scheduleReconnect();
      client.scheduleReconnect();

      expect(delays).toEqual([10, 20, 30]);
      expect(client.reconnectDelay).toBe(30);
      expect(connectSpy).toHaveBeenCalledTimes(3);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
