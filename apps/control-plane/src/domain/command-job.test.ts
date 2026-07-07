import { describe, expect, it } from "vitest";

import {
  assertTransition,
  canTransition,
  COMMAND_JOB_STATUSES,
  isTerminalStatus,
  nextAllowedStatuses,
} from "./command-job.js";

describe("command job transitions", () => {
  it("allows required happy path transitions", () => {
    expect(canTransition("created", "policy_check")).toBe(true);
    expect(canTransition("policy_check", "queued")).toBe(true);
    expect(canTransition("queued", "dispatched")).toBe(true);
    expect(canTransition("dispatched", "running")).toBe(true);
    expect(canTransition("running", "verifying")).toBe(true);
    expect(canTransition("verifying", "completed")).toBe(true);
  });

  it("allows streaming branch", () => {
    expect(canTransition("running", "streaming")).toBe(true);
    expect(canTransition("streaming", "verifying")).toBe(true);
  });

  it("allows mfa branch", () => {
    expect(canTransition("policy_check", "mfa_pending")).toBe(true);
    expect(canTransition("mfa_pending", "queued")).toBe(true);
  });

  it("blocks impossible transitions", () => {
    expect(canTransition("created", "running")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("completed", "running")).toBe(false);
  });

  it("reports invalid transition details", () => {
    const result = assertTransition("created", "running");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_transition");
  });

  it("rejects no-op transitions", () => {
    const result = assertTransition("queued", "queued");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_op_transition_not_allowed");
  });

  it("marks final statuses as terminal", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("blocked")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
  });

  it("every status has transition definition", () => {
    for (const status of COMMAND_JOB_STATUSES) {
      expect(Array.isArray(nextAllowedStatuses(status))).toBe(true);
    }
  });
});
