import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMAND_POLICY,
  evaluateCommandPolicy,
  type CommandPolicyConfig,
} from "./command-policy.js";

function withPolicy(overrides: Partial<CommandPolicyConfig>): CommandPolicyConfig {
  return {
    ...DEFAULT_COMMAND_POLICY,
    ...overrides,
  };
}

describe("evaluateCommandPolicy", () => {
  it("denies when endpoint license is inactive", () => {
    const result = evaluateCommandPolicy(DEFAULT_COMMAND_POLICY, {
      commandId: "diagnostic.system.info",
      riskLevel: "low",
      operatorRole: "admin",
      endpointLicenseStatus: "inactive",
      activeCommandCountForEndpoint: 0,
      mfaVerified: false,
    });

    expect(result).toEqual({ decision: "deny", reason: "license_inactive" });
  });

  it("denies when role is insufficient for risk", () => {
    const result = evaluateCommandPolicy(DEFAULT_COMMAND_POLICY, {
      commandId: "maintenance.network.reset",
      riskLevel: "high",
      operatorRole: "tech",
      endpointLicenseStatus: "active",
      activeCommandCountForEndpoint: 0,
      mfaVerified: false,
    });

    expect(result).toEqual({ decision: "deny", reason: "role_insufficient" });
  });

  it("returns stepup when MFA is required but not verified", () => {
    const relaxedRolePolicy = withPolicy({
      minRoleForRisk: {
        low: "viewer",
        medium: "tech",
        high: "tech",
        critical: "admin",
      },
    });

    const result = evaluateCommandPolicy(relaxedRolePolicy, {
      commandId: "maintenance.network.reset",
      riskLevel: "high",
      operatorRole: "tech",
      endpointLicenseStatus: "active",
      activeCommandCountForEndpoint: 0,
      mfaVerified: false,
    });

    expect(result).toEqual({ decision: "stepup", reason: "mfa_required" });
  });

  it("allows high-risk when MFA is verified and role is sufficient", () => {
    const relaxedRolePolicy = withPolicy({
      minRoleForRisk: {
        low: "viewer",
        medium: "tech",
        high: "tech",
        critical: "admin",
      },
    });

    const result = evaluateCommandPolicy(relaxedRolePolicy, {
      commandId: "maintenance.network.reset",
      riskLevel: "high",
      operatorRole: "tech",
      endpointLicenseStatus: "active",
      activeCommandCountForEndpoint: 0,
      mfaVerified: true,
    });

    expect(result).toEqual({ decision: "allow", reason: "allowed" });
  });

  it("denies when endpoint command concurrency limit is reached", () => {
    const result = evaluateCommandPolicy(DEFAULT_COMMAND_POLICY, {
      commandId: "diagnostic.system.info",
      riskLevel: "low",
      operatorRole: "admin",
      endpointLicenseStatus: "active",
      activeCommandCountForEndpoint: 2,
      mfaVerified: false,
    });

    expect(result).toEqual({
      decision: "deny",
      reason: "endpoint_concurrency_limit",
    });
  });
});
