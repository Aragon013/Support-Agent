import type { CommandParamSchema } from "./command-param-schema.js";

export type CommandCatalogItem = {
  id: string;
  version: string;
  name: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  description: string;
  paramsSchema: CommandParamSchema;
};

export const COMMAND_CATALOG: CommandCatalogItem[] = [
  {
    id: "diagnostic.system.info",
    version: "1.0.0",
    name: "System Info",
    riskLevel: "low",
    description: "Collect basic endpoint OS and runtime details.",
    paramsSchema: {
      fields: {
        forensic: {
          type: "boolean",
        },
        ransomware: {
          type: "boolean",
        },
      },
      allowUnknown: false,
    },
  },
  {
    id: "maintenance.service.restart",
    version: "1.0.0",
    name: "Restart Allowed Service",
    riskLevel: "medium",
    description: "Restart a pre-approved service by id.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        serviceId: {
          type: "string",
          required: true,
          minLength: 2,
          maxLength: 80,
          pattern: /^[a-zA-Z0-9_.-]+$/,
        },
      },
    },
  },
  {
    id: "security.firewall.status",
    version: "1.0.0",
    name: "Firewall Status",
    riskLevel: "low",
    description: "Read firewall status from endpoint.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        framework: {
          type: "string",
          enumValues: ["pci-dss"],
        },
        profile: {
          type: "string",
          enumValues: ["domain", "private", "public"],
        },
      },
    },
  },
  {
    id: "maintenance.network.reset",
    version: "1.0.0",
    name: "Network Reset",
    riskLevel: "high",
    description: "Run a controlled network stack reset on endpoint.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        mode: {
          type: "string",
          required: true,
          enumValues: ["soft", "full"],
        },
        adapter: {
          type: "string",
          minLength: 1,
          maxLength: 64,
        },
      },
    },
  },
  {
    id: "security.driver-signing.status",
    version: "1.0.0",
    name: "Driver Signing Status",
    riskLevel: "low",
    description: "Inspect driver signing and kernel trust posture.",
    paramsSchema: {
      allowUnknown: false,
      fields: {},
    },
  },
  {
    id: "security.credential-guard.status",
    version: "1.0.0",
    name: "Credential Guard Status",
    riskLevel: "low",
    description: "Assess credential isolation and lateral movement guardrails.",
    paramsSchema: {
      allowUnknown: false,
      fields: {},
    },
  },
  {
    id: "diagnostic.process.enum",
    version: "1.0.0",
    name: "Process Enumeration",
    riskLevel: "medium",
    description: "Enumerate running processes and related behavioral signals.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        deep: {
          type: "boolean",
        },
      },
    },
  },
  {
    id: "security.audit-logging.status",
    version: "1.0.0",
    name: "Audit Logging Status",
    riskLevel: "low",
    description: "Check logging controls and framework-aligned evidence posture.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        framework: {
          type: "string",
          enumValues: ["hipaa", "soc2", "cis"],
        },
      },
    },
  },
  {
    id: "diagnostic.backup-status.check",
    version: "1.0.0",
    name: "Backup Status Check",
    riskLevel: "low",
    description: "Read backup posture and restore readiness signals.",
    paramsSchema: {
      allowUnknown: false,
      fields: {},
    },
  },
  {
    id: "security.mfa.status",
    version: "1.0.0",
    name: "MFA Posture",
    riskLevel: "low",
    description: "Assess multi-factor enforcement across local and remote access paths.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        scope: {
          type: "string",
          enumValues: ["local", "remote", "all"],
        },
      },
    },
  },
  {
    id: "security.secret-scanning.status",
    version: "1.0.0",
    name: "Secrets Exposure Status",
    riskLevel: "medium",
    description: "Check for exposed credentials, tokens and unsafe secret storage patterns.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        scope: {
          type: "string",
          enumValues: ["user", "system", "all"],
        },
      },
    },
  },
  {
    id: "security.remote-access.status",
    version: "1.0.0",
    name: "Remote Access Posture",
    riskLevel: "medium",
    description: "Inspect VPN, RDP and SSH exposure plus hardening controls.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        mode: {
          type: "string",
          enumValues: ["vpn", "rdp", "ssh", "all"],
        },
      },
    },
  },
  {
    id: "diagnostic.cloud.config",
    version: "1.0.0",
    name: "Cloud Configuration Snapshot",
    riskLevel: "low",
    description: "Collect cloud and SaaS security posture metadata for baseline review.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        provider: {
          type: "string",
          enumValues: ["m365", "aws", "azure", "gcp", "all"],
        },
      },
    },
  },
  {
    id: "security.software-integrity.status",
    version: "1.0.0",
    name: "Software Integrity Status",
    riskLevel: "medium",
    description: "Assess publisher trust, SBOM readiness and supply-chain integrity checks.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        framework: {
          type: "string",
          enumValues: ["sbom", "supply-chain", "publisher-trust"],
        },
      },
    },
  },
  {
    id: "security.benchmark.status",
    version: "1.0.0",
    name: "Security Benchmark Status",
    riskLevel: "low",
    description: "Read benchmark alignment status for baseline frameworks.",
    paramsSchema: {
      allowUnknown: false,
      fields: {
        framework: {
          type: "string",
          enumValues: ["cis"],
        },
      },
    },
  },
];

export function findCatalogCommand(id: string): CommandCatalogItem | undefined {
  return COMMAND_CATALOG.find((item) => item.id === id);
}
