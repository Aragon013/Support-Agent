import { describe, expect, it } from "vitest";

import { computeSessionActionPermissions } from "./sessions-capabilities";

describe("computeSessionActionPermissions", () => {
  it("enables all actions when all capabilities are present", () => {
    const result = computeSessionActionPermissions([
      "screen",
      "input",
      "clipboard",
    ]);

    expect(result).toEqual({
      canControlStream: true,
      canSendInput: true,
      canSendClipboard: true,
    });
  });

  it("disables input and clipboard when only screen is present", () => {
    const result = computeSessionActionPermissions(["screen"]);

    expect(result).toEqual({
      canControlStream: true,
      canSendInput: false,
      canSendClipboard: false,
    });
  });

  it("disables all actions when capabilities are missing", () => {
    const result = computeSessionActionPermissions(undefined);

    expect(result).toEqual({
      canControlStream: false,
      canSendInput: false,
      canSendClipboard: false,
    });
  });
});
