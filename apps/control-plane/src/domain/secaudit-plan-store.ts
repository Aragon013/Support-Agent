export type SecAuditPlanStatus = "draft" | "running" | "partial" | "completed" | "failed";

export type SecAuditExecutionLevel = "safe" | "safe_light" | "deep";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type SeverityBucket = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
};

export type SecAuditModuleResult = {
  moduleId: string;
  origin: "host" | "host_network" | "client_network";
  status: "pending" | "running" | "completed" | "failed" | "client_required";
  commandJobId?: string;
  findings?: Record<string, unknown>;
  evidence?: string[];
  error?: string;
  updatedAt: string;
};

export type SecAuditPlanRecord = {
  id: string;
  tenantId: string;
  endpointId: string;
  operatorId: string;
  packageId: string;
  targetOs: "windows" | "linux" | "macos" | "all";
  executionLevel: SecAuditExecutionLevel;
  modules: string[];
  status: SecAuditPlanStatus;
  results: SecAuditModuleResult[];
  score?: number;
  severityBuckets?: SeverityBucket;
  baselinePlanId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditComparison = {
  current: { id: string; score: number | undefined; buckets: SeverityBucket | undefined };
  baseline: { id: string; score: number | undefined; buckets: SeverityBucket | undefined } | null;
  scoreDelta: number | null;
  severityDelta: { critical: number; high: number; medium: number; low: number; info: number };
  percentageImprovement: number | null;
};

export type CreateSecAuditPlanInput = Omit<SecAuditPlanRecord, "id" | "createdAt" | "updatedAt" | "status" | "results" | "baselinePlanId">;

function calculateSeverityBuckets(results: SecAuditModuleResult[]): SeverityBucket {
  const buckets: SeverityBucket = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const result of results) {
    if (result.status !== "completed" || !result.findings) continue;
    const sev = (result.findings as { severity?: Severity }).severity ?? "info";
    if (sev in buckets) {
      buckets[sev as Severity] += 1;
    }
  }
  return buckets;
}

function calculateScore(results: SecAuditModuleResult[]): number {
  const buckets = calculateSeverityBuckets(results);
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (total === 0) return 100;
  const weighted = buckets.critical * 4 + buckets.high * 2 + buckets.medium * 1;
  return Math.max(0, Math.min(100, Math.floor(100 - (weighted / total) * 25)));
}

export class InMemorySecAuditPlanStore {
  private plans = new Map<string, SecAuditPlanRecord>();
  private seq = 0;

  create(input: CreateSecAuditPlanInput): SecAuditPlanRecord {
    this.seq += 1;
    const now = new Date().toISOString();
    const baseline = this.findPreviousCompleted(input.endpointId);
    const plan: SecAuditPlanRecord = {
      id: `secaudit_plan_${this.seq}`,
      tenantId: input.tenantId,
      endpointId: input.endpointId,
      operatorId: input.operatorId,
      packageId: input.packageId,
      targetOs: input.targetOs,
      executionLevel: input.executionLevel,
      modules: [...input.modules],
      baselinePlanId: baseline?.id,
      status: "draft",
      results: input.modules.map((moduleId) => ({
        moduleId,
        origin: moduleId.startsWith("net.client") ? "client_network" : moduleId.startsWith("net.host") ? "host_network" : "host",
        status: moduleId.startsWith("net.client") ? "client_required" : "pending",
        updatedAt: now,
      })),
      createdAt: now,
      updatedAt: now,
    };

    this.plans.set(plan.id, plan);
    return plan;
  }

  getById(id: string): SecAuditPlanRecord | undefined {
    return this.plans.get(id);
  }

  update(id: string, updater: (plan: SecAuditPlanRecord) => void): SecAuditPlanRecord | undefined {
    const found = this.plans.get(id);
    if (!found) return undefined;
    updater(found);
    found.updatedAt = new Date().toISOString();
    found.severityBuckets = calculateSeverityBuckets(found.results);
    found.score = calculateScore(found.results);
    this.plans.set(id, found);
    return found;
  }

  listByTenant(tenantId: string): SecAuditPlanRecord[] {
    const plans = Array.from(this.plans.values()).filter((x) => x.tenantId === tenantId);
    plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return plans;
  }

  findPreviousCompleted(endpointId: string, excludeId?: string): SecAuditPlanRecord | undefined {
    const completed = Array.from(this.plans.values())
      .filter((p) => p.endpointId === endpointId && p.status === "completed" && p.id !== excludeId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return completed[0];
  }

  compare(planId: string): AuditComparison | null {
    const current = this.getById(planId);
    if (!current) return null;

    const baseline = current.baselinePlanId ? this.getById(current.baselinePlanId) : this.findPreviousCompleted(current.endpointId, planId);

    const currentBuckets = current.severityBuckets ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const baselineBuckets = baseline?.severityBuckets ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

    const scoreDelta = current.score !== undefined && baseline?.score !== undefined ? current.score - baseline.score : null;
    const severityDelta = {
      critical: currentBuckets.critical - baselineBuckets.critical,
      high: currentBuckets.high - baselineBuckets.high,
      medium: currentBuckets.medium - baselineBuckets.medium,
      low: currentBuckets.low - baselineBuckets.low,
      info: currentBuckets.info - baselineBuckets.info,
    };

    const percentageImprovement =
      current.score !== undefined && baseline?.score !== undefined && baseline.score > 0
        ? Math.round(((current.score - baseline.score) / baseline.score) * 100 * 10) / 10
        : null;

    return {
      current: { id: current.id, score: current.score, buckets: currentBuckets },
      baseline: baseline ? { id: baseline.id, score: baseline.score, buckets: baselineBuckets } : null,
      scoreDelta,
      severityDelta,
      percentageImprovement,
    };
  }
}
