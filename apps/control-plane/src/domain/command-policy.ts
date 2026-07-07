import type { RiskLevel } from "./command-job.js";

export type OperatorRole = "viewer" | "tech" | "admin";
export type EndpointLicenseStatus = "active" | "inactive";
export type EndpointInstallProfile =
  | "remote_only"
  | "support_limited_no_folders"
  | "support_full";

export type CommandPolicyConfig = {
  allowRemoteCommand: boolean;
  allowedCommandIds: string[];
  blockedCommandIds: string[];
  maxConcurrentCommandsPerEndpoint: number;
  requireMfaForRiskLevels: RiskLevel[];
  minRoleForRisk: Record<RiskLevel, OperatorRole>;
  blockCriticalByDefault: boolean;
};

export type CommandPolicyInput = {
  commandId: string;
  riskLevel: RiskLevel;
  operatorRole: OperatorRole;
  endpointLicenseStatus: EndpointLicenseStatus;
  endpointInstallProfile: EndpointInstallProfile;
  activeCommandCountForEndpoint: number;
  mfaVerified: boolean;
};

export type PolicyDecisionReason =
  | "allowed"
  | "license_inactive"
  | "install_profile_remote_only"
  | "remote_command_disabled"
  | "command_not_allowlisted"
  | "command_blocked"
  | "role_insufficient"
  | "endpoint_concurrency_limit"
  | "critical_blocked"
  | "mfa_required";

export type CommandPolicyDecision = {
  decision: "allow" | "deny" | "stepup";
  reason: PolicyDecisionReason;
};

export const DEFAULT_COMMAND_POLICY: CommandPolicyConfig = {
  allowRemoteCommand: true,
  allowedCommandIds: [],
  blockedCommandIds: [],
  maxConcurrentCommandsPerEndpoint: 2,
  requireMfaForRiskLevels: ["high", "critical"],
  minRoleForRisk: {
    low: "viewer",
    medium: "tech",
    high: "admin",
    critical: "admin",
  },
  blockCriticalByDefault: true,
};

const ROLE_ORDER: Record<OperatorRole, number> = {
  viewer: 1,
  tech: 2,
  admin: 3,
};

function hasSufficientRole(actual: OperatorRole, required: OperatorRole): boolean {
  return ROLE_ORDER[actual] >= ROLE_ORDER[required];
}

export function evaluateCommandPolicy(
  policy: CommandPolicyConfig,
  input: CommandPolicyInput,
): CommandPolicyDecision {
  if (input.endpointLicenseStatus !== "active") {
    return { decision: "deny", reason: "license_inactive" };
  }

  if (input.endpointInstallProfile === "remote_only") {
    return { decision: "deny", reason: "install_profile_remote_only" };
  }

  if (!policy.allowRemoteCommand) {
    return { decision: "deny", reason: "remote_command_disabled" };
  }

  if (policy.blockCriticalByDefault && input.riskLevel === "critical") {
    return { decision: "deny", reason: "critical_blocked" };
  }

  if (
    policy.allowedCommandIds.length > 0 &&
    !policy.allowedCommandIds.includes(input.commandId)
  ) {
    return { decision: "deny", reason: "command_not_allowlisted" };
  }

  if (policy.blockedCommandIds.includes(input.commandId)) {
    return { decision: "deny", reason: "command_blocked" };
  }

  const requiredRole = policy.minRoleForRisk[input.riskLevel];
  if (!hasSufficientRole(input.operatorRole, requiredRole)) {
    return { decision: "deny", reason: "role_insufficient" };
  }

  if (input.activeCommandCountForEndpoint >= policy.maxConcurrentCommandsPerEndpoint) {
    return { decision: "deny", reason: "endpoint_concurrency_limit" };
  }

  if (
    policy.requireMfaForRiskLevels.includes(input.riskLevel) &&
    !input.mfaVerified
  ) {
    return { decision: "stepup", reason: "mfa_required" };
  }

  return { decision: "allow", reason: "allowed" };
}
