/**
 * Error message mapping y helpers.
 * Convierte códigos de error de backend a mensajes amigables para UI.
 */

export const ERROR_LABELS: Record<string, string> = {
  // Endpoint policy errors
  "policy_http_403": "Access denied. Check your role or license status.",
  "policy_http_404": "Endpoint not found in registry. Register it first via /api/v1/endpoints",
  "policy_http_500": "Backend error loading endpoint policy.",
  "install_profile_remote_only": "Support commands are disabled for this endpoint (Remote Only profile).",
  "install_profile_limited": "This command is blocked for this endpoint (Limited profile).",
  
  // License errors
  "license_inactive": "Endpoint license is inactive. Renew the license to continue.",
  "license_expired": "Endpoint license has expired.",
  
  // Endpoint state errors
  "endpoint_offline": "Endpoint is offline. Ensure it's online before trying.",
  "endpoint_busy": "Endpoint has another active session. Try again later.",
  
  // Session errors
  "session_creation_failed": "Failed to create session. Check endpoint status and try again.",
  "session_approval_required": "Session pending user approval on the endpoint.",
  "session_connection_timeout": "Session connection timed out. Host may be unreachable.",
  
  // Job/Command errors
  "job_dispatch_failed": "Failed to dispatch command. Check parameters and try again.",
  "job_mfa_required": "This command requires MFA verification.",
  "job_permission_denied": "Your role doesn't have permission for this command.",
  
  // Network errors
  "network_error": "Network error. Check your connection and try again.",
  "timeout": "Request timed out. The endpoint may be slow or offline.",
  
  // Generic
  "unknown_error": "An unexpected error occurred. Try again or contact support.",
};

/**
 * Maps error codes/messages from backend to user-friendly labels.
 */
export function mapErrorMessage(
  errorCode?: string | null,
  errorReason?: string | null,
  httpStatus?: number,
): string {
  if (!errorCode && !errorReason && !httpStatus) {
    return ERROR_LABELS.unknown_error;
  }

  // Try exact match on code
  if (errorCode && errorCode in ERROR_LABELS) {
    return ERROR_LABELS[errorCode];
  }

  // Try exact match on reason
  if (errorReason && errorReason in ERROR_LABELS) {
    return ERROR_LABELS[errorReason];
  }

  // Try HTTP status code patterns
  if (httpStatus === 403) {
    return ERROR_LABELS.policy_http_403;
  }
  if (httpStatus === 404) {
    return ERROR_LABELS.policy_http_404;
  }
  if (httpStatus === 500) {
    return ERROR_LABELS.policy_http_500;
  }

  // Check if message contains common patterns
  const combined = `${errorCode ?? ""} ${errorReason ?? ""}`.toLowerCase();
  if (combined.includes("mfa") || combined.includes("step-up")) {
    return ERROR_LABELS.job_mfa_required;
  }
  if (combined.includes("timeout") || combined.includes("timed out")) {
    return ERROR_LABELS.timeout;
  }
  if (combined.includes("offline")) {
    return ERROR_LABELS.endpoint_offline;
  }
  if (combined.includes("license")) {
    return ERROR_LABELS.license_inactive;
  }

  // Fallback: use original error if available
  if (errorReason) {
    return errorReason;
  }
  if (errorCode) {
    return errorCode;
  }

  return ERROR_LABELS.unknown_error;
}

/**
 * Auditable error context for logging.
 */
export interface ErrorContext {
  code?: string;
  reason?: string;
  status?: number;
  context?: Record<string, unknown>;
}

export function createErrorContext(
  code?: string,
  reason?: string,
  status?: number,
): ErrorContext {
  return { code, reason, status };
}
