import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { InMemoryEndpointRegistry } from "./endpoint-registry.js";

// Run tests in a temp dir to avoid polluting the workspace
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp-registry-test-"));
  process.env.NODE_ENV = "development";
  // Override cwd so persist() writes to tmp
  const origCwd = process.cwd;
  process.cwd = () => tmpDir;
  // Restore after test
  (globalThis as Record<string, unknown>)._origCwd = origCwd;
});

afterEach(async () => {
  const origCwd = (globalThis as Record<string, unknown>)._origCwd as typeof process.cwd;
  if (origCwd) {
    process.cwd = origCwd;
  }
  delete (globalThis as Record<string, unknown>)._origCwd;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const makeEndpoint = (endpointId = "endpoint-1") => ({
  endpointId,
  installProfile: "support_full" as const,
  licenseStatus: "active" as const,
  supportCommandsAllowed: true,
  folderActionsAllowed: true,
  unattendedEnabled: false,
  requiresUserConsent: true,
  maxActiveControlSessions: 1,
});

describe("InMemoryEndpointRegistry", () => {
  it("returns null for unknown endpoints before init", () => {
    const registry = new InMemoryEndpointRegistry();
    expect(registry.get("does-not-exist")).toBeNull();
  });

  it("loads default endpoints after init", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();

    expect(registry.get("endpoint-1")).toMatchObject({
      endpointId: "endpoint-1",
      installProfile: "support_full",
      licenseStatus: "active",
    });

    expect(registry.get("endpoint-2")).toMatchObject({
      endpointId: "endpoint-2",
      installProfile: "support_limited_no_folders",
    });
  });

  it("registers and retrieves an endpoint", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();

    await registry.register(makeEndpoint("laptop-001"));

    const result = registry.get("laptop-001");
    expect(result).not.toBeNull();
    expect(result?.endpointId).toBe("laptop-001");
    expect(result?.installProfile).toBe("support_full");
    expect(result?.registeredAt).toBeDefined();
  });

  it("registers preserves registeredAt when already set", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();

    const fixedDate = "2026-01-01T00:00:00.000Z";
    await registry.register({ ...makeEndpoint("laptop-002"), registeredAt: fixedDate });

    expect(registry.get("laptop-002")?.registeredAt).toBe(fixedDate);
  });

  it("overwrites endpoint on re-register", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();

    await registry.register(makeEndpoint("laptop-001"));
    await registry.register({
      ...makeEndpoint("laptop-001"),
      installProfile: "remote_only",
      licenseStatus: "inactive",
    });

    const result = registry.get("laptop-001");
    expect(result?.installProfile).toBe("remote_only");
    expect(result?.licenseStatus).toBe("inactive");
  });

  it("listAll includes all registered endpoints", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();

    await registry.register(makeEndpoint("a"));
    await registry.register(makeEndpoint("b"));
    await registry.register(makeEndpoint("c"));

    const all = registry.listAll();
    const ids = all.map((e) => e.endpointId);

    // Defaults + 3 new
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it("unregisters an endpoint", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();

    await registry.register(makeEndpoint("to-delete"));
    expect(registry.get("to-delete")).not.toBeNull();

    await registry.unregister("to-delete");
    expect(registry.get("to-delete")).toBeNull();
  });

  it("unregister of unknown endpoint does not throw", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();

    await expect(registry.unregister("never-existed")).resolves.not.toThrow();
  });

  it("persists to JSON and re-loads on next init", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();
    await registry.register(makeEndpoint("persisted-endpoint"));

    // Verify JSON file was created
    const jsonPath = path.join(tmpDir, ".endpoints-registry.json");
    const raw = await fs.readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["persisted-endpoint"]).toBeDefined();

    // New registry instance, loads from JSON
    const registry2 = new InMemoryEndpointRegistry();
    await registry2.init();
    expect(registry2.get("persisted-endpoint")).toMatchObject({
      endpointId: "persisted-endpoint",
    });
  });

  it("re-loads after unregister persisted to JSON", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();

    await registry.register(makeEndpoint("temp"));
    await registry.unregister("temp");

    const registry2 = new InMemoryEndpointRegistry();
    await registry2.init();
    expect(registry2.get("temp")).toBeNull();
  });

  it("supportCommandsAllowed is false for remote_only profile", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();

    await registry.register({
      ...makeEndpoint("restricted"),
      installProfile: "remote_only",
      supportCommandsAllowed: false,
      folderActionsAllowed: false,
    });

    const result = registry.get("restricted");
    expect(result?.supportCommandsAllowed).toBe(false);
    expect(result?.folderActionsAllowed).toBe(false);
  });

  it("folderActionsAllowed is false for support_limited_no_folders profile", async () => {
    const registry = new InMemoryEndpointRegistry();
    await registry.init();

    await registry.register({
      ...makeEndpoint("limited"),
      installProfile: "support_limited_no_folders",
      supportCommandsAllowed: true,
      folderActionsAllowed: false,
    });

    const result = registry.get("limited");
    expect(result?.supportCommandsAllowed).toBe(true);
    expect(result?.folderActionsAllowed).toBe(false);
  });
});
