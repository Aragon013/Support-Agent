import { randomUUID } from "node:crypto";

type MfaChallenge = {
  id: string;
  tenantId: string;
  operatorId: string;
  createdAtMs: number;
  expiresAtMs: number;
  verified: boolean;
  verifiedAtMs?: number;
};

type MfaToken = {
  token: string;
  tenantId: string;
  operatorId: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

export class InMemoryMfaStepupStore {
  private readonly challenges = new Map<string, MfaChallenge>();
  private readonly tokens = new Map<string, MfaToken>();

  issueChallenge(tenantId: string, operatorId: string, ttlMinutes = 10): MfaChallenge {
    const now = Date.now();
    const challenge: MfaChallenge = {
      id: randomUUID(),
      tenantId,
      operatorId,
      createdAtMs: now,
      expiresAtMs: now + ttlMinutes * 60_000,
      verified: false,
    };

    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  verifyChallenge(
    challengeId: string,
    tenantId: string,
    operatorId: string,
    otp: string,
    tokenTtlMinutes = 10,
  ): { ok: true; token: string; expiresAt: string } | { ok: false; reason: string } {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      return { ok: false, reason: "challenge_not_found" };
    }

    const now = Date.now();
    if (now > challenge.expiresAtMs) {
      return { ok: false, reason: "challenge_expired" };
    }

    if (challenge.tenantId !== tenantId || challenge.operatorId !== operatorId) {
      return { ok: false, reason: "challenge_subject_mismatch" };
    }

    if (otp !== "000000") {
      return { ok: false, reason: "otp_invalid" };
    }

    challenge.verified = true;
    challenge.verifiedAtMs = now;
    this.challenges.set(challenge.id, challenge);

    const token: MfaToken = {
      token: randomUUID(),
      tenantId,
      operatorId,
      issuedAtMs: now,
      expiresAtMs: now + tokenTtlMinutes * 60_000,
    };
    this.tokens.set(token.token, token);

    return {
      ok: true,
      token: token.token,
      expiresAt: new Date(token.expiresAtMs).toISOString(),
    };
  }

  validateToken(token: string, tenantId: string, operatorId: string): boolean {
    const found = this.tokens.get(token);
    if (!found) {
      return false;
    }

    if (Date.now() > found.expiresAtMs) {
      return false;
    }

    return found.tenantId === tenantId && found.operatorId === operatorId;
  }
}
