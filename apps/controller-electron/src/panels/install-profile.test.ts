import { describe, expect, it } from "vitest";

import { resolveInstallProfile } from "./install-profile";

describe("resolveInstallProfile", () => {
  it("returns known profile values as-is", () => {
    expect(resolveInstallProfile("remote_only")).toBe("remote_only");
    expect(resolveInstallProfile("support_limited_no_folders")).toBe(
      "support_limited_no_folders",
    );
    expect(resolveInstallProfile("support_full")).toBe("support_full");
  });

  it("falls back to support_full when value is missing or invalid", () => {
    expect(resolveInstallProfile(undefined)).toBe("support_full");
    expect(resolveInstallProfile(null)).toBe("support_full");
    expect(resolveInstallProfile("bad_profile")).toBe("support_full");
    expect(resolveInstallProfile(123)).toBe("support_full");
  });
});
