import { randomUUID } from "node:crypto";

export type StressModuleType = "ethernet_resilience" | "wireless_density";

export type StressMetricSample = {
  at: string;
  latencyMs: number;
  packetLossPct: number;
  responseTimeMs: number;
  bandwidthMbps?: number;
  packetSaturationPct?: number;
  associatedClients?: number;
  maxClients?: number;
  associationCapacityPct?: number;
};

export type StressSummary = {
  samples: number;
  avgLatencyMs: number;
  avgPacketLossPct: number;
  avgResponseTimeMs: number;
  p95LatencyMs: number;
  p95ResponseTimeMs: number;
  peakPacketLossPct: number;
};

export type StressStopThresholds = {
  packetLossPct?: number;
  latencyMs?: number;
  responseTimeMs?: number;
};

export type StressRecoveryThresholds = {
  packetLossPct?: number;
  latencyMs?: number;
  responseTimeMs?: number;
};

export type StressRecoveryPolicy = {
  autoResumeEnabled: boolean;
  stopThresholds: StressStopThresholds;
  resumeDelayMs: number;
  resumeBackoffMs: number;
  maxResumeAttempts: number;
  resumeProbeSamples: number;
  resumeHealthySamplesRequired: number;
  resumeThresholds: StressRecoveryThresholds;
};

export type StressRecoveryEvent = {
  kind: "stop" | "resume_attempt" | "resume_success" | "resume_exhausted";
  at: string;
  iteration: number;
  details: string;
  attempt?: number;
  waitMs?: number;
};

export type StressRecoveryTrace = {
  policy: StressRecoveryPolicy;
  attempts: number;
  resumed: boolean;
  events: StressRecoveryEvent[];
};

export type SecAuditStressReport = {
  id: string;
  module: StressModuleType;
  tenantId: string;
  operatorId: string;
  endpointId: string;
  createdAt: string;
  status: "completed" | "hardware_limit" | "failed";
  terminationReason: string;
  closedSafely: boolean;
  summary: StressSummary;
  metrics: StressMetricSample[];
  recovery: StressRecoveryTrace;
};

export class InMemorySecAuditStressStore {
  private readonly reports: SecAuditStressReport[] = [];

  addReport(input: Omit<SecAuditStressReport, "id" | "createdAt">): SecAuditStressReport {
    const report: SecAuditStressReport = {
      id: `secaudit_stress_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.reports.unshift(report);
    if (this.reports.length > 400) this.reports.length = 400;
    return report;
  }

  listReports(filter?: { tenantId?: string; module?: StressModuleType }): SecAuditStressReport[] {
    return this.reports.filter((report) => {
      if (filter?.tenantId && report.tenantId !== filter.tenantId) return false;
      if (filter?.module && report.module !== filter.module) return false;
      return true;
    });
  }

  getById(id: string): SecAuditStressReport | undefined {
    return this.reports.find((report) => report.id === id);
  }
}
