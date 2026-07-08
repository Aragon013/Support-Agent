import fs from "fs/promises";
import path from "path";

/**
 * Registry de endpoints con políticas de seguridad (installProfile, licenciamiento, etc.)
 * En producción, esto vendría de una BD (PostgreSQL/DynamoDB/etc).
 * En dev, persiste en JSON para testing.
 */

export type EndpointInstallProfile =
  | "remote_only"
  | "support_limited_no_folders"
  | "support_full";

export interface EndpointRegistry {
  endpointId: string;
  installProfile: EndpointInstallProfile;
  licenseStatus: "active" | "inactive";
  supportCommandsAllowed: boolean;
  folderActionsAllowed: boolean;
  unattendedEnabled: boolean;
  requiresUserConsent: boolean;
  maxActiveControlSessions: number;
  registeredAt?: string;
}

/**
 * In-memory endpoint registry with JSON persistence.
 * En producción, usar una BD real.
 */
export class InMemoryEndpointRegistry {
  private registry = new Map<string, EndpointRegistry>();
  private persistPath = path.join(process.cwd(), ".endpoints-registry.json");
  private isDev = process.env.NODE_ENV === "development";

  async init(): Promise<void> {
    if (!this.isDev) {
      return; // No persistence in production (use DB)
    }

    try {
      const data = await fs.readFile(this.persistPath, "utf-8");
      const parsed = JSON.parse(data) as Record<string, EndpointRegistry>;
      Object.entries(parsed).forEach(([key, endpoint]) => {
        this.registry.set(key, endpoint);
      });
    } catch {
      // File doesn't exist or invalid JSON, start with defaults
      this.loadDefaults();
    }
  }

  private loadDefaults(): void {
    this.registry.set("endpoint-1", {
      endpointId: "endpoint-1",
      installProfile: "support_full",
      licenseStatus: "active",
      supportCommandsAllowed: true,
      folderActionsAllowed: true,
      unattendedEnabled: false,
      requiresUserConsent: true,
      maxActiveControlSessions: 1,
      registeredAt: new Date().toISOString(),
    });

    this.registry.set("endpoint-2", {
      endpointId: "endpoint-2",
      installProfile: "support_limited_no_folders",
      licenseStatus: "active",
      supportCommandsAllowed: true,
      folderActionsAllowed: false,
      unattendedEnabled: true,
      requiresUserConsent: false,
      maxActiveControlSessions: 1,
      registeredAt: new Date().toISOString(),
    });
  }

  private async persist(): Promise<void> {
    if (!this.isDev) {
      return;
    }

    const data = Object.fromEntries(this.registry.entries());
    try {
      await fs.writeFile(this.persistPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("Failed to persist endpoint registry:", err);
    }
  }

  /**
   * Get endpoint registry by ID.
   * Returns null if not found (endpoint not registered).
   */
  get(endpointId: string): EndpointRegistry | null {
    return this.registry.get(endpointId) ?? null;
  }

  /**
   * Register or update an endpoint in the registry.
   * Persists to JSON file in dev mode.
   */
  async register(endpoint: EndpointRegistry): Promise<void> {
    const entry: EndpointRegistry = {
      ...endpoint,
      registeredAt: endpoint.registeredAt ?? new Date().toISOString(),
    };
    this.registry.set(endpoint.endpointId, entry);
    await this.persist();
  }

  /**
   * Unregister an endpoint.
   */
  async unregister(endpointId: string): Promise<void> {
    this.registry.delete(endpointId);
    await this.persist();
  }

  /**
   * List all registered endpoints (for diagnostics/admin).
   */
  listAll(): EndpointRegistry[] {
    return Array.from(this.registry.values());
  }
}
