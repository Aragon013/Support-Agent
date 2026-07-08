import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { apiUrl } from "@/lib/backend-url";

interface RiskScoreMetrics {
  baselineSeverityScore: number;
  failureCount: number;
  failurePercentage: number;
  exposureMultiplier: number;
  exploitabilityMultiplier: number;
  adjustmentDelta: number;
  aggregateScore: number;
  severity: "critical" | "high" | "medium" | "low";
}

interface DriftEvent {
  id: string;
  planId: string;
  tenantId: string;
  controlId: string;
  changeType: string;
  severity: "critical" | "high" | "medium" | "low";
  previous: { status: string; timestamp: string };
  current: { status: string; timestamp: string };
  detectedAt: string;
  alertSent?: boolean;
}

interface RiskScoreReport {
  planId: string;
  tenantId: string;
  reportedAt: string;
  currentScore: RiskScoreMetrics;
  previousScore?: RiskScoreMetrics | undefined;
  scoreChange: number;
  trendingControls: string[];
  criticalDrifts: DriftEvent[];
  recommendations: string[];
  detectedDrifts?: DriftEvent[];
}

interface TrendDataPoint {
  timestamp: string;
  score: number;
}

const SEVERITY_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  critical: {
    bg: "bg-danger/10",
    text: "text-danger",
    border: "border-danger/40",
  },
  high: {
    bg: "bg-danger/10",
    text: "text-danger",
    border: "border-danger/30",
  },
  medium: {
    bg: "bg-warn/10",
    text: "text-warn",
    border: "border-warn/30",
  },
  low: {
    bg: "bg-brand/10",
    text: "text-brand",
    border: "border-brand/30",
  },
};

interface RiskAndDriftPanelProps {
  planId: string;
  tenantId: string;
  onDriftAlert?: (drift: DriftEvent) => void;
}

export function RiskAndDriftPanel({ planId, tenantId, onDriftAlert }: RiskAndDriftPanelProps) {
  const [report, setReport] = useState<RiskScoreReport | null>(null);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const fetchRiskScore = useCallback(async () => {
    if (!planId || !tenantId) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(apiUrl(`/api/v1/secaudit/risk-score/${planId}`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch risk score`);
      }

      const data: RiskScoreReport = await response.json();
      setReport(data);

      // Update trend data
      setTrendData((prev) => [
        ...prev.slice(-59), // Keep last 60 points (1 hour at 60s intervals)
        { timestamp: new Date().toISOString(), score: data.currentScore.aggregateScore },
      ]);

      setLastRefresh(new Date().toLocaleTimeString());

      // Trigger alert for critical drifts
      if (data.criticalDrifts && data.criticalDrifts.length > 0) {
        data.criticalDrifts.forEach((drift) => {
          if (!drift.alertSent && onDriftAlert) {
            onDriftAlert(drift);
          }
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [planId, tenantId, onDriftAlert]);

  // Poll for risk score every 60 seconds
  useEffect(() => {
    fetchRiskScore();
    const interval = setInterval(fetchRiskScore, 60000);
    return () => clearInterval(interval);
  }, [fetchRiskScore]);

  if (!planId || !tenantId) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-400">
        <p>No plan selected. Run an audit to enable risk monitoring.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 bg-surface-800 rounded-lg border border-slate-700">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-brand" />
          <h3 className="text-lg font-semibold text-slate-100">Risk & Drift Monitoring</h3>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && <span className="text-xs text-slate-400">Last: {lastRefresh}</span>}
          <button
            onClick={fetchRiskScore}
            disabled={isLoading}
            className="p-2 hover:bg-surface-700 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCw className={cn("w-4 h-4 text-brand", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded text-danger text-sm">
          {error}
        </div>
      )}

      {report ? (
        <>
          {/* Risk Score Gauge */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "p-4 rounded-lg border transition-all",
              SEVERITY_COLOR[report.currentScore.severity].bg,
              SEVERITY_COLOR[report.currentScore.severity].border
            )}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 mb-1">Aggregate Risk Score</p>
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-3xl font-bold", SEVERITY_COLOR[report.currentScore.severity].text)}>
                    {Math.round(report.currentScore.aggregateScore)}
                  </span>
                  <span className={cn("text-xs px-2 py-1 rounded-full bg-slate-900/50", SEVERITY_COLOR[report.currentScore.severity].text)}>
                    {report.currentScore.severity.toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1 justify-end">
                  {report.scoreChange > 0 ? (
                    <TrendingUp className="w-4 h-4 text-danger" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-success" />
                  )}
                  <span className={report.scoreChange > 0 ? "text-danger" : "text-success"}>
                    {report.scoreChange > 0 ? "+" : ""}{Math.round(report.scoreChange)}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Failure Rate: {Math.round(report.currentScore.failurePercentage)}%
                </p>
                <p className="text-xs text-slate-400">
                  Failed Controls: {report.currentScore.failureCount}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Trend Chart (simplified sparkline) */}
          {trendData.length > 1 && (
            <div className="p-3 bg-surface-700 rounded border border-slate-600">
              <p className="text-xs text-slate-400 mb-2">Score Trend (Last 60 min)</p>
              <TrendSparkline data={trendData} />
            </div>
          )}

          {/* Critical Drifts */}
          {report.criticalDrifts && report.criticalDrifts.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-danger" />
                Critical Drifts ({report.criticalDrifts.length})
              </h4>
              <AnimatePresence>
                {report.criticalDrifts.map((drift) => (
                  <motion.div
                    key={drift.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="p-3 bg-danger/10 border border-danger/30 rounded text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-danger">
                          Control <code className="bg-slate-900/50 px-1 rounded text-xs">{drift.controlId}</code>
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Changed: {drift.previous.status}{" -> "}{drift.current.status}
                        </p>
                      </div>
                      <span className="text-xs text-slate-500">
                        {new Date(drift.detectedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* Recommendations */}
          {report.recommendations && report.recommendations.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-300">AI-Generated Recommendations</h4>
              <ul className="space-y-2">
                {report.recommendations.slice(0, 3).map((rec, idx) => (
                  <motion.li
                    key={idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex gap-2 text-sm text-slate-300 bg-surface-700 p-2 rounded border border-slate-600"
                  >
                    <CheckCircle2 className="w-4 h-4 text-brand mt-0.5 flex-shrink-0" />
                    <span>{rec}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-4 text-xs text-slate-500 pt-2 border-t border-slate-600">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>Reported: {new Date(report.reportedAt).toLocaleTimeString()}</span>
            </div>
          </div>
        </>
      ) : isLoading ? (
        <div className="h-20 flex items-center justify-center text-slate-400">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity }}>
            <RefreshCw className="w-5 h-5" />
          </motion.div>
        </div>
      ) : (
        <div className="h-20 flex items-center justify-center text-slate-400">
          <p>No risk data available. Run an audit first.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Simple sparkline chart showing risk score trend over time
 */
function TrendSparkline({ data }: { data: TrendDataPoint[] }) {
  if (data.length < 2) return null;

  const min = Math.min(...data.map((d) => d.score));
  const max = Math.max(...data.map((d) => d.score));
  const range = max - min || 1;
  const height = 40;
  const width = Math.max(100, data.length * 4);

  // Normalize scores to 0-1 range
  const normalized = data.map((d) => (d.score - min) / range);

  // Create SVG path
  const points = normalized
    .map((y, i) => `${(i / (data.length - 1)) * width},${height - y * height}`)
    .join(" L ");

  const color = data[data.length - 1].score > 60 ? "#ef4444" : data[data.length - 1].score > 40 ? "#f59e0b" : "#10b981";

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {/* Fill area */}
      <path
        d={`M 0,${height} L ${points} L ${width},${height} Z`}
        fill={color}
        opacity={0.1}
      />
      {/* Line */}
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {/* Data points */}
      {normalized.map((y, i) => (
        <circle
          key={i}
          cx={(i / (data.length - 1)) * width}
          cy={height - y * height}
          r={2}
          fill={color}
          opacity={0.6}
        />
      ))}
    </svg>
  );
}
