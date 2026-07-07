import { describe, expect, it } from "vitest";
import { findRunner, registeredCommandIds } from "./runner-registry.js";

describe("runner-registry", () => {
  it("has exactly the 4 V1 catalog commands registered", () => {
    const ids = registeredCommandIds();
    expect(ids).toContain("diagnostic.system.info");
    expect(ids).toContain("security.firewall.status");
    expect(ids).toContain("maintenance.service.restart");
    expect(ids).toContain("maintenance.network.reset");
    expect(ids).toHaveLength(4);
  });

  it("returns undefined for unknown command", () => {
    expect(findRunner("unknown.command")).toBeUndefined();
  });
});
