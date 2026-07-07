import { describe, expect, it } from "vitest";

import { InMemoryMfaStepupStore } from "./mfa-stepup.js";

describe("InMemoryMfaStepupStore", () => {
  it("issues challenge and verifies with expected otp", () => {
    const store = new InMemoryMfaStepupStore();
    const challenge = store.issueChallenge("tenant-1", "operator-1");

    const verify = store.verifyChallenge(
      challenge.id,
      "tenant-1",
      "operator-1",
      "000000",
    );

    expect(verify.ok).toBe(true);
    if (verify.ok) {
      expect(
        store.validateToken(verify.token, "tenant-1", "operator-1"),
      ).toBe(true);
    }
  });

  it("rejects invalid otp", () => {
    const store = new InMemoryMfaStepupStore();
    const challenge = store.issueChallenge("tenant-1", "operator-1");

    const verify = store.verifyChallenge(
      challenge.id,
      "tenant-1",
      "operator-1",
      "111111",
    );

    expect(verify.ok).toBe(false);
    if (!verify.ok) {
      expect(verify.reason).toBe("otp_invalid");
    }
  });
});
