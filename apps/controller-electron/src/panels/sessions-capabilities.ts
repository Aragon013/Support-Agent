export type SessionCapability = "screen" | "input" | "clipboard";

export type SessionActionPermissions = {
  canControlStream: boolean;
  canSendInput: boolean;
  canSendClipboard: boolean;
};

export function computeSessionActionPermissions(
  requestedCapabilities: SessionCapability[] | undefined,
): SessionActionPermissions {
  const capabilities = requestedCapabilities ?? [];

  return {
    canControlStream: capabilities.includes("screen"),
    canSendInput: capabilities.includes("input"),
    canSendClipboard: capabilities.includes("clipboard"),
  };
}
