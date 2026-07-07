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
      fields: {},
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
];

export function findCatalogCommand(id: string): CommandCatalogItem | undefined {
  return COMMAND_CATALOG.find((item) => item.id === id);
}
