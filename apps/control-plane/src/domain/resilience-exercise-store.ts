import { randomUUID } from "node:crypto";

export type ResilienceScopeKind = "wireless" | "perimeter" | "service";

export type ResilienceScope = {
  id: string;
  label: string;
  kind: ResilienceScopeKind;
  targetRef: string;
  authorizedBy: string;
  expiresAt: string;
  notes?: string;
  limits: {
    maxRps: number;
    maxConcurrency: number;
    maxDurationMinutes: number;
  };
  createdAt: string;
};

export type ResilienceProfile = {
  id: string;
  name: string;
  intensity: "baseline" | "stress" | "extreme";
  description: string;
  utilizationFactor: number;
  burstMultiplier: number;
  burstEverySeconds: number;
  recommendedDurationMinutes: number;
};

export type ResilienceExercise = {
  id: string;
  scopeId: string;
  profileId: string;
  tenantId: string;
  operatorId: string;
  ticketRef: string;
  rationale: string;
  mode: "dry-run";
  status: "planned";
  disclaimerAcceptedAt: string;
  createdAt: string;
  plan: {
    targetRps: number;
    burstRps: number;
    concurrency: number;
    durationMinutes: number;
    targetRef: string;
    kind: ResilienceScopeKind;
  };
};

export const DEFAULT_RESILIENCE_PROFILES: ResilienceProfile[] = [
  {
    id: "baseline-canary",
    name: "Baseline Canary",
    intensity: "baseline",
    description: "Low-risk readiness rehearsal with measured ramp and no production pressure.",
    utilizationFactor: 0.3,
    burstMultiplier: 1.25,
    burstEverySeconds: 60,
    recommendedDurationMinutes: 15,
  },
  {
    id: "stress-guarded",
    name: "Stress Guarded",
    intensity: "stress",
    description: "Guarded high-load exercise to validate alerts, throttles and operator response.",
    utilizationFactor: 0.65,
    burstMultiplier: 1.8,
    burstEverySeconds: 30,
    recommendedDurationMinutes: 20,
  },
  {
    id: "extreme-tabletop",
    name: "Extreme Tabletop",
    intensity: "extreme",
    description: "Dry-run planning profile for maximum authorized envelope and incident choreography.",
    utilizationFactor: 1,
    burstMultiplier: 2.2,
    burstEverySeconds: 15,
    recommendedDurationMinutes: 12,
  },
];

export class InMemoryResilienceExerciseStore {
  private readonly scopes = new Map<string, ResilienceScope>();
  private readonly exercises: ResilienceExercise[] = [];

  constructor() {
    const now = new Date().toISOString();
    const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString();
    const defaults: ResilienceScope[] = [
      {
        id: "scope_wireless_hq",
        label: "HQ Wi-Fi Floor 1",
        kind: "wireless",
        targetRef: "ssid://rsp-hq-floor1",
        authorizedBy: "security-ops",
        expiresAt: farFuture,
        notes: "Authorized only for dry-run readiness planning and controlled validation windows.",
        limits: { maxRps: 1200, maxConcurrency: 250, maxDurationMinutes: 20 },
        createdAt: now,
      },
      {
        id: "scope_perimeter_primary",
        label: "Primary Edge API",
        kind: "perimeter",
        targetRef: "service://api-primary-edge",
        authorizedBy: "netops",
        expiresAt: farFuture,
        notes: "Edge ingress scope for resilience planning and approved rehearsal windows.",
        limits: { maxRps: 3000, maxConcurrency: 600, maxDurationMinutes: 30 },
        createdAt: now,
      },
    ];

    for (const scope of defaults) {
      this.scopes.set(scope.id, scope);
    }
  }

  listScopes(): ResilienceScope[] {
    return Array.from(this.scopes.values()).sort((a, b) => a.label.localeCompare(b.label));
  }

  getScopeById(id: string): ResilienceScope | undefined {
    return this.scopes.get(id);
  }

  createScope(input: Omit<ResilienceScope, "id" | "createdAt">): ResilienceScope {
    const created: ResilienceScope = {
      id: `res_scope_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.scopes.set(created.id, created);
    return created;
  }

  listProfiles(): ResilienceProfile[] {
    return [...DEFAULT_RESILIENCE_PROFILES];
  }

  getProfileById(id: string): ResilienceProfile | undefined {
    return DEFAULT_RESILIENCE_PROFILES.find((profile) => profile.id === id);
  }

  addExercise(input: Omit<ResilienceExercise, "id" | "createdAt">): ResilienceExercise {
    const exercise: ResilienceExercise = {
      id: `res_ex_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.exercises.unshift(exercise);
    if (this.exercises.length > 200) this.exercises.length = 200;
    return exercise;
  }

  listExercises(): ResilienceExercise[] {
    return [...this.exercises];
  }
}
