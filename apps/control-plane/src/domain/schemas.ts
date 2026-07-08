import { z } from "zod";

/**
 * Shared Zod schemas para validación de request/response bodies.
 * Usados tanto en backend como en frontend (via tipos exportados).
 */

export const InstallProfileSchema = z.enum([
  "remote_only",
  "support_limited_no_folders",
  "support_full",
]);

export const EndpointRegistrySchema = z.object({
  endpointId: z.string().min(1, "endpointId is required"),
  installProfile: InstallProfileSchema,
  licenseStatus: z.enum(["active", "inactive"]),
  supportCommandsAllowed: z.boolean(),
  folderActionsAllowed: z.boolean(),
  unattendedEnabled: z.boolean(),
  requiresUserConsent: z.boolean(),
  maxActiveControlSessions: z.number().int().min(1),
  registeredAt: z.string().datetime().optional(),
});

export const RegisterEndpointRequestSchema = z.object({
  endpointId: z.string().min(1, "endpointId is required"),
  installProfile: InstallProfileSchema.optional().default("support_full"),
  licenseStatus: z.enum(["active", "inactive"]).optional().default("active"),
  unattendedEnabled: z.boolean().optional().default(false),
  maxActiveControlSessions: z.number().int().min(1).optional().default(1),
});

export const SessionPolicyResponseSchema = z.object({
  endpointId: z.string(),
  installProfile: InstallProfileSchema,
  supportCommandsAllowed: z.boolean(),
  folderActionsAllowed: z.boolean(),
  unattendedEnabled: z.boolean(),
  requiresUserConsent: z.boolean(),
  maxActiveControlSessions: z.number(),
  source: z.enum(["registry", "header (dev-only)", "fallback (not registered)"]),
});

export const CreateSessionRequestSchema = z.object({
  tenantId: z.string().min(1),
  endpointId: z.string().min(1),
  operatorId: z.string().min(1),
  accessMode: z.enum(["control", "view"]).optional().default("view"),
  requestedCapabilities: z.array(z.enum(["screen", "input", "clipboard"])).optional(),
});

/**
 * Type exports para usar en frontend/backend
 */
export type InstallProfile = z.infer<typeof InstallProfileSchema>;
export type EndpointRegistry = z.infer<typeof EndpointRegistrySchema>;
export type RegisterEndpointRequest = z.infer<typeof RegisterEndpointRequestSchema>;
export type SessionPolicyResponse = z.infer<typeof SessionPolicyResponseSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
