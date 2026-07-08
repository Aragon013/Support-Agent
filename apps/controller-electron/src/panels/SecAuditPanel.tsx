import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  ShieldAlert,
  Network,
  Laptop,
  Server,
  CheckCircle2,
  Circle,
  Clock3,
  Filter,
  Download,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { apiUrl } from "@/lib/backend-url";

type RunState = "idle" | "creating" | "running" | "polling" | "done" | "error";

type PlanModuleResult = {
  moduleId: string;
  origin: AuditOrigin;
  status: "pending" | "running" | "completed" | "failed" | "client_required";
  commandJobId?: string;
  findings?: Record<string, unknown>;
  evidence?: string[];
  error?: string;
  updatedAt: string;
};

type PlanRunResponse = {
  id: string;
  status: string;
  modules: PlanModuleResult[];
};

type PlanResultsResponse = {
  id: string;
  status: string;
  score?: number;
  severityBuckets?: { critical: number; high: number; medium: number; low: number; info: number };
  summary: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    clientRequired: number;
  };
  modules: PlanModuleResult[];
};

type AuditComparison = {
  current: { id: string; score: number | undefined; buckets?: { critical: number; high: number; medium: number; low: number; info: number } };
  baseline: { id: string; score: number | undefined; buckets?: { critical: number; high: number; medium: number; low: number; info: number } } | null;
  scoreDelta: number | null;
  severityDelta: { critical: number; high: number; medium: number; low: number; info: number };
  percentageImprovement: number | null;
};

type AuditRemediation = {
  moduleId: string;
  title: string;
  priority: Exclude<Severity, "info">;
  actions: string[];
  tracking?: {
    status: "open" | "accepted" | "closed";
    notes?: string;
    updatedAt?: string;
  };
};

type AuditReport = {
  id: string;
  executive: { score: number | null; summary: string };
  remediations: AuditRemediation[];
};

type AuditOrigin = "host" | "host_network" | "client_network";
type OSType = "windows" | "linux" | "macos" | "all";
type AuditLevel = "safe" | "safe_light" | "deep";
type Severity = "critical" | "high" | "medium" | "low" | "info";
type PackageId = "quick" | "standard" | "deep" | "incident" | "compliance" | "custom";

type AuditModule = {
  id: string;
  name: string;
  description: string;
  category: "host_baseline" | "identity_access" | "app_surface" | "network" | "threat_hunt" | "incident_response" | "resilience" | "compliance";
  origins: AuditOrigin[];
  os: OSType[];
  estimatedMin: number;
  level: AuditLevel;
  defaultSeverity: Severity;
};

type AuditPackage = {
  id: PackageId;
  label: string;
  description: string;
  estimatedRange: string;
  includes: string[]; // module ids
};

const ORIGIN_LABEL: Record<AuditOrigin, string> = {
  host: "Host Audit",
  host_network: "Host Network",
  client_network: "Client Network",
};

const LEVEL_LABEL: Record<AuditLevel, string> = {
  safe: "Safe",
  safe_light: "Safe + Light",
  deep: "Deep",
};

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "border-danger/40 bg-danger/10 text-danger",
  high: "border-danger/30 bg-danger/10 text-danger",
  medium: "border-warn/30 bg-warn/10 text-warn",
  low: "border-brand/30 bg-brand/10 text-brand",
  info: "border-slate-700 bg-surface-900 text-slate-300",
};

const MODULES: AuditModule[] = [
  {
    id: "host.os-posture",
    name: "OS Posture Baseline",
    description: "Version, build, EOL risk, patch posture and encryption state.",
    category: "host_baseline",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 3,
    level: "safe",
    defaultSeverity: "high",
  },
  {
    id: "host.firewall-edr",
    name: "Firewall + EDR Posture",
    description: "Firewall profile status, AV/EDR health and tamper indicators.",
    category: "host_baseline",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 2,
    level: "safe",
    defaultSeverity: "high",
  },
  {
    id: "host.identity-admins",
    name: "Identity & Local Admin Audit",
    description: "Local admins, dormant users, elevated sessions and policy weakness.",
    category: "identity_access",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 4,
    level: "safe",
    defaultSeverity: "high",
  },
  {
    id: "identity.mfa-posture",
    name: "MFA Posture Audit",
    description: "Coverage and enforcement review for privileged, remote and break-glass access.",
    category: "identity_access",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 5,
    level: "safe_light",
    defaultSeverity: "high",
  },
  {
    id: "identity.secrets-exposure",
    name: "Secrets Exposure Audit",
    description: "Checks for unsafe token storage, plaintext secrets and reusable local credentials.",
    category: "identity_access",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 8,
    level: "deep",
    defaultSeverity: "critical",
  },
  {
    id: "host.surface-ports",
    name: "Exposure Surface Audit",
    description: "Open listeners, risky services, startup persistence and app inventory.",
    category: "app_surface",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 6,
    level: "safe_light",
    defaultSeverity: "medium",
  },
  {
    id: "app.supply-chain",
    name: "Software Supply Chain Audit",
    description: "Publisher trust, SBOM readiness, package hygiene and update channel integrity.",
    category: "app_surface",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 11,
    level: "deep",
    defaultSeverity: "high",
  },
  {
    id: "net.host-segment",
    name: "Network Audit from Host",
    description: "DNS/gateway/routes, LAN exposure and critical protocol posture.",
    category: "network",
    origins: ["host_network"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 8,
    level: "safe_light",
    defaultSeverity: "medium",
  },
  {
    id: "net.remote-access",
    name: "Remote Access Surface Audit",
    description: "VPN, RDP, SSH and remote tooling exposure with hardening and access control checks.",
    category: "network",
    origins: ["host_network"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 7,
    level: "safe_light",
    defaultSeverity: "high",
  },
  {
    id: "net.client-health",
    name: "Client Network Health Audit",
    description: "Connectivity, DNS, route checks and service reachability from operator side.",
    category: "network",
    origins: ["client_network"],
    os: ["all"],
    estimatedMin: 5,
    level: "safe",
    defaultSeverity: "medium",
  },
  {
    id: "threat.hunt-lite",
    name: "Threat Hunt Lite",
    description: "Suspicious processes, known IOC patterns and outbound anomalies.",
    category: "threat_hunt",
    origins: ["host", "host_network"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 12,
    level: "deep",
    defaultSeverity: "critical",
  },
  {
    id: "resilience.ransomware",
    name: "Ransomware Resilience Audit",
    description: "Backup signals, restore posture, share exposure and credential protection.",
    category: "resilience",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 9,
    level: "safe_light",
    defaultSeverity: "high",
  },
  {
    id: "threat.hunt-deep",
    name: "Threat Hunt Deep",
    description: "Advanced behavioral analysis, process chains, memory indicators and persistence mechanisms.",
    category: "threat_hunt",
    origins: ["host", "host_network"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 20,
    level: "deep",
    defaultSeverity: "critical",
  },
  {
    id: "incident.response-readiness",
    name: "Incident Response Readiness",
    description: "Forensic artifact retention, logging posture, incident plan and playbook readiness.",
    category: "incident_response",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 8,
    level: "safe_light",
    defaultSeverity: "high",
  },
  {
    id: "compliance.hipaa",
    name: "HIPAA Compliance Audit",
    description: "PHI access controls, encryption, audit logging and breach notification readiness.",
    category: "compliance",
    origins: ["host", "host_network"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 15,
    level: "deep",
    defaultSeverity: "critical",
  },
  {
    id: "compliance.pci-dss",
    name: "PCI-DSS Compliance Audit",
    description: "Cardholder data protection, network segmentation, firewall rules and access controls.",
    category: "compliance",
    origins: ["host", "host_network"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 18,
    level: "deep",
    defaultSeverity: "critical",
  },
  {
    id: "compliance.soc2",
    name: "SOC2 Compliance Audit",
    description: "Security controls, availability, processing integrity, confidentiality and privacy.",
    category: "compliance",
    origins: ["host", "host_network"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 20,
    level: "deep",
    defaultSeverity: "critical",
  },
  {
    id: "resilience.backup",
    name: "Backup & Disaster Recovery",
    description: "Backup frequency, retention, restore testing and RTO/RPO alignment verification.",
    category: "resilience",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 10,
    level: "safe_light",
    defaultSeverity: "high",
  },
  {
    id: "host.code-integrity",
    name: "Code Integrity & Anti-Tampering",
    description: "Signed driver verification, kernel module integrity, code signing enforcement.",
    category: "host_baseline",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 7,
    level: "deep",
    defaultSeverity: "critical",
  },
  {
    id: "host.cloud-saas-posture",
    name: "Cloud / SaaS Admin Posture",
    description: "Reviews tenant-wide admin exposure, baseline guardrails and external SaaS security posture.",
    category: "host_baseline",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 9,
    level: "deep",
    defaultSeverity: "high",
  },
  {
    id: "host.lateral-movement",
    name: "Lateral Movement Prevention",
    description: "Segmentation, credential guard, constrained language mode and privilege model hardening.",
    category: "host_baseline",
    origins: ["host"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 6,
    level: "deep",
    defaultSeverity: "high",
  },
  {
    id: "compliance.cis",
    name: "CIS Baseline Audit",
    description: "Benchmark alignment review for hardened baseline controls and configuration drift.",
    category: "compliance",
    origins: ["host", "host_network"],
    os: ["windows", "linux", "macos"],
    estimatedMin: 14,
    level: "deep",
    defaultSeverity: "high",
  },
];

const PACKAGES: AuditPackage[] = [
  {
    id: "quick",
    label: "Quick Audit",
    description: "Fast posture check for immediate risk and triage.",
    estimatedRange: "5-10 min",
    includes: ["host.os-posture", "host.firewall-edr", "net.client-health"],
  },
  {
    id: "standard",
    label: "Standard Audit",
    description: "Balanced host + network coverage for daily operations.",
    estimatedRange: "20-35 min",
    includes: [
      "host.os-posture",
      "host.firewall-edr",
      "host.identity-admins",
      "identity.mfa-posture",
      "host.surface-ports",
      "net.host-segment",
      "net.client-health",
    ],
  },
  {
    id: "deep",
    label: "Deep Audit",
    description: "Extended analysis with deep checks and high-confidence evidence.",
    estimatedRange: "60-150 min",
    includes: [
      "host.os-posture",
      "host.firewall-edr",
      "host.identity-admins",
      "identity.mfa-posture",
      "identity.secrets-exposure",
      "host.surface-ports",
      "app.supply-chain",
      "host.code-integrity",
      "host.cloud-saas-posture",
      "host.lateral-movement",
      "net.host-segment",
      "net.remote-access",
      "net.client-health",
      "threat.hunt-lite",
      "threat.hunt-deep",
      "resilience.ransomware",
      "resilience.backup",
    ],
  },
  {
    id: "incident",
    label: "Incident Audit",
    description: "Incident-first checks for rapid containment and investigation.",
    estimatedRange: "15-35 min",
    includes: [
      "host.identity-admins",
      "identity.secrets-exposure",
      "host.surface-ports",
      "net.remote-access",
      "threat.hunt-lite",
      "threat.hunt-deep",
      "incident.response-readiness",
    ],
  },
  {
    id: "compliance",
    label: "Compliance Audit",
    description: "Policy-oriented baseline for control evidence collection.",
    estimatedRange: "30-60 min",
    includes: [
      "host.os-posture",
      "host.firewall-edr",
      "host.identity-admins",
      "identity.mfa-posture",
      "app.supply-chain",
      "host.code-integrity",
      "host.cloud-saas-posture",
      "resilience.ransomware",
      "resilience.backup",
      "compliance.cis",
      "compliance.hipaa",
      "compliance.pci-dss",
      "compliance.soc2",
    ],
  },
  {
    id: "custom",
    label: "Custom Audit",
    description: "Build your own audit by selecting modules and execution level.",
    estimatedRange: "Variable",
    includes: [],
  },
];

function categoryLabel(cat: AuditModule["category"]): string {
  switch (cat) {
    case "host_baseline":
      return "Host Baseline";
    case "identity_access":
      return "Identity & Access";
    case "app_surface":
      return "App & Surface";
    case "network":
      return "Network";
    case "threat_hunt":
      return "Threat Hunt";
    case "incident_response":
      return "Incident Response";
    case "resilience":
      return "Resilience";
    case "compliance":
      return "Compliance";
  }
}

export function SecAuditPanel() {
  const [selectedPackage, setSelectedPackage] = useState<PackageId>("quick");
  const [targetOs, setTargetOs] = useState<OSType>("windows");
  const [originFilter, setOriginFilter] = useState<AuditOrigin | "all">("all");
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set(PACKAGES.find((x) => x.id === "quick")?.includes ?? []));
  const [runState, setRunState] = useState<RunState>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [results, setResults] = useState<PlanModuleResult[]>([]);
  const [summary, setSummary] = useState<PlanResultsResponse["summary"] | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [severityBuckets, setSeverityBuckets] = useState<PlanResultsResponse["severityBuckets"] | null>(null);
  const [comparison, setComparison] = useState<AuditComparison | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);

  const packageMeta = useMemo(
    () => PACKAGES.find((p) => p.id === selectedPackage) ?? PACKAGES[0],
    [selectedPackage],
  );

  const activeModuleIds = useMemo(() => {
    if (selectedPackage === "custom") {
      return customSelected;
    }
    return new Set(packageMeta.includes);
  }, [selectedPackage, customSelected, packageMeta]);

  const visibleModules = useMemo(() => {
    return MODULES.filter((m) => {
      const osOk = m.os.includes("all") || targetOs === "all" || m.os.includes(targetOs);
      const originOk = originFilter === "all" || m.origins.includes(originFilter);
      return osOk && originOk;
    });
  }, [targetOs, originFilter]);

  const selectedModules = useMemo(
    () => MODULES.filter((m) => activeModuleIds.has(m.id)),
    [activeModuleIds],
  );

  const totalMinutes = useMemo(
    () => selectedModules.reduce((acc, m) => acc + m.estimatedMin, 0),
    [selectedModules],
  );

  const executionLevel = useMemo<AuditLevel>(() => {
    if (selectedModules.some((m) => m.level === "deep")) return "deep";
    if (selectedModules.some((m) => m.level === "safe_light")) return "safe_light";
    return "safe";
  }, [selectedModules]);

  const planJson = useMemo(
    () => JSON.stringify(
      {
        package: selectedPackage,
        targetOs,
        originFilter,
        executionLevel,
        modules: selectedModules.map((m) => m.id),
        estimatedMinutes: totalMinutes,
      },
      null,
      2,
    ),
    [selectedPackage, targetOs, originFilter, executionLevel, selectedModules, totalMinutes],
  );

  const toggleCustom = (id: string) => {
    setCustomSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitClientFindings = async (
    planId: string,
    moduleId: string,
    findings: Record<string, unknown>,
    evidence: string[],
  ) => {
    await fetch(apiUrl(`/api/v1/secaudit/plans/${planId}/client-findings`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        moduleId,
        findings,
        evidence,
      }),
    });
  };

  const runClientModules = async (planId: string, modules: PlanModuleResult[]) => {
    const clientModules = modules.filter((m) => m.origin === "client_network");
    for (const module of clientModules) {
      const runner = window.electronAPI?.runClientSecAudit;
      if (!runner) {
        await submitClientFindings(planId, module.moduleId, { status: "error", reason: "electron_api_unavailable" }, []);
        continue;
      }

      const response = await runner({ moduleId: module.moduleId });
      await submitClientFindings(
        planId,
        module.moduleId,
        {
          ...response.findings,
          ok: response.ok,
          error: response.error,
        },
        response.evidence,
      );
    }
  };

  const refreshResults = async (planId: string): Promise<PlanResultsResponse> => {
    const response = await fetch(apiUrl(`/api/v1/secaudit/plans/${planId}/results`));
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `results_http_${response.status}`);
    }
    const data = (await response.json()) as PlanResultsResponse;
    setResults(data.modules);
    setSummary(data.summary);
    setScore(data.score ?? null);
    setSeverityBuckets(data.severityBuckets ?? null);
    return data;
  };

  const downloadReport = async (format: "pdf" | "csv" = "pdf") => {
    if (!activePlanId) {
      setRunError("No active plan to export.");
      return;
    }
    try {
      const response = await fetch(apiUrl(`/api/v1/secaudit/plans/${activePlanId}/report/${format}`));
      if (!response.ok) {
        throw new Error(`report_http_${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `secaudit-report-${activePlanId}-${new Date().toISOString().split("T")[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : `Failed to download ${format.toUpperCase()} report`);
    }
  };

  const loadComparison = async (planId: string) => {
    try {
      const response = await fetch(apiUrl(`/api/v1/secaudit/plans/${planId}/compare`));
      if (!response.ok) return;
      const data = (await response.json()) as AuditComparison;
      setComparison(data);
    } catch {
      setComparison(null);
    }
  };

  const loadReport = async (planId: string) => {
    try {
      const response = await fetch(apiUrl(`/api/v1/secaudit/plans/${planId}/report`));
      if (!response.ok) return;
      const data = (await response.json()) as AuditReport;
      setReport(data);
    } catch {
      setReport(null);
    }
  };

  const updateRemediationStatus = async (moduleId: string, status: "open" | "accepted" | "closed") => {
    if (!activePlanId) return;
    try {
      const response = await fetch(apiUrl(`/api/v1/secaudit/plans/${activePlanId}/remediations/${moduleId}`), {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        throw new Error(`remediation_http_${response.status}`);
      }
      await loadReport(activePlanId);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Failed to update remediation status");
    }
  };

  const runAudit = async () => {
    if (selectedModules.length === 0) {
      setRunError("Select at least one module before running the audit.");
      return;
    }

    setRunError(null);
    setRunState("creating");

    try {
      setComparison(null);
      setReport(null);
      const createResponse = await fetch(apiUrl("/api/v1/secaudit/plans"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tenantId: "default",
          endpointId: "endpoint-dev-01",
          operatorId: "operator-ui",
          packageId: selectedPackage,
          targetOs,
          executionLevel,
          modules: selectedModules.map((m) => m.id),
        }),
      });

      if (!createResponse.ok) {
        const text = await createResponse.text();
        throw new Error(text || `create_http_${createResponse.status}`);
      }

      const plan = (await createResponse.json()) as { id: string };
      setActivePlanId(plan.id);

      setRunState("running");
      const runResponse = await fetch(apiUrl(`/api/v1/secaudit/plans/${plan.id}/run`), { method: "POST" });
      if (!runResponse.ok) {
        const text = await runResponse.text();
        throw new Error(text || `run_http_${runResponse.status}`);
      }

      const runData = (await runResponse.json()) as PlanRunResponse;
      setResults(runData.modules);

      await runClientModules(plan.id, runData.modules);

      setRunState("polling");
      const started = Date.now();
      const timeoutMs = 15000;

      while (Date.now() - started < timeoutMs) {
        const snapshot = await refreshResults(plan.id);
        if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "partial") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      }

      await refreshResults(plan.id);
      await loadComparison(plan.id);
      await loadReport(plan.id);
      setRunState("done");
    } catch (error) {
      setRunState("error");
      setRunError(error instanceof Error ? error.message : "Audit execution failed");
    }
  };

  return (
    <div className="flex flex-col gap-5 p-6 text-slate-900">
      <section className="tv-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
              <ShieldCheck className="h-3.5 w-3.5" />
              SecAudit
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Cybersecurity Audit Workspace</h2>
            <p className="mt-1 text-sm text-slate-600">Run host, host-network and client-network audits by package or custom plan.</p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs text-slate-700">
            <div className="flex items-center gap-2 font-semibold">
              <Clock3 className="h-3.5 w-3.5" />
              Est. runtime: {totalMinutes} min
            </div>
            <p className="mt-1">Execution level: {LEVEL_LABEL[executionLevel]}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">Target OS</span>
            <select
              value={targetOs}
              onChange={(e) => setTargetOs(e.target.value as OSType)}
              className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand"
            >
              <option value="windows">Windows</option>
              <option value="linux">Linux</option>
              <option value="macos">macOS</option>
              <option value="all">Any</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">Origin Scope</span>
            <select
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value as AuditOrigin | "all")}
              className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand"
            >
              <option value="all">All Origins</option>
              <option value="host">Host Audit</option>
              <option value="host_network">Host Network</option>
              <option value="client_network">Client Network</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-medium text-slate-600">Package</span>
            <select
              value={selectedPackage}
              onChange={(e) => {
                const next = e.target.value as PackageId;
                setSelectedPackage(next);
                if (next !== "custom") {
                  setCustomSelected(new Set(PACKAGES.find((p) => p.id === next)?.includes ?? []));
                }
              }}
              className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand"
            >
              {PACKAGES.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs text-slate-700">
          <p className="font-semibold">{packageMeta.label} · {packageMeta.estimatedRange}</p>
          <p className="mt-0.5">{packageMeta.description}</p>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <section className="tv-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Audit Modules</h3>
            <span className="rounded-full border border-blue-100 bg-white px-2.5 py-1 text-[11px] text-slate-600">
              <Filter className="mr-1 inline h-3.5 w-3.5" />
              {visibleModules.length} visible
            </span>
          </div>

          <div className="grid gap-2">
            <AnimatePresence initial={false}>
              {visibleModules.map((m) => {
                const isSelected = activeModuleIds.has(m.id);
                const canToggle = selectedPackage === "custom";
                return (
                  <motion.button
                    key={m.id}
                    layout
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    onClick={() => {
                      if (canToggle) toggleCustom(m.id);
                    }}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left shadow-sm transition",
                      isSelected ? "border-brand/40 bg-brand/10" : "border-blue-100 bg-white",
                      canToggle ? "cursor-pointer hover:border-brand/40" : "cursor-default",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{m.name}</p>
                        <p className="mt-0.5 text-xs text-slate-600">{m.description}</p>
                      </div>
                      {isSelected ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-slate-400" />}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                      <span className="rounded-full border border-blue-100 bg-white px-2 py-0.5 text-slate-600">{categoryLabel(m.category)}</span>
                      <span className="rounded-full border border-blue-100 bg-white px-2 py-0.5 text-slate-600">{m.estimatedMin} min</span>
                      <span className={cn("rounded-full border px-2 py-0.5", SEVERITY_STYLE[m.defaultSeverity])}>{m.defaultSeverity}</span>
                      {m.origins.map((o) => (
                        <span key={o} className="rounded-full border border-slate-700 bg-surface-900 px-2 py-0.5 text-slate-300">{ORIGIN_LABEL[o]}</span>
                      ))}
                    </div>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        </section>

        <section className="space-y-4">
          <div className="tv-panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Execution Plan</h3>
              <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] text-brand">{selectedModules.length} modules</span>
            </div>

            <div className="grid gap-2 text-sm">
              {selectedModules.length === 0 ? (
                <div className="rounded-lg border border-dashed border-blue-100 bg-blue-50/40 px-3 py-4 text-sm text-slate-500">
                  No module selected. Switch to Custom and choose modules.
                </div>
              ) : (
                selectedModules.map((m) => (
                  <div key={m.id} className="rounded-lg border border-blue-100 bg-white px-3 py-2">
                    <p className="font-medium text-slate-900">{m.name}</p>
                    <p className="text-xs text-slate-500">{m.id}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="tv-panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Run Profile</h3>
              <ShieldAlert className="h-4 w-4 text-warn" />
            </div>

            <div className="grid gap-2 text-xs text-slate-700">
              <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
                <p className="font-semibold">Package</p>
                <p>{packageMeta.label}</p>
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
                <p className="font-semibold">Execution</p>
                <p>{LEVEL_LABEL[executionLevel]} · {totalMinutes} min</p>
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2">
                <p className="font-semibold">Origins</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Array.from(new Set(selectedModules.flatMap((m) => m.origins))).map((o) => (
                    <span key={o} className="rounded-full border border-blue-100 bg-white px-2 py-0.5 text-[11px]">
                      {o === "host" ? <Server className="mr-1 inline h-3 w-3" /> : o === "host_network" ? <Network className="mr-1 inline h-3 w-3" /> : <Laptop className="mr-1 inline h-3 w-3" />}
                      {ORIGIN_LABEL[o]}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <details className="mt-3 rounded-lg border border-blue-100 bg-white p-2">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">Plan JSON (for backend runner mapping)</summary>
              <pre className="mt-2 max-h-52 overflow-auto rounded bg-slate-950 p-2 text-[11px] text-slate-200">{planJson}</pre>
            </details>

            <div className="mt-3 space-y-2">
              <button
                onClick={runAudit}
                disabled={runState === "creating" || runState === "running" || runState === "polling"}
                className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runState === "creating" ? "Creating Plan..." : runState === "running" ? "Dispatching Modules..." : runState === "polling" ? "Collecting Results..." : "Run Audit"}
              </button>
              {activePlanId ? <p className="text-[11px] text-slate-600">Plan: {activePlanId}</p> : null}
              {runError ? <p className="text-xs text-danger">{runError}</p> : null}
            </div>
          </div>

          <div className="tv-panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Execution Results</h3>
              <span className="rounded-full border border-blue-100 bg-white px-2 py-0.5 text-[11px] text-slate-600">{runState}</span>
            </div>
            {summary ? (
              <div className="mb-4">
                <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] text-slate-700">
                  <div className="rounded border border-blue-100 bg-blue-50/60 px-2 py-1">Total: {summary.total}</div>
                  <div className="rounded border border-blue-100 bg-blue-50/60 px-2 py-1">Completed: {summary.completed}</div>
                  <div className="rounded border border-blue-100 bg-blue-50/60 px-2 py-1">Failed: {summary.failed}</div>
                  <div className="rounded border border-blue-100 bg-blue-50/60 px-2 py-1">Pending: {summary.running + summary.clientRequired}</div>
                </div>
                {score !== null && severityBuckets && (
                  <div className="rounded-lg border border-brand/30 bg-brand/10 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-900">Security Score</p>
                      <p className={cn(
                        "text-lg font-bold rounded-full px-3 py-1",
                        score >= 80 ? "bg-success/20 text-success" : score >= 60 ? "bg-warn/20 text-warn" : "bg-danger/20 text-danger"
                      )}>
                        {score}
                      </p>
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-[10px]">
                      {severityBuckets.critical > 0 && <div className="rounded bg-danger/20 px-2 py-1 text-center text-danger font-semibold">🔴 {severityBuckets.critical}</div>}
                      {severityBuckets.high > 0 && <div className="rounded bg-danger/20 px-2 py-1 text-center text-danger font-semibold">🟠 {severityBuckets.high}</div>}
                      {severityBuckets.medium > 0 && <div className="rounded bg-warn/20 px-2 py-1 text-center text-warn font-semibold">🟡 {severityBuckets.medium}</div>}
                      {severityBuckets.low > 0 && <div className="rounded bg-brand/20 px-2 py-1 text-center text-brand font-semibold">🔵 {severityBuckets.low}</div>}
                      {severityBuckets.info > 0 && <div className="rounded bg-slate-200 px-2 py-1 text-center text-slate-600 font-semibold">ⓘ {severityBuckets.info}</div>}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {comparison && comparison.baseline && (
              <div className="mb-3 rounded-lg border border-info/30 bg-info/10 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-900">Baseline Comparison</p>
                  {comparison.scoreDelta !== null && (
                    <div className="flex items-center gap-1">
                      {comparison.scoreDelta > 0 ? (
                        <TrendingUp className="h-4 w-4 text-success" />
                      ) : comparison.scoreDelta < 0 ? (
                        <TrendingDown className="h-4 w-4 text-danger" />
                      ) : null}
                      <span className={cn(
                        "text-sm font-semibold rounded px-2 py-1",
                        comparison.scoreDelta > 0 ? "bg-success/20 text-success" : comparison.scoreDelta < 0 ? "bg-danger/20 text-danger" : "bg-slate-200 text-slate-600"
                      )}>
                        {comparison.scoreDelta > 0 ? "+" : ""}{comparison.scoreDelta} · {comparison.percentageImprovement}%
                      </span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  {comparison.severityDelta.critical !== 0 && (
                    <div className={cn("rounded px-2 py-1", comparison.severityDelta.critical > 0 ? "bg-danger/20 text-danger" : "bg-success/20 text-success")}>
                      🔴 {comparison.severityDelta.critical > 0 ? "+" : ""}{comparison.severityDelta.critical}
                    </div>
                  )}
                  {comparison.severityDelta.high !== 0 && (
                    <div className={cn("rounded px-2 py-1", comparison.severityDelta.high > 0 ? "bg-danger/20 text-danger" : "bg-success/20 text-success")}>
                      🟠 {comparison.severityDelta.high > 0 ? "+" : ""}{comparison.severityDelta.high}
                    </div>
                  )}
                  {comparison.severityDelta.medium !== 0 && (
                    <div className={cn("rounded px-2 py-1", comparison.severityDelta.medium > 0 ? "bg-warn/20 text-warn" : "bg-success/20 text-success")}>
                      🟡 {comparison.severityDelta.medium > 0 ? "+" : ""}{comparison.severityDelta.medium}
                    </div>
                  )}
                  {comparison.severityDelta.low !== 0 && (
                    <div className={cn("rounded px-2 py-1", comparison.severityDelta.low > 0 ? "bg-brand/20 text-brand" : "bg-success/20 text-success")}>
                      🔵 {comparison.severityDelta.low > 0 ? "+" : ""}{comparison.severityDelta.low}
                    </div>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-600">vs {comparison.baseline.id}</p>
              </div>
            )}

            {activePlanId && runState === "done" && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => downloadReport("pdf")}
                  className="rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-sm font-semibold text-brand transition hover:bg-brand/20"
                >
                  <Download className="mr-1.5 inline h-4 w-4" />
                  PDF
                </button>
                <button
                  onClick={() => downloadReport("csv")}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <Download className="mr-1.5 inline h-4 w-4" />
                  CSV
                </button>
              </div>
            )}

            {report?.remediations?.length ? (
              <div className="mb-3 rounded-lg border border-danger/20 bg-danger/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-900">Recommended Remediations</p>
                  <span className="rounded-full border border-danger/20 bg-white px-2 py-0.5 text-[10px] text-slate-600">
                    {report.remediations.length} items
                  </span>
                </div>
                <div className="space-y-2">
                  {report.remediations.slice(0, 4).map((item) => (
                    <div key={item.moduleId} className="rounded-lg border border-white/70 bg-white px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{item.title}</p>
                          <p className="text-[11px] text-slate-500">{item.moduleId}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", SEVERITY_STYLE[item.priority])}>
                            {item.priority}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                            {item.tracking?.status ?? "open"}
                          </span>
                        </div>
                      </div>
                      <ul className="mt-2 space-y-1 text-[11px] text-slate-700">
                        {item.actions.slice(0, 3).map((action) => (
                          <li key={action}>- {action}</li>
                        ))}
                      </ul>
                      <div className="mt-2 flex gap-1.5 text-[10px]">
                        <button
                          onClick={() => updateRemediationStatus(item.moduleId, "accepted")}
                          className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-warn"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => updateRemediationStatus(item.moduleId, "closed")}
                          className="rounded border border-success/30 bg-success/10 px-2 py-1 text-success"
                        >
                          Close
                        </button>
                        <button
                          onClick={() => updateRemediationStatus(item.moduleId, "open")}
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600"
                        >
                          Reopen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="max-h-56 space-y-2 overflow-auto">
              {results.length === 0 ? (
                <p className="text-xs text-slate-500">Run an audit to populate module outcomes.</p>
              ) : (
                results.map((result) => (
                  <div key={result.moduleId} className="rounded-lg border border-blue-100 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-900">{result.moduleId}</p>
                      <span className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        result.status === "completed"
                          ? "border-success/30 bg-success/10 text-success"
                          : result.status === "failed"
                            ? "border-danger/30 bg-danger/10 text-danger"
                            : "border-warn/30 bg-warn/10 text-warn",
                      )}>
                        {result.status}
                      </span>
                    </div>
                    {result.error ? <p className="mt-1 text-[11px] text-danger">{result.error}</p> : null}
                    {result.evidence?.length ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-slate-600">{result.evidence.join(" · ")}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
