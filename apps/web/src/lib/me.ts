import type { PermissionKey, RoleKey } from "@revenue-os/shared";

/** Shape of GET /api/v1/auth/me. Role/permission data here is for UX only — the API enforces access. */
export interface Me {
  user: { id: string; email: string; name: string; timezone: string | null };
  workspace: { id: string; name: string; slug: string };
  roles: RoleKey[];
  permissions: PermissionKey[];
  authorityLimits: Record<string, number | null>;
  workspaces: { id: string; name: string; slug: string }[];
}

export const SESSION_COOKIE = "rhl_session";

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeNext(next: string | string[] | undefined): string {
  const value = Array.isArray(next) ? next[0] : next;
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/dashboard";
}
