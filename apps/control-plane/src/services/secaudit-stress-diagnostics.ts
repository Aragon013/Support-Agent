import {
  InMemorySecAuditStressStore,
  type SecAuditStressReport,
  type StressMetricSample,
  type StressRecoveryEvent,
  type StressRecoveryPolicy,
  type StressSummary,
} from "../domain/secaudit-stress-store.js";

export class HardwareLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HardwareLimitError";
  }
}

type BaseStressInput = {
  tenantId: string;
  operatorId: string;
  endpointId: string;
  iterations?: number;
  recoveryPolicy?: Partial<StressRecoveryPolicy>;
};

export type EthernetResilienceInput = BaseStressInput & {
  expectedBandwidthMbps?: number;
  saturationThresholdPct?: number;
};

export type WirelessDensityInput = BaseStressInput & {
  apId: string;
  expectedMaxClients?: number;
  associationThresholdPct?: number;
};

type EthernetCollector = (ctx: {
  iteration: number;
  expectedBandwidthMbps: number;
  saturationThresholdPct: number;
}) => Promise<StressMetricSample>;

type WirelessCollector = (ctx: {
  iteration: number;
  apId: string;
  expectedMaxClients: number;
  associationThresholdPct: number;
}) => Promise<StressMetricSample>;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? sorted[sorted.length - 1] ?? 0;
}

function summarize(metrics: StressMetricSample[]): StressSummary {
  const latency = metrics.map((m) => m.latencyMs);
  const loss = metrics.map((m) => m.packetLossPct);
  const response = metrics.map((m) => m.responseTimeMs);
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return {
    samples: metrics.length,
    avgLatencyMs: round2(avg(latency)),
    avgPacketLossPct: round2(avg(loss)),
    avgResponseTimeMs: round2(avg(response)),
    p95LatencyMs: round2(percentile(latency, 95)),
    p95ResponseTimeMs: round2(percentile(response, 95)),
    peakPacketLossPct: round2(loss.length ? Math.max(...loss) : 0),
  };
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RecoveryPreset = "conservative" | "balanced" | "aggressive";

export function getRecoveryPreset(preset: RecoveryPreset): Partial<StressRecoveryPolicy> {
  switch (preset) {
    case "conservative":
      return {
        autoResumeEnabled: true,
        stopThresholds: { packetLossPct: 25, latencyMs: 600, responseTimeMs: 1200 },
        resumeDelayMs: 500,
        resumeBackoffMs: 500,
        maxResumeAttempts: 1,
        resumeProbeSamples: 3,
        resumeHealthySamplesRequired: 3,
        resumeThresholds: { packetLossPct: 10, latencyMs: 300, responseTimeMs: 600 },
      };
    case "aggressive":
      return {
        autoResumeEnabled: true,
        stopThresholds: { packetLossPct: 8, latencyMs: 120, responseTimeMs: 240 },
        resumeDelayMs: 100,
        resumeBackoffMs: 200,
        maxResumeAttempts: 4,
        resumeProbeSamples: 2,
        resumeHealthySamplesRequired: 2,
        resumeThresholds: { packetLossPct: 2, latencyMs: 60, responseTimeMs: 120 },
      };
    case "balanced":
    default:
      return {
        autoResumeEnabled: true,
        stopThresholds: { packetLossPct: 18, latencyMs: 320, responseTimeMs: 520 },
        resumeDelayMs: 2000,
        resumeBackoffMs: 1000,
        maxResumeAttempts: 2,
        resumeProbeSamples: 2,
        resumeHealthySamplesRequired: 2,
        resumeThresholds: { packetLossPct: 6, latencyMs: 140, responseTimeMs: 240 },
      };
  }
}

function normalizeRecoveryPolicy(policy?: Partial<StressRecoveryPolicy>): StressRecoveryPolicy {
  const stopThresholds = policy?.stopThresholds;
  const resumeThresholds = policy?.resumeThresholds;
  return {
    autoResumeEnabled: policy?.autoResumeEnabled ?? false,
    stopThresholds: {
      packetLossPct: Math.max(1, stopThresholds?.packetLossPct ?? 18),
      latencyMs: Math.max(1, stopThresholds?.latencyMs ?? 320),
      responseTimeMs: Math.max(1, stopThresholds?.responseTimeMs ?? 520),
    },
    resumeDelayMs: Math.max(0, policy?.resumeDelayMs ?? 2000),
    resumeBackoffMs: Math.max(0, policy?.resumeBackoffMs ?? 1000),
    maxResumeAttempts: Math.max(0, Math.min(20, policy?.maxResumeAttempts ?? 2)),
    resumeProbeSamples: Math.max(1, Math.min(20, policy?.resumeProbeSamples ?? 2)),
    resumeHealthySamplesRequired: Math.max(1, Math.min(20, policy?.resumeHealthySamplesRequired ?? 2)),
    resumeThresholds: {
      packetLossPct: Math.max(0.1, resumeThresholds?.packetLossPct ?? 6),
      latencyMs: Math.max(1, resumeThresholds?.latencyMs ?? 140),
      responseTimeMs: Math.max(1, resumeThresholds?.responseTimeMs ?? 240),
    },
  };
}

function isSampleOverThreshold(
  sample: StressMetricSample,
  thresholds: { packetLossPct?: number; latencyMs?: number; responseTimeMs?: number },
): boolean {
  if (typeof thresholds.packetLossPct === "number" && sample.packetLossPct >= thresholds.packetLossPct) return true;
  if (typeof thresholds.latencyMs === "number" && sample.latencyMs >= thresholds.latencyMs) return true;
  if (typeof thresholds.responseTimeMs === "number" && sample.responseTimeMs >= thresholds.responseTimeMs) return true;
  return false;
}

async function probeRecovery(
  runProbe: () => Promise<StressMetricSample>,
  policy: StressRecoveryPolicy,
): Promise<number> {
  let healthy = 0;
  for (let probe = 0; probe < policy.resumeProbeSamples; probe += 1) {
    try {
      const sample = await runProbe();
      if (!isSampleOverThreshold(sample, policy.resumeThresholds)) {
        healthy += 1;
      }
    } catch {
      // Probe failure counts as unhealthy, continue probe loop.
    }
  }
  return healthy;
}

const defaultEthernetCollector: EthernetCollector = async ({ iteration, expectedBandwidthMbps, saturationThresholdPct }) => {
  const jitter = Math.max(0.75, 1 - iteration * 0.01);
  const bandwidthMbps = randomBetween(expectedBandwidthMbps * 0.7, expectedBandwidthMbps * 1.05) * jitter;
  const packetSaturationPct = randomBetween(42, 92);
  const latencyMs = randomBetween(4, 26) + packetSaturationPct * 0.12;
  const responseTimeMs = latencyMs + randomBetween(2, 20);
  const packetLossPct = randomBetween(0, Math.max(0.2, packetSaturationPct - 65) * 0.25);

  if (packetSaturationPct >= saturationThresholdPct || packetLossPct >= 18) {
    throw new HardwareLimitError(`ethernet_hardware_limit saturation=${round2(packetSaturationPct)} loss=${round2(packetLossPct)}`);
  }

  return {
    at: new Date().toISOString(),
    latencyMs: round2(latencyMs),
    packetLossPct: round2(packetLossPct),
    responseTimeMs: round2(responseTimeMs),
    bandwidthMbps: round2(Math.max(0, bandwidthMbps)),
    packetSaturationPct: round2(packetSaturationPct),
  };
};

const defaultWirelessCollector: WirelessCollector = async ({ iteration, expectedMaxClients, associationThresholdPct }) => {
  const associatedClients = Math.min(expectedMaxClients, Math.floor(randomBetween(expectedMaxClients * 0.45, expectedMaxClients * 1.08)));
  const associationCapacityPct = (associatedClients / Math.max(1, expectedMaxClients)) * 100;
  const latencyMs = randomBetween(8, 42) + associationCapacityPct * 0.2 + iteration * 0.1;
  const responseTimeMs = latencyMs + randomBetween(5, 28);
  const packetLossPct = randomBetween(0, Math.max(0.5, associationCapacityPct - 70) * 0.18);

  if (associationCapacityPct >= associationThresholdPct || packetLossPct >= 20) {
    throw new HardwareLimitError(`wireless_hardware_limit assoc=${round2(associationCapacityPct)} loss=${round2(packetLossPct)}`);
  }

  return {
    at: new Date().toISOString(),
    latencyMs: round2(latencyMs),
    packetLossPct: round2(packetLossPct),
    responseTimeMs: round2(responseTimeMs),
    associatedClients,
    maxClients: expectedMaxClients,
    associationCapacityPct: round2(associationCapacityPct),
  };
};

export class SecAuditStressDiagnostics {
  constructor(
    private readonly reportStore: InMemorySecAuditStressStore,
    private readonly ethernetCollector: EthernetCollector = defaultEthernetCollector,
    private readonly wirelessCollector: WirelessCollector = defaultWirelessCollector,
  ) {}

  async runEthernetResilience(input: EthernetResilienceInput): Promise<SecAuditStressReport> {
    const iterations = Math.max(1, Math.min(100, input.iterations ?? 12));
    const expectedBandwidthMbps = Math.max(50, input.expectedBandwidthMbps ?? 1000);
    const saturationThresholdPct = Math.max(65, Math.min(98, input.saturationThresholdPct ?? 88));
    const recoveryPolicy = normalizeRecoveryPolicy(input.recoveryPolicy);
    const metrics: StressMetricSample[] = [];
    const recoveryEvents: StressRecoveryEvent[] = [];
    let recoveryAttempts = 0;
    let resumed = false;

    let status: SecAuditStressReport["status"] = "completed";
    let terminationReason = "completed_all_iterations";

    for (let i = 0; i < iterations;) {
      try {
        const sample = await this.ethernetCollector({
          iteration: i,
          expectedBandwidthMbps,
          saturationThresholdPct,
        });
        if (isSampleOverThreshold(sample, recoveryPolicy.stopThresholds)) {
          throw new HardwareLimitError(
            `ethernet_policy_stop packetLoss=${round2(sample.packetLossPct)} latency=${round2(sample.latencyMs)} response=${round2(sample.responseTimeMs)}`,
          );
        }
        metrics.push(sample);
        i += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown_error";
        const hardwareLimit = error instanceof HardwareLimitError;
        if (!hardwareLimit) {
          status = "failed";
          terminationReason = reason;
          recoveryEvents.push({ kind: "stop", at: new Date().toISOString(), iteration: i, details: reason });
          break;
        }

        recoveryEvents.push({ kind: "stop", at: new Date().toISOString(), iteration: i, details: reason });

        if (!recoveryPolicy.autoResumeEnabled || recoveryAttempts >= recoveryPolicy.maxResumeAttempts) {
          status = "hardware_limit";
          terminationReason = reason;
          recoveryEvents.push({ kind: "resume_exhausted", at: new Date().toISOString(), iteration: i, details: "resume_disabled_or_attempts_exhausted" });
          break;
        }

        recoveryAttempts += 1;
        const waitMs = recoveryPolicy.resumeDelayMs + recoveryPolicy.resumeBackoffMs * (recoveryAttempts - 1);
        recoveryEvents.push({
          kind: "resume_attempt",
          at: new Date().toISOString(),
          iteration: i,
          details: "starting_resume_probe",
          attempt: recoveryAttempts,
          waitMs,
        });
        if (waitMs > 0) await sleep(waitMs);

        const healthy = await probeRecovery(
          () =>
            this.ethernetCollector({
              iteration: i,
              expectedBandwidthMbps,
              saturationThresholdPct,
            }),
          recoveryPolicy,
        );

        if (healthy >= recoveryPolicy.resumeHealthySamplesRequired) {
          resumed = true;
          recoveryEvents.push({
            kind: "resume_success",
            at: new Date().toISOString(),
            iteration: i,
            details: `healthy_probe_samples=${healthy}`,
            attempt: recoveryAttempts,
          });
          continue;
        }

        if (recoveryAttempts >= recoveryPolicy.maxResumeAttempts) {
          status = "hardware_limit";
          terminationReason = `resume_exhausted_after_${recoveryAttempts}_attempts`;
          recoveryEvents.push({
            kind: "resume_exhausted",
            at: new Date().toISOString(),
            iteration: i,
            details: `healthy_probe_samples=${healthy}`,
            attempt: recoveryAttempts,
          });
          break;
        }
      }
    }

    return this.reportStore.addReport({
      module: "ethernet_resilience",
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      endpointId: input.endpointId,
      status,
      terminationReason,
      closedSafely: true,
      summary: summarize(metrics),
      metrics,
      recovery: {
        policy: recoveryPolicy,
        attempts: recoveryAttempts,
        resumed,
        events: recoveryEvents,
      },
    });
  }

  async runWirelessDensity(input: WirelessDensityInput): Promise<SecAuditStressReport> {
    const iterations = Math.max(1, Math.min(120, input.iterations ?? 14));
    const expectedMaxClients = Math.max(10, input.expectedMaxClients ?? 150);
    const associationThresholdPct = Math.max(70, Math.min(100, input.associationThresholdPct ?? 92));
    const recoveryPolicy = normalizeRecoveryPolicy(input.recoveryPolicy);
    const metrics: StressMetricSample[] = [];
    const recoveryEvents: StressRecoveryEvent[] = [];
    let recoveryAttempts = 0;
    let resumed = false;

    let status: SecAuditStressReport["status"] = "completed";
    let terminationReason = "completed_all_iterations";

    for (let i = 0; i < iterations;) {
      try {
        const sample = await this.wirelessCollector({
          iteration: i,
          apId: input.apId,
          expectedMaxClients,
          associationThresholdPct,
        });
        if (isSampleOverThreshold(sample, recoveryPolicy.stopThresholds)) {
          throw new HardwareLimitError(
            `wireless_policy_stop packetLoss=${round2(sample.packetLossPct)} latency=${round2(sample.latencyMs)} response=${round2(sample.responseTimeMs)}`,
          );
        }
        metrics.push(sample);
        i += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown_error";
        const hardwareLimit = error instanceof HardwareLimitError;
        if (!hardwareLimit) {
          status = "failed";
          terminationReason = reason;
          recoveryEvents.push({ kind: "stop", at: new Date().toISOString(), iteration: i, details: reason });
          break;
        }

        recoveryEvents.push({ kind: "stop", at: new Date().toISOString(), iteration: i, details: reason });

        if (!recoveryPolicy.autoResumeEnabled || recoveryAttempts >= recoveryPolicy.maxResumeAttempts) {
          status = "hardware_limit";
          terminationReason = reason;
          recoveryEvents.push({ kind: "resume_exhausted", at: new Date().toISOString(), iteration: i, details: "resume_disabled_or_attempts_exhausted" });
          break;
        }

        recoveryAttempts += 1;
        const waitMs = recoveryPolicy.resumeDelayMs + recoveryPolicy.resumeBackoffMs * (recoveryAttempts - 1);
        recoveryEvents.push({
          kind: "resume_attempt",
          at: new Date().toISOString(),
          iteration: i,
          details: "starting_resume_probe",
          attempt: recoveryAttempts,
          waitMs,
        });
        if (waitMs > 0) await sleep(waitMs);

        const healthy = await probeRecovery(
          () =>
            this.wirelessCollector({
              iteration: i,
              apId: input.apId,
              expectedMaxClients,
              associationThresholdPct,
            }),
          recoveryPolicy,
        );

        if (healthy >= recoveryPolicy.resumeHealthySamplesRequired) {
          resumed = true;
          recoveryEvents.push({
            kind: "resume_success",
            at: new Date().toISOString(),
            iteration: i,
            details: `healthy_probe_samples=${healthy}`,
            attempt: recoveryAttempts,
          });
          continue;
        }

        if (recoveryAttempts >= recoveryPolicy.maxResumeAttempts) {
          status = "hardware_limit";
          terminationReason = `resume_exhausted_after_${recoveryAttempts}_attempts`;
          recoveryEvents.push({
            kind: "resume_exhausted",
            at: new Date().toISOString(),
            iteration: i,
            details: `healthy_probe_samples=${healthy}`,
            attempt: recoveryAttempts,
          });
          break;
        }
      }
    }

    return this.reportStore.addReport({
      module: "wireless_density",
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      endpointId: input.endpointId,
      status,
      terminationReason,
      closedSafely: true,
      summary: summarize(metrics),
      metrics,
      recovery: {
        policy: recoveryPolicy,
        attempts: recoveryAttempts,
        resumed,
        events: recoveryEvents,
      },
    });
  }
}
