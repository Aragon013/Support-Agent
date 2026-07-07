/**
 * Registry de endpoints con políticas de seguridad (installProfile, licenciamiento, etc.)
 * En producción, esto vendría de una BD o servicio de configuración.
 * En dev, permite override via headers.
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
}

/**
 * In-memory endpoint registry.
 * En producción, esto sería una BD real (PostgreSQL/DynamoDB/etc).
 */
export class InMemoryEndpointRegistry {
  private registry = new Map<string, EndpointRegistry>();

  constructor() {
    // Initialize with some default endpoints for testing
    this.registry.set("endpoint-1", {
      endpointId: "endpoint-1",
      installProfile: "support_full",
      licenseStatus: "active",
      supportCommandsAllowed: true,
      folderActionsAllowed: true,
      unattendedEnabled: false,
      requiresUserConsent: true,
      maxActiveControlSessions: 1,
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
    });
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
   * In production, this would be called by a provisioning API.
   */
  register(endpoint: EndpointRegistry): void {
    this.registry.set(endpoint.endpointId, endpoint);
  }

  /**
   * Unregister an endpoint.
   */
  unregister(endpointId: string): void {
    this.registry.delete(endpointId);
  }

  /**
   * List all registered endpoints (for diagnostics/admin).
   */
  listAll(): EndpointRegistry[] {
    return Array.from(this.registry.values());
  }
}
