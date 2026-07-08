/**
 * SecAudit Drift Detection & Risk Scoring Domain
 * - Baseline snapshots (control state at point in time)
 * - Drift events (control status changes)
 * - Risk scoring (severity + exposure + exploitability => 0-100)
 */

export type ControlStatus = "passed" | "failed" | "not_applicable" | "exception" | "unknown";
export type DriftSeverity = "critical" | "high" | "medium" | "low";
export type BaselineTrigger = "manual" | "auto_weekly" | "auto_critical";

export interface ControlStateSnapshot {
  controlId: string;
  moduleId: string;
  status: ControlStatus;
  finding?: string;
  remediated?: boolean;
}

export interface BaselineSnapshot {
  id: string;
  planId: string;
  tenantId: string;
  snapshotAt: string; // ISO timestamp
  scoreAggregate: number; // 0-100
  controlStates: ControlStateSnapshot[];
  triggerType: BaselineTrigger;
  hash: string; // SHA256 of control states for change detection
}

export interface DriftEvent {
  id: string;
  planId: string;
  tenantId: string;
  controlId: string;
  moduleId: string;
  changeType: "status_changed" | "threshold_crossed" | "exposure_changed";
  severity: DriftSeverity;
  previous: { status: ControlStatus; timestamp: string };
  current: { status: ControlStatus; timestamp: string };
  detectedAt: string;
  alertSent?: boolean;
  alertSentAt?: string;
}

export interface RiskScoreMetrics {
  baselineSeverityScore: number; // sum of failed control severities
  failureCount: number;
  failurePercentage: number;
  exposureMultiplier: number; // 1.0-2.0 (public/internet-facing = 2.0)
  exploitabilityMultiplier: number; // 1.0-2.5 (known POC/trending = 2.5)
  adjustmentDelta: number; // trend-based: -10 improving, +10 worsening
  aggregateScore: number; // min(100, base * exposure * exploitability + adjustment)
  severity: DriftSeverity; // derived from score: >=75 critical, 60-74 high, 40-59 medium, <40 low
}

export interface RiskScoreReport {
  planId: string;
  tenantId: string;
  reportedAt: string;
  currentScore: RiskScoreMetrics;
  previousScore?: RiskScoreMetrics | undefined;
  scoreChange: number;
  trendingControls: Array<{ controlId: string; direction: "up" | "down"; deltaPercentage: number }>;
  criticalDrifts: DriftEvent[];
  recommendations: string[];
  detectedDrifts?: DriftEvent[] | undefined;
}
