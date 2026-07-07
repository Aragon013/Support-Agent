export type InstallProfile =
  | "remote_only"
  | "support_limited_no_folders"
  | "support_full";

export function resolveInstallProfile(value: unknown): InstallProfile {
  if (
    value === "remote_only" ||
    value === "support_limited_no_folders" ||
    value === "support_full"
  ) {
    return value;
  }

  // Safe default when policy data is missing or malformed.
  return "support_full";
}
