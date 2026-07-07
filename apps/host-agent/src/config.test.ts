import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "./config.js";

describe("loadAgentConfig", () => {
  it("loads defaults when no env and no file", () => {
    const cfg = loadAgentConfig([], {});
    expect(cfg.controlPlaneUrl).toBe("http://localhost:3000");
    expect(cfg.tenantId).toBe("tenant-1");
    expect(cfg.endpointId).toBe("endpoint-local");
    expect(cfg.maxConcurrent).toBe(3);
    expect(cfg.timeoutMs).toBe(30000);
  });

  it("loads values from config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "host-agent-config-"));
    try {
      const path = join(dir, "agent.json");
      writeFileSync(
        path,
        JSON.stringify({
          controlPlaneUrl: "https://cp.example.com",
          tenantId: "tenant-acme",
          endpointId: "pc-001",
          maxConcurrent: 5,
          timeoutMs: 45000,
        }),
        "utf8",
      );

      const cfg = loadAgentConfig(["--config", path], {});
      expect(cfg.controlPlaneUrl).toBe("https://cp.example.com");
      expect(cfg.tenantId).toBe("tenant-acme");
      expect(cfg.endpointId).toBe("pc-001");
      expect(cfg.maxConcurrent).toBe(5);
      expect(cfg.timeoutMs).toBe(45000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("env vars override file values", () => {
    const dir = mkdtempSync(join(tmpdir(), "host-agent-config-"));
    try {
      const path = join(dir, "agent.json");
      writeFileSync(
        path,
        JSON.stringify({
          controlPlaneUrl: "https://cp.example.com",
          tenantId: "tenant-acme",
          endpointId: "pc-001",
          maxConcurrent: 2,
          timeoutMs: 15000,
        }),
        "utf8",
      );

      const cfg = loadAgentConfig(["--config", path], {
        CONTROL_PLANE_URL: "https://override.example.com",
        TENANT_ID: "tenant-override",
        ENDPOINT_ID: "pc-override",
        MAX_CONCURRENT: "7",
        TIMEOUT_MS: "60000",
      });

      expect(cfg.controlPlaneUrl).toBe("https://override.example.com");
      expect(cfg.tenantId).toBe("tenant-override");
      expect(cfg.endpointId).toBe("pc-override");
      expect(cfg.maxConcurrent).toBe(7);
      expect(cfg.timeoutMs).toBe(60000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on invalid numeric values", () => {
    expect(() => {
      loadAgentConfig([], { MAX_CONCURRENT: "0" });
    }).toThrow("MAX_CONCURRENT must be a positive integer");
  });
});
