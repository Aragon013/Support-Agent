export const SESSION_STATUSES = [
  "requested",
  "pending_host",
  "pending_approval",
  "signaling",
  "connecting_p2p",
  "connected_p2p",
  "connected_relay",
  "reconnecting",
  "ended",
  "failed",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type SessionRouteMode = "unknown" | "direct" | "relay";
export type SessionApprovalMode = "unattended" | "user_consent";
export type SessionAccessMode = "view" | "control";
export type SessionCapability = "screen" | "input" | "clipboard";

export const NON_TERMINAL_SESSION_STATUSES: SessionStatus[] = [
  "requested",
  "pending_host",
  "pending_approval",
  "signaling",
  "connecting_p2p",
  "connected_p2p",
  "connected_relay",
  "reconnecting",
];

const TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  requested: ["pending_host", "failed", "ended"],
  pending_host: ["pending_approval", "signaling", "failed", "ended"],
  pending_approval: ["signaling", "ended", "failed"],
  signaling: ["connecting_p2p", "connected_p2p", "connected_relay", "failed", "ended"],
  connecting_p2p: ["connected_p2p", "connected_relay", "reconnecting", "failed", "ended"],
  connected_p2p: ["reconnecting", "ended", "failed"],
  connected_relay: ["reconnecting", "ended", "failed"],
  reconnecting: ["connected_p2p", "connected_relay", "failed", "ended"],
  ended: [],
  failed: [],
};

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
