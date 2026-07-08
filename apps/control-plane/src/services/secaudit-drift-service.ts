import { BaselineSnapshot, ControlStateSnapshot, DriftEvent, DriftSeverity, RiskScoreMetrics, RiskScoreReport, ControlStatus } from "../domain/secaudit-drift-store.js";
import { SecAuditStressReport } from "../domain/secaudit-stress-store.js";
import { createHash } from "crypto";

export interface BaselineStore {
  saveBaseline(baseline: BaselineSnapshot): Promise<void>;
  getLatestBaseline(planId: string): Promise<BaselineSnapshot | null>;
  listBaselines(planId: string, limit?: number): Promise<BaselineSnapshot[]>;
}

export interface DriftStore {
  saveDrift(event: DriftEvent): Promise<void>;
  getDriftsForPlan(planId: string, since?: Date): Promise<DriftEvent[]>;
  getDriftsBySeverity(planId: string, severity: DriftSeverity): Promise<DriftEvent[]>;
  markAlertSent(driftId: string): Promise<void>;
}

/**
 * In-memory baseline and drift store
 * (Postgres backing can be added via migration)
 */
export class InMemoryBaselineStore implements BaselineStore {
  private baselines = new Map<string, BaselineSnapshot[]>();

  async saveBaseline(baseline: BaselineSnapshot): Promise<void> {
    const key = baseline.planId;
    if (!this.baselines.has(key)) {
      this.baselines.set(key, []);
    }
    this.baselines.get(key)!.push(baseline);
  }

  async getLatestBaseline(planId: string): Promise<BaselineSnapshot | null> {
    const list = this.baselines.get(planId) ?? [];
    const latest = list.length > 0 ? list[list.length - 1] : null;
    return latest ?? null;
  }

  async listBaselines(planId: string, limit = 10): Promise<BaselineSnapshot[]> {
    const list = this.baselines.get(planId) ?? [];
    return list.slice(-limit).reverse();
  }
}

export class InMemoryDriftStore implements DriftStore {
  private drifts: DriftEvent[] = [];

  async saveDrift(event: DriftEvent): Promise<void> {
    this.drifts.push(event);
  }

  async getDriftsForPlan(planId: string, since?: Date): Promise<DriftEvent[]> {
    const filtered = this.drifts.filter((d) => d.planId === planId);
    if (!since) return filtered;
    return filtered.filter((d) => new Date(d.detectedAt) >= since);
  }

  async getDriftsBySeverity(planId: string, severity: DriftSeverity): Promise<DriftEvent[]> {
    return this.drifts.filter((d) => d.planId === planId && d.severity === severity);
  }

  async markAlertSent(driftId: string): Promise<void> {
    const drift = this.drifts.find((d) => d.id === driftId);
    if (drift) {
      drift.alertSent = true;
      drift.alertSentAt = new Date().toISOString();
    }
  }
}

/**
 * Drift Detection & Risk Scoring Engine
 */
export class DriftDetectionService {
  constructor(
    private baselineStore: BaselineStore,
    private driftStore: DriftStore,
  ) {}

  /**
   * Create baseline snapshot from audit plan result
   * Score = aggregate of control severities / total controls
   */
  async createBaselineFromPlan(
    planId: string,
    tenantId: string,
    modules: Array<{ id: string; findings?: Record<string, unknown> }>,
    triggerType: "manual" | "auto_weekly" | "auto_critical" = "manual",
  ): Promise<BaselineSnapshot> {
    const controlStates: ControlStateSnapshot[] = modules.map((m) => ({
      controlId: m.id,
      moduleId: m.id,
      status: this.deriveControlStatus(m.findings),
      finding: JSON.stringify(m.findings),
      remediated: false,
    }));

    const scoreAggregate = this.calculateAggregateScore(controlStates);
    const hash = this.hashControlStates(controlStates);

    const baseline: BaselineSnapshot = {
      id: `baseline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      planId,
      tenantId,
      snapshotAt: new Date().toISOString(),
      scoreAggregate,
      controlStates,
      triggerType,
      hash,
    };

    await this.baselineStore.saveBaseline(baseline);
    return baseline;
  }

  /**
   * Detect drifts between current and baseline
   */
  async detectDrifts(
    planId: string,
    tenantId: string,
    currentModules: Array<{ id: string; findings?: Record<string, unknown> }>,
  ): Promise<DriftEvent[]> {
    const baseline = await this.baselineStore.getLatestBaseline(planId);
    if (!baseline) return [];

    const currentStates = currentModules.map((m) => ({
      controlId: m.id,
      moduleId: m.id,
      status: this.deriveControlStatus(m.findings),
      finding: JSON.stringify(m.findings),
      remediated: false,
    }));

    const drifts: DriftEvent[] = [];

    for (const current of currentStates) {
      const prev = baseline.controlStates.find((cs) => cs.controlId === current.controlId);
      if (!prev) continue;

      if (prev.status !== current.status) {
        const severity = this.severityFromStatusChange(prev.status, current.status);
        const drift: DriftEvent = {
          id: `drift_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          planId,
          tenantId,
          controlId: current.controlId,
          moduleId: current.moduleId,
          changeType: "status_changed",
          severity,
          previous: { status: prev.status, timestamp: baseline.snapshotAt },
          current: { status: current.status, timestamp: new Date().toISOString() },
          detectedAt: new Date().toISOString(),
        };
        drifts.push(drift);
        await this.driftStore.saveDrift(drift);
      }
    }

    return drifts;
  }

  /**
   * Calculate risk score metrics
   * Formula: base_severity * exposure_multiplier * exploitability_multiplier + trend_adjustment
   * Clamped to 0-100
   */
  async calculateRiskScore(
    planId: string,
    tenantId: string,
    currentModules: Array<{ id: string; findings?: Record<string, unknown> }>,
  ): Promise<RiskScoreMetrics> {
    const baseline = await this.baselineStore.getLatestBaseline(planId);
    const allDrifts = await this.driftStore.getDriftsForPlan(planId);

    const currentStates = currentModules.map((m) => ({
      controlId: m.id,
      status: this.deriveControlStatus(m.findings),
    }));

    const failedCount = currentStates.filter((cs) => cs.status === "failed").length;
    const failurePercentage = (failedCount / currentStates.length) * 100;

    // Base score: 0-50 points from failure rate
    const baseScore = failurePercentage * 0.5;

    // Severity multiplier: critical drifts push score up
    const criticalDrifts = allDrifts.filter((d) => d.severity === "critical").length;
    const severityScore = Math.min(30, criticalDrifts * 3);

    // Exposure multiplier: assume 1.0 (can be enhanced with internet-facing flag)
    const exposureMultiplier = 1.0;

    // Exploitability multiplier: assume 1.0 (can be enhanced with CVE/POC data)
    const exploitabilityMultiplier = 1.0;

    // Trend adjustment: compare to previous baseline
    let adjustmentDelta = 0;
    if (baseline) {
      const prevFailed = baseline.controlStates.filter((cs) => cs.status === "failed").length;
      if (failedCount > prevFailed) {
        adjustmentDelta = Math.min(20, (failedCount - prevFailed) * 5);
      } else if (failedCount < prevFailed) {
        adjustmentDelta = Math.max(-20, (failedCount - prevFailed) * 5);
      }
    }

    const aggregateScore = Math.min(
      100,
      Math.max(0, (baseScore + severityScore) * exposureMultiplier * exploitabilityMultiplier + adjustmentDelta),
    );

    return {
      baselineSeverityScore: severityScore,
      failureCount: failedCount,
      failurePercentage,
      exposureMultiplier,
      exploitabilityMultiplier,
      adjustmentDelta,
      aggregateScore,
      severity: this.severityFromScore(aggregateScore),
    };
  }

  /**
   * Generate comprehensive risk report
   */
  async generateRiskReport(
    planId: string,
    tenantId: string,
    currentModules: Array<{ id: string; findings?: Record<string, unknown> }>,
  ): Promise<RiskScoreReport> {
    const currentScore = await this.calculateRiskScore(planId, tenantId, currentModules);
    const baseline = await this.baselineStore.getLatestBaseline(planId);
    const criticalDrifts = await this.driftStore.getDriftsBySeverity(planId, "critical");
    const recent7d = await this.driftStore.getDriftsForPlan(planId, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    let previousScore: RiskScoreMetrics | undefined;
    if (baseline && baseline.controlStates.length > 0) {
      const prevFailedCount = baseline.controlStates.filter((cs) => cs.status === "failed").length;
      const prevFailurePercentage = (prevFailedCount / baseline.controlStates.length) * 100;
      previousScore = {
        baselineSeverityScore: 0,
        failureCount: prevFailedCount,
        failurePercentage: prevFailurePercentage,
        exposureMultiplier: 1.0,
        exploitabilityMultiplier: 1.0,
        adjustmentDelta: 0,
        aggregateScore: baseline.scoreAggregate,
        severity: this.severityFromScore(baseline.scoreAggregate),
      };
    }

    const scoreChange = previousScore ? currentScore.aggregateScore - previousScore.aggregateScore : 0;

    const trendingControls = recent7d.slice(0, 5).map((d) => ({
      controlId: d.controlId,
      direction: (d.previous.status === "passed" ? "up" : "down") as "up" | "down",
      deltaPercentage: 5,
    }));

    const recommendations = this.generateRecommendations(currentScore, criticalDrifts.length);

    return {
      planId,
      tenantId,
      reportedAt: new Date().toISOString(),
      currentScore,
      previousScore,
      scoreChange,
      trendingControls,
      criticalDrifts: criticalDrifts.slice(0, 10),
      recommendations,
    };
  }

  // === Helpers ===

  private deriveControlStatus(findings?: Record<string, unknown>): ControlStatus {
    if (!findings) return "unknown";
    // Test format: count field
    if ("count" in findings) {
      const count = findings.count as number;
      return count === 0 ? "passed" : "failed";
    }
    // Standard format: ok field
    if (findings.ok === true) return "passed";
    if (findings.ok === false) return "failed";
    if (findings.error) return "failed";
    return "unknown";
  }

  private hashControlStates(states: ControlStateSnapshot[]): string {
    const json = JSON.stringify(states.map((s) => ({ id: s.controlId, st: s.status })));
    return createHash("sha256").update(json).digest("hex");
  }

  private calculateAggregateScore(states: ControlStateSnapshot[]): number {
    if (states.length === 0) return 0;
    const failed = states.filter((s) => s.status === "failed").length;
    return Math.round(((states.length - failed) / states.length) * 100);
  }

  private severityFromStatusChange(prev: ControlStatus, curr: ControlStatus): DriftSeverity {
    if (prev === "passed" && curr === "failed") return "critical";
    if (prev === "failed" && curr === "passed") return "low";
    if (prev === "unknown" || curr === "unknown") return "medium";
    return "high";
  }

  private severityFromScore(score: number): DriftSeverity {
    if (score >= 75) return "critical";
    if (score >= 60) return "high";
    if (score >= 40) return "medium";
    return "low";
  }

  private generateRecommendations(score: RiskScoreMetrics, criticalCount: number): string[] {
    const recs: string[] = [];
    if (score.aggregateScore >= 75) {
      recs.push("URGENT: Risk score critical. Investigate and remediate failed controls immediately.");
    }
    if (criticalCount > 0) {
      recs.push(`${criticalCount} control(s) have degraded from passed to failed. Review changes in last 24h.`);
    }
    if (score.failurePercentage > 30) {
      recs.push(`Over 30% of controls failing. Consider rolling back recent changes or applying hotfixes.`);
    }
    if (score.adjustmentDelta > 10) {
      recs.push("Risk trending upward. Increase monitoring frequency and alert sensitivity.");
    }
    if (recs.length === 0) {
      recs.push("Risk score stable. Continue standard monitoring schedule.");
    }
    return recs;
  }
}
