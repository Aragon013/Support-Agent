import { describe, expect, it } from "vitest";
import { runSystemInfo, runFirewallStatus, runServiceRestart } from "./catalog-runners.js";

describe("catalog runners", () => {
  it("system.info returns hostname and platform", async () => {
    const result = await runSystemInfo({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.output.stdout[0] ?? "{}") as {
        hostname: string;
        platform: string;
      };
      expect(typeof parsed.hostname).toBe("string");
      expect(typeof parsed.platform).toBe("string");
    }
  });

  it("firewall.status returns ok on any platform (non-win note or real output)", async () => {
    const result = await runFirewallStatus({ profile: "public" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.stdout.length).toBeGreaterThan(0);
    }
  });

  it("service.restart rejects unknown service", async () => {
    const result = await runServiceRestart({ serviceId: "EvilService" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("policy_denied");
    }
  });

  it("service.restart rejects empty serviceId", async () => {
    const result = await runServiceRestart({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_params");
    }
  });

  it("service.restart succeeds on non-Windows (returns note)", async () => {
    const result = await runServiceRestart({ serviceId: "Spooler" });
    if (process.platform !== "win32") {
      expect(result.ok).toBe(true);
      if (result.ok) {
        const note = result.output.stdout[0] ?? "";
        expect(note).toContain("Windows");
      }
    } else {
      expect(typeof result.ok).toBe("boolean");
    }
  });
});
