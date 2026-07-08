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
