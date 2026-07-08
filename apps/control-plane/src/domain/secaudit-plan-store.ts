export type SecAuditPlanStatus = "draft" | "running" | "partial" | "completed" | "failed";

export type SecAuditExecutionLevel = "safe" | "safe_light" | "deep";

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
  createdAt: string;
  updatedAt: string;
};

export type CreateSecAuditPlanInput = Omit<SecAuditPlanRecord, "id" | "createdAt" | "updatedAt" | "status" | "results">;

export class InMemorySecAuditPlanStore {
  private plans = new Map<string, SecAuditPlanRecord>();
  private seq = 0;

  create(input: CreateSecAuditPlanInput): SecAuditPlanRecord {
    this.seq += 1;
    const now = new Date().toISOString();
    const plan: SecAuditPlanRecord = {
      id: `secaudit_plan_${this.seq}`,
      tenantId: input.tenantId,
      endpointId: input.endpointId,
      operatorId: input.operatorId,
      packageId: input.packageId,
      targetOs: input.targetOs,
      executionLevel: input.executionLevel,
      modules: [...input.modules],
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
    this.plans.set(id, found);
    return found;
  }

  listByTenant(tenantId: string): SecAuditPlanRecord[] {
    return Array.from(this.plans.values()).filter((x) => x.tenantId === tenantId);
  }
}
