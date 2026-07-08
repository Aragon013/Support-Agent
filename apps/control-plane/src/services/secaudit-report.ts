import type { SecAuditPlanRecord, Severity } from "../domain/secaudit-plan-store.js";

export type SecAuditRemediation = {
  moduleId: string;
  title: string;
  priority: Exclude<Severity, "info">;
  actions: string[];
};

export type SecAuditReport = {
  id: string;
  tenantId: string;
  endpointId: string;
  operatorId: string;
  packageId: string;
  targetOs: SecAuditPlanRecord["targetOs"];
  executionLevel: SecAuditPlanRecord["executionLevel"];
  status: SecAuditPlanRecord["status"];
  createdAt: string;
  updatedAt: string;
  executive: {
    score: number | null;
    severities: { critical: number; high: number; medium: number; low: number; info: number };
    completion: {
      total: number;
      completed: number;
      failed: number;
      pending: number;
      percentComplete: number;
    };
    summary: string;
  };
  remediations: SecAuditRemediation[];
  modules: Array<{
    id: string;
    origin: SecAuditPlanRecord["results"][number]["origin"];
    status: SecAuditPlanRecord["results"][number]["status"];
    findings: Record<string, unknown> | null;
    evidence: string[];
    error: string | null;
    updatedAt: string;
  }>;
};

function severityRank(priority: Exclude<Severity, "info">): number {
  switch (priority) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
  }
}

function remediationTemplate(moduleId: string): { title: string; actions: string[] } {
  switch (moduleId) {
    case "host.firewall-edr":
      return {
        title: "Reinforce firewall and endpoint protection posture",
        actions: [
          "Confirm all required firewall profiles are enabled and centrally managed.",
          "Verify AV/EDR health, update channels and tamper protection are active.",
          "Document any intentional profile exceptions with owner and expiry.",
        ],
      };
    case "host.identity-admins":
      return {
        title: "Reduce standing privileged access",
        actions: [
          "Review local administrators and remove stale or unnecessary privileged accounts.",
          "Convert persistent admin access to just-in-time or approval-based elevation.",
          "Audit dormant users and enforce password rotation for retained break-glass accounts.",
        ],
      };
    case "identity.mfa-posture":
      return {
        title: "Close MFA coverage gaps",
        actions: [
          "Require MFA for privileged, remote and administrative access paths.",
          "Audit exclusions and legacy auth flows that bypass MFA enforcement.",
          "Test emergency access accounts to ensure strong second factors are still applied.",
        ],
      };
    case "identity.secrets-exposure":
      return {
        title: "Eliminate exposed secrets and reusable credentials",
        actions: [
          "Rotate any plaintext or reused local credentials discovered by the audit.",
          "Move tokens and application secrets into managed secret storage.",
          "Scan startup scripts, config files and user profiles for residual credentials.",
        ],
      };
    case "host.surface-ports":
      return {
        title: "Reduce exposed attack surface",
        actions: [
          "Disable unused listeners and risky startup services.",
          "Restrict network exposure for required services to approved scopes only.",
          "Reconcile installed software with the approved application inventory.",
        ],
      };
    case "app.supply-chain":
      return {
        title: "Harden software supply chain controls",
        actions: [
          "Verify publisher trust and signing for business-critical software.",
          "Establish SBOM or package inventory coverage for high-risk applications.",
          "Review update channels and pin or block untrusted package sources.",
        ],
      };
    case "host.code-integrity":
      return {
        title: "Restore code integrity enforcement",
        actions: [
          "Investigate unsigned or weakly trusted drivers and remove exceptions where possible.",
          "Enable or verify kernel and code-signing enforcement policies.",
          "Review recent driver or kernel component changes for unapproved installs.",
        ],
      };
    case "host.cloud-saas-posture":
      return {
        title: "Tighten cloud and SaaS admin guardrails",
        actions: [
          "Review tenant-wide admin assignments and remove persistent over-privileged roles.",
          "Enable baseline alerting, logging and external sharing controls for managed platforms.",
          "Capture owner-approved exceptions for third-party SaaS integrations.",
        ],
      };
    case "host.lateral-movement":
      return {
        title: "Strengthen lateral movement controls",
        actions: [
          "Verify credential guard or equivalent isolation controls on supported endpoints.",
          "Reduce admin token reuse across tiers and enforce segmentation between critical assets.",
          "Restrict remote administration tooling to approved operators and jump paths.",
        ],
      };
    case "net.host-segment":
      return {
        title: "Correct network segmentation drift",
        actions: [
          "Review route, gateway and DNS exposure against expected network design.",
          "Limit access to management ports from untrusted or flat LAN segments.",
          "Validate firewall segmentation rules for critical protocols and peer groups.",
        ],
      };
    case "net.remote-access":
      return {
        title: "Harden remote access entry points",
        actions: [
          "Restrict exposed RDP, SSH or VPN services to approved sources and identities.",
          "Require MFA and session logging for all remote access workflows.",
          "Disable legacy or unused remote access paths and document approved alternatives.",
        ],
      };
    case "threat.hunt-lite":
    case "threat.hunt-deep":
      return {
        title: "Triage suspicious execution signals",
        actions: [
          "Review suspicious process, persistence and outbound indicators collected by the audit.",
          "Isolate the endpoint if indicators cannot be explained by approved tooling.",
          "Preserve volatile evidence and open incident handling if malicious activity is suspected.",
        ],
      };
    case "incident.response-readiness":
      return {
        title: "Improve incident response readiness",
        actions: [
          "Confirm logs, artifacts and retention windows support forensic reconstruction.",
          "Validate escalation paths, owners and decision criteria in the IR playbook.",
          "Run a tabletop for the gaps identified by the readiness review.",
        ],
      };
    case "resilience.ransomware":
      return {
        title: "Raise ransomware resilience",
        actions: [
          "Verify privileged credentials cannot directly access backup repositories.",
          "Reduce writable share exposure and validate recovery isolation steps.",
          "Run a restore test for the most critical business systems.",
        ],
      };
    case "resilience.backup":
      return {
        title: "Stabilize backup and recovery posture",
        actions: [
          "Confirm backup success, retention and restore testing meet business objectives.",
          "Escalate any unprotected workloads or restore failures to service owners.",
          "Document RTO/RPO exceptions and remediation owners.",
        ],
      };
    case "compliance.hipaa":
      return {
        title: "Close HIPAA control gaps",
        actions: [
          "Review PHI access controls, encryption coverage and audit logging requirements.",
          "Validate breach notification readiness and owner accountability for PHI systems.",
          "Collect evidence for any compensating controls used in regulated workflows.",
        ],
      };
    case "compliance.pci-dss":
      return {
        title: "Address PCI-DSS baseline deviations",
        actions: [
          "Confirm cardholder data environments are segmented and access is minimized.",
          "Review firewall rule sets, logging and administrative access controls for PCI scope.",
          "Document any compensating controls and remediation deadlines for open gaps.",
        ],
      };
    case "compliance.soc2":
      return {
        title: "Resolve SOC 2 control evidence gaps",
        actions: [
          "Map missing evidence to the responsible control owner and collection source.",
          "Validate logging, change control and access review evidence for the audit window.",
          "Track unresolved exceptions in the control register with target completion dates.",
        ],
      };
    case "compliance.cis":
      return {
        title: "Align endpoint to CIS benchmark baseline",
        actions: [
          "Review configuration drift against the approved hardened baseline.",
          "Apply missing benchmark controls in the standard image or policy layer.",
          "Record accepted deviations with risk approval and expiry.",
        ],
      };
    default:
      return {
        title: `Review findings for ${moduleId}`,
        actions: [
          "Validate the finding with system owner context and supporting evidence.",
          "Apply the minimum change needed to reduce exposure without breaking operations.",
          "Re-run the audit module after remediation to confirm closure.",
        ],
      };
  }
}

export function buildSecAuditRemediations(plan: SecAuditPlanRecord): SecAuditRemediation[] {
  return plan.results
    .filter((result) => result.status === "completed")
    .map((result) => {
      const severity = String((result.findings as Record<string, unknown> | undefined)?.severity ?? "low");
      if (severity === "info") return null;
      const priority = (["critical", "high", "medium", "low"] as const).includes(severity as Exclude<Severity, "info">)
        ? severity as Exclude<Severity, "info">
        : "low";
      const template = remediationTemplate(result.moduleId);
      return {
        moduleId: result.moduleId,
        title: template.title,
        priority,
        actions: template.actions,
      };
    })
    .filter((item): item is SecAuditRemediation => item !== null)
    .sort((left, right) => severityRank(left.priority) - severityRank(right.priority));
}

export function buildSecAuditReport(plan: SecAuditPlanRecord): SecAuditReport {
  const completedModules = plan.results.filter((x) => x.status === "completed");
  const failedModules = plan.results.filter((x) => x.status === "failed");
  const pendingModules = plan.results.filter((x) => x.status === "pending" || x.status === "running" || x.status === "client_required");

  return {
    id: plan.id,
    tenantId: plan.tenantId,
    endpointId: plan.endpointId,
    operatorId: plan.operatorId,
    packageId: plan.packageId,
    targetOs: plan.targetOs,
    executionLevel: plan.executionLevel,
    status: plan.status,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    executive: {
      score: plan.score ?? null,
      severities: plan.severityBuckets ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      completion: {
        total: plan.results.length,
        completed: completedModules.length,
        failed: failedModules.length,
        pending: pendingModules.length,
        percentComplete: plan.results.length > 0 ? Math.round((completedModules.length / plan.results.length) * 100) : 0,
      },
      summary: completedModules.length > 0
        ? `Audit completed with ${plan.score} security score. ${plan.severityBuckets?.critical ?? 0} critical, ${plan.severityBuckets?.high ?? 0} high severity findings.`
        : failedModules.length > 0
          ? `Audit partially completed. ${failedModules.length} module(s) failed.`
          : "Audit in progress or awaiting client results.",
    },
    remediations: buildSecAuditRemediations(plan),
    modules: plan.results.map((result) => ({
      id: result.moduleId,
      origin: result.origin,
      status: result.status,
      findings: result.findings ?? null,
      evidence: result.evidence ?? [],
      error: result.error ?? null,
      updatedAt: result.updatedAt,
    })),
  };
}

function csvEsc(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function generateSecAuditCSV(report: SecAuditReport): string {
  const rows: string[][] = [];

  // Metadata block
  rows.push(["Plan ID", report.id]);
  rows.push(["Tenant", report.tenantId]);
  rows.push(["Endpoint", report.endpointId]);
  rows.push(["Package", report.packageId]);
  rows.push(["OS", report.targetOs]);
  rows.push(["Status", report.status]);
  rows.push(["Score", String(report.executive.score ?? "N/A")]);
  rows.push(["Critical", String(report.executive.severities.critical)]);
  rows.push(["High", String(report.executive.severities.high)]);
  rows.push(["Medium", String(report.executive.severities.medium)]);
  rows.push(["Low", String(report.executive.severities.low)]);
  rows.push(["Summary", report.executive.summary]);
  rows.push([]);

  // Modules section
  rows.push(["--- MODULES ---"]);
  rows.push(["Module ID", "Origin", "Status", "Severity", "Evidence Count", "Error"]);
  for (const mod of report.modules) {
    const severity = String((mod.findings as Record<string, unknown> | null)?.severity ?? "");
    rows.push([mod.id, mod.origin, mod.status, severity, String(mod.evidence.length), mod.error ?? ""]);
  }
  rows.push([]);

  // Remediations section
  if (report.remediations.length > 0) {
    rows.push(["--- REMEDIATIONS ---"]);
    rows.push(["Module ID", "Priority", "Title", "Actions"]);
    for (const rem of report.remediations) {
      rows.push([rem.moduleId, rem.priority, rem.title, rem.actions.join(" | ")]);
    }
  }

  return rows.map((row) => row.map((cell) => csvEsc(cell)).join(",")).join("\r\n");
}