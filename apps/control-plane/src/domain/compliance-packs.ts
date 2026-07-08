/**
 * Compliance packs domain — CIS, NIST CSF, ISO 27001, SOC2, PCI-DSS.
 * Maps SecAudit module findings to framework controls and derives a control score.
 */

export type ControlStatus = "passed" | "failed" | "partial" | "not_applicable" | "not_evaluated";

export type ComplianceControl = {
  id: string;
  name: string;
  description: string;
  moduleIds: string[];
};

export type CompliancePack = {
  id: string;
  name: string;
  shortName: string;
  version: string;
  controls: ComplianceControl[];
};

export type ControlResult = {
  controlId: string;
  name: string;
  status: ControlStatus;
  score: number;
  modulesCovered: string[];
  evidence: string[];
};

export type ComplianceReport = {
  packId: string;
  packName: string;
  generatedAt: string;
  overallScore: number;
  controlsPassed: number;
  controlsFailed: number;
  controlsPartial: number;
  controlsNotApplicable: number;
  controlsNotEvaluated: number;
  controls: ControlResult[];
};

const CIS: CompliancePack = {
  id: "cis",
  name: "CIS Controls",
  shortName: "CIS",
  version: "v8",
  controls: [
    {
      id: "cis.1",
      name: "Inventory and Control of Enterprise Assets",
      description: "Actively manage all enterprise assets to enable accurate asset tracking.",
      moduleIds: ["host.os-posture", "host.surface-ports"],
    },
    {
      id: "cis.2",
      name: "Inventory and Control of Software Assets",
      description: "Actively manage all software on the network to minimize attack surface.",
      moduleIds: ["app.supply-chain", "host.surface-ports"],
    },
    {
      id: "cis.3",
      name: "Data Protection",
      description: "Develop processes to identify, classify and securely handle data.",
      moduleIds: ["host.os-posture", "identity.secrets-exposure"],
    },
    {
      id: "cis.4",
      name: "Secure Configuration",
      description: "Establish and maintain secure configurations for assets and software.",
      moduleIds: ["host.os-posture", "host.firewall-edr", "compliance.cis"],
    },
    {
      id: "cis.5",
      name: "Account Management",
      description: "Use processes and tools to assign and manage authorization to credentials.",
      moduleIds: ["host.identity-admins", "identity.mfa-posture"],
    },
    {
      id: "cis.6",
      name: "Access Control Management",
      description: "Use processes and tools to create, assign, and revoke access credentials.",
      moduleIds: ["host.identity-admins", "identity.mfa-posture", "host.lateral-movement"],
    },
    {
      id: "cis.7",
      name: "Continuous Vulnerability Management",
      description: "Develop and maintain a plan to continuously assess and track vulnerabilities.",
      moduleIds: ["host.os-posture", "app.supply-chain"],
    },
    {
      id: "cis.8",
      name: "Audit Log Management",
      description: "Collect, alert, review, and retain audit logs.",
      moduleIds: ["compliance.cis", "incident.response-readiness"],
    },
    {
      id: "cis.9",
      name: "Email and Web Browser Protections",
      description: "Improve protections for emails and web browsers.",
      moduleIds: ["host.surface-ports", "host.firewall-edr"],
    },
    {
      id: "cis.10",
      name: "Malware Defenses",
      description: "Prevent or control the installation, spread, and execution of malicious code.",
      moduleIds: ["host.firewall-edr", "threat.hunt-lite"],
    },
    {
      id: "cis.12",
      name: "Network Infrastructure Management",
      description: "Establish, implement, and actively manage network devices.",
      moduleIds: ["net.host-segment", "net.remote-access"],
    },
    {
      id: "cis.13",
      name: "Network Monitoring and Defense",
      description: "Operate processes to detect and defend against network-based attacks.",
      moduleIds: ["net.host-segment", "net.remote-access", "threat.hunt-lite"],
    },
    {
      id: "cis.16",
      name: "Application Software Security",
      description: "Manage the security life cycle of in-house developed and third-party software.",
      moduleIds: ["app.supply-chain", "host.code-integrity"],
    },
    {
      id: "cis.17",
      name: "Incident Response Management",
      description: "Establish a program to develop and maintain an incident response capability.",
      moduleIds: ["incident.response-readiness"],
    },
  ],
};

const NIST: CompliancePack = {
  id: "nist-csf",
  name: "NIST Cybersecurity Framework",
  shortName: "NIST CSF",
  version: "2.0",
  controls: [
    {
      id: "nist.id.am",
      name: "ID.AM — Asset Management",
      description: "Assets are identified and managed consistent with their business importance.",
      moduleIds: ["host.os-posture", "host.surface-ports", "app.supply-chain"],
    },
    {
      id: "nist.id.ra",
      name: "ID.RA — Risk Assessment",
      description: "The organization understands the cybersecurity risk to operations.",
      moduleIds: ["host.os-posture", "threat.hunt-lite", "compliance.cis"],
    },
    {
      id: "nist.pr.ac",
      name: "PR.AC — Identity and Access",
      description: "Access to assets is limited to authorized users and processes.",
      moduleIds: ["host.identity-admins", "identity.mfa-posture", "host.lateral-movement"],
    },
    {
      id: "nist.pr.ds",
      name: "PR.DS — Data Security",
      description: "Information and records are managed consistent with the organization's risk strategy.",
      moduleIds: ["identity.secrets-exposure", "host.os-posture", "resilience.ransomware"],
    },
    {
      id: "nist.pr.ip",
      name: "PR.IP — Information Protection",
      description: "Security policies, processes, and procedures are maintained.",
      moduleIds: ["host.firewall-edr", "host.code-integrity", "compliance.cis"],
    },
    {
      id: "nist.pr.ma",
      name: "PR.MA — Maintenance",
      description: "Maintenance and repairs of organizational assets are performed.",
      moduleIds: ["host.os-posture", "app.supply-chain"],
    },
    {
      id: "nist.pr.pt",
      name: "PR.PT — Protective Technology",
      description: "Technical security solutions are managed to ensure security of systems.",
      moduleIds: ["host.firewall-edr", "net.remote-access", "host.lateral-movement"],
    },
    {
      id: "nist.de.ae",
      name: "DE.AE — Anomalies and Events",
      description: "Anomalous activity is detected in a timely manner.",
      moduleIds: ["threat.hunt-lite", "threat.hunt-deep"],
    },
    {
      id: "nist.de.cm",
      name: "DE.CM — Continuous Monitoring",
      description: "Assets are monitored at discrete intervals to detect events.",
      moduleIds: ["net.host-segment", "host.surface-ports", "threat.hunt-lite"],
    },
    {
      id: "nist.rs.rp",
      name: "RS.RP — Response Planning",
      description: "Response processes and procedures are executed and maintained.",
      moduleIds: ["incident.response-readiness"],
    },
    {
      id: "nist.rc.rp",
      name: "RC.RP — Recovery Planning",
      description: "Recovery processes are executed and maintained to ensure restoration.",
      moduleIds: ["resilience.backup", "resilience.ransomware"],
    },
  ],
};

const ISO27001: CompliancePack = {
  id: "iso-27001",
  name: "ISO/IEC 27001",
  shortName: "ISO 27001",
  version: "2022",
  controls: [
    {
      id: "iso.a5.1",
      name: "A.5.1 — Policies for information security",
      description: "Information security policy approved by management.",
      moduleIds: ["compliance.cis"],
    },
    {
      id: "iso.a5.15",
      name: "A.5.15 — Access control",
      description: "Rules to control logical and physical access.",
      moduleIds: ["host.identity-admins", "identity.mfa-posture", "host.lateral-movement"],
    },
    {
      id: "iso.a5.16",
      name: "A.5.16 — Identity management",
      description: "Full life cycle of digital identities is managed.",
      moduleIds: ["host.identity-admins", "identity.mfa-posture"],
    },
    {
      id: "iso.a5.17",
      name: "A.5.17 — Authentication information",
      description: "Allocation and management of authentication information is controlled.",
      moduleIds: ["identity.secrets-exposure", "identity.mfa-posture"],
    },
    {
      id: "iso.a8.1",
      name: "A.8.1 — User endpoint devices",
      description: "Information stored on, processed by, or accessible via user endpoint devices is protected.",
      moduleIds: ["host.os-posture", "host.firewall-edr"],
    },
    {
      id: "iso.a8.7",
      name: "A.8.7 — Protection against malware",
      description: "Protection against malware is implemented and supported by user awareness.",
      moduleIds: ["host.firewall-edr", "threat.hunt-lite"],
    },
    {
      id: "iso.a8.8",
      name: "A.8.8 — Management of technical vulnerabilities",
      description: "Technical vulnerabilities are identified and remediated.",
      moduleIds: ["host.os-posture", "app.supply-chain", "host.code-integrity"],
    },
    {
      id: "iso.a8.12",
      name: "A.8.12 — Data leakage prevention",
      description: "Measures applied to prevent data leakage.",
      moduleIds: ["identity.secrets-exposure", "host.surface-ports"],
    },
    {
      id: "iso.a8.15",
      name: "A.8.15 — Logging",
      description: "Logs that record activities, exceptions and events are produced, stored and protected.",
      moduleIds: ["incident.response-readiness", "compliance.cis"],
    },
    {
      id: "iso.a8.16",
      name: "A.8.16 — Monitoring activities",
      description: "Networks, systems and applications are monitored for anomalous behavior.",
      moduleIds: ["threat.hunt-lite", "net.host-segment"],
    },
    {
      id: "iso.a8.24",
      name: "A.8.24 — Use of cryptography",
      description: "Rules for effective use of cryptography are defined and implemented.",
      moduleIds: ["host.os-posture", "identity.secrets-exposure"],
    },
    {
      id: "iso.a8.32",
      name: "A.8.32 — Change management",
      description: "Changes to information processing facilities are subject to management.",
      moduleIds: ["host.code-integrity", "app.supply-chain"],
    },
  ],
};

const SOC2: CompliancePack = {
  id: "soc2",
  name: "SOC 2 Trust Services Criteria",
  shortName: "SOC 2",
  version: "2017",
  controls: [
    {
      id: "soc2.cc1",
      name: "CC1 — Control Environment",
      description: "The entity demonstrates a commitment to integrity and ethical values.",
      moduleIds: ["compliance.soc2"],
    },
    {
      id: "soc2.cc2",
      name: "CC2 — Communication",
      description: "Entity communicates information necessary to support the functioning of internal control.",
      moduleIds: ["incident.response-readiness", "compliance.soc2"],
    },
    {
      id: "soc2.cc6",
      name: "CC6 — Logical and Physical Access",
      description: "Logical access to software, data and technology is restricted.",
      moduleIds: ["host.identity-admins", "identity.mfa-posture", "host.lateral-movement", "compliance.soc2"],
    },
    {
      id: "soc2.cc7",
      name: "CC7 — System Operations",
      description: "Systems are monitored to detect and protect against threats.",
      moduleIds: ["host.firewall-edr", "threat.hunt-lite", "net.host-segment", "compliance.soc2"],
    },
    {
      id: "soc2.cc8",
      name: "CC8 — Change Management",
      description: "Changes are authorized, tested, documented and tracked.",
      moduleIds: ["host.code-integrity", "app.supply-chain"],
    },
    {
      id: "soc2.cc9",
      name: "CC9 — Risk Mitigation",
      description: "The entity identifies, selects, and develops risk mitigation activities.",
      moduleIds: ["threat.hunt-lite", "threat.hunt-deep", "incident.response-readiness"],
    },
    {
      id: "soc2.a1",
      name: "A1 — Availability",
      description: "Systems are available for operation and use as committed.",
      moduleIds: ["resilience.backup", "resilience.ransomware"],
    },
    {
      id: "soc2.c1",
      name: "C1 — Confidentiality",
      description: "Information designated as confidential is protected.",
      moduleIds: ["identity.secrets-exposure", "host.os-posture"],
    },
  ],
};

const PCI_DSS: CompliancePack = {
  id: "pci-dss",
  name: "PCI DSS",
  shortName: "PCI DSS",
  version: "v4.0",
  controls: [
    {
      id: "pci.1",
      name: "Req 1 — Network Security Controls",
      description: "Install and maintain network security controls.",
      moduleIds: ["host.firewall-edr", "net.host-segment", "net.remote-access"],
    },
    {
      id: "pci.2",
      name: "Req 2 — Secure Configurations",
      description: "Apply secure configurations to all system components.",
      moduleIds: ["host.os-posture", "host.surface-ports", "compliance.pci-dss"],
    },
    {
      id: "pci.3",
      name: "Req 3 — Protect Account Data",
      description: "Protect stored account data.",
      moduleIds: ["identity.secrets-exposure", "host.os-posture"],
    },
    {
      id: "pci.4",
      name: "Req 4 — Protect Cardholder Data in Transit",
      description: "Protect cardholder data with strong cryptography during transmission.",
      moduleIds: ["net.remote-access", "identity.secrets-exposure"],
    },
    {
      id: "pci.5",
      name: "Req 5 — Protect against Malicious Software",
      description: "Protect all systems against malware.",
      moduleIds: ["host.firewall-edr", "threat.hunt-lite"],
    },
    {
      id: "pci.6",
      name: "Req 6 — Secure Systems and Software",
      description: "Develop and maintain secure systems and software.",
      moduleIds: ["app.supply-chain", "host.code-integrity", "host.os-posture"],
    },
    {
      id: "pci.7",
      name: "Req 7 — Restrict Access by Business Need",
      description: "Restrict access to system components and cardholder data.",
      moduleIds: ["host.identity-admins", "host.lateral-movement"],
    },
    {
      id: "pci.8",
      name: "Req 8 — Identify Users and Authenticate",
      description: "Identify users and authenticate access to system components.",
      moduleIds: ["identity.mfa-posture", "host.identity-admins", "identity.secrets-exposure"],
    },
    {
      id: "pci.10",
      name: "Req 10 — Log and Monitor All Access",
      description: "Log and monitor all access to system components and cardholder data.",
      moduleIds: ["incident.response-readiness", "compliance.pci-dss"],
    },
    {
      id: "pci.11",
      name: "Req 11 — Test Security Systems Regularly",
      description: "Test security of systems and networks regularly.",
      moduleIds: ["threat.hunt-lite", "net.host-segment", "compliance.pci-dss"],
    },
  ],
};

export const COMPLIANCE_PACKS: CompliancePack[] = [CIS, NIST, ISO27001, SOC2, PCI_DSS];

export function getPackById(id: string): CompliancePack | undefined {
  return COMPLIANCE_PACKS.find((p) => p.id === id);
}

type ModuleStatus = {
  status: "completed" | "failed" | "partial" | "pending" | "running" | "client_required";
  findings?: Record<string, unknown>;
  evidence?: string[];
};

function resolveControlStatus(
  control: ComplianceControl,
  moduleResults: Map<string, ModuleStatus>,
): { status: ControlStatus; score: number; evidence: string[]; covered: string[] } {
  const covered: string[] = [];
  const evidence: string[] = [];
  let passedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;

  for (const moduleId of control.moduleIds) {
    const result = moduleResults.get(moduleId);
    if (!result) {
      pendingCount++;
      continue;
    }
    covered.push(moduleId);
    evidence.push(...(result.evidence ?? []).slice(0, 3));

    if (result.status === "completed") {
      const sev = (result.findings as { severity?: string } | undefined)?.severity;
      if (sev === "critical" || sev === "high") {
        failedCount++;
      } else {
        passedCount++;
      }
    } else if (result.status === "failed" || result.status === "client_required") {
      failedCount++;
    } else {
      pendingCount++;
    }
  }

  const total = passedCount + failedCount + pendingCount;
  if (total === 0) {
    return { status: "not_evaluated", score: 0, evidence, covered };
  }
  if (pendingCount === total) {
    return { status: "not_evaluated", score: 0, evidence, covered };
  }
  if (failedCount === 0 && passedCount > 0) {
    return { status: "passed", score: 100, evidence, covered };
  }
  if (passedCount === 0) {
    return { status: "failed", score: 0, evidence, covered };
  }
  const score = Math.round((passedCount / (passedCount + failedCount)) * 100);
  return { status: "partial", score, evidence, covered };
}

export function evaluateCompliancePack(
  pack: CompliancePack,
  moduleResults: Map<string, ModuleStatus>,
): ComplianceReport {
  const controlResults: ControlResult[] = pack.controls.map((control) => {
    const { status, score, evidence, covered } = resolveControlStatus(control, moduleResults);
    return {
      controlId: control.id,
      name: control.name,
      status,
      score,
      modulesCovered: covered,
      evidence,
    };
  });

  const passed = controlResults.filter((c) => c.status === "passed").length;
  const failed = controlResults.filter((c) => c.status === "failed").length;
  const partial = controlResults.filter((c) => c.status === "partial").length;
  const notApplicable = controlResults.filter((c) => c.status === "not_applicable").length;
  const notEvaluated = controlResults.filter((c) => c.status === "not_evaluated").length;

  const evaluated = passed + failed + partial;
  const overallScore = evaluated === 0
    ? 0
    : Math.round(controlResults.reduce((sum, c) => sum + c.score, 0) / pack.controls.length);

  return {
    packId: pack.id,
    packName: pack.name,
    generatedAt: new Date().toISOString(),
    overallScore,
    controlsPassed: passed,
    controlsFailed: failed,
    controlsPartial: partial,
    controlsNotApplicable: notApplicable,
    controlsNotEvaluated: notEvaluated,
    controls: controlResults,
  };
}
