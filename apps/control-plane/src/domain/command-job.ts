export const COMMAND_JOB_STATUSES = [
  "created",
  "policy_check",
  "mfa_pending",
  "queued",
  "dispatched",
  "running",
  "streaming",
  "verifying",
  "completed",
  "failed",
  "cancelled",
  "blocked",
] as const;

export type CommandJobStatus = (typeof COMMAND_JOB_STATUSES)[number];

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const STREAM_TYPES = ["stdout", "stderr"] as const;
export type StreamType = (typeof STREAM_TYPES)[number];

export const FAIL_REASONS = [
  "policy_denied",
  "license_inactive",
  "mfa_failed",
  "dispatch_timeout",
  "runtime_timeout",
  "runner_error",
  "output_cap_exceeded",
  "network_interrupted",
  "cancelled_by_operator",
] as const;
export type FailReason = (typeof FAIL_REASONS)[number];

const TRANSITIONS: Record<CommandJobStatus, CommandJobStatus[]> = {
  created: ["policy_check", "blocked", "failed", "cancelled"],
  policy_check: ["mfa_pending", "queued", "blocked", "failed", "cancelled"],
  mfa_pending: ["queued", "blocked", "failed", "cancelled"],
  queued: ["dispatched", "blocked", "failed", "cancelled"],
  dispatched: ["running", "failed", "cancelled"],
  running: ["streaming", "verifying", "failed", "cancelled"],
  streaming: ["verifying", "failed", "cancelled"],
  verifying: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
  blocked: [],
};

export type TransitionResult = {
  ok: boolean;
  from: CommandJobStatus;
  to: CommandJobStatus;
  reason?: string;
};

export function isTerminalStatus(status: CommandJobStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(
  from: CommandJobStatus,
  to: CommandJobStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: CommandJobStatus,
  to: CommandJobStatus,
): TransitionResult {
  if (from === to) {
    return {
      ok: false,
      from,
      to,
      reason: "no_op_transition_not_allowed",
    };
  }

  if (canTransition(from, to)) {
    return { ok: true, from, to };
  }

  return {
    ok: false,
    from,
    to,
    reason: "invalid_transition",
  };
}

export function nextAllowedStatuses(
  status: CommandJobStatus,
): readonly CommandJobStatus[] {
  return TRANSITIONS[status];
}
