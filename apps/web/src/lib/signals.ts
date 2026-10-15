import type { Level, SignalListQuery, SignalStrengthKey, SignalStatusKey } from "@revenue-os/shared";

/** Display helpers for the Signals screen (#9, Phase 16). Shapes live in `@revenue-os/shared` (signals.ts). */

export const STRENGTH_LABEL: Record<SignalStrengthKey, string> = { STRONG: "Strong", MEDIUM: "Medium", WEAK: "Weak" };

export const STRENGTH_STYLE: Record<SignalStrengthKey, string> = {
  STRONG: "border-danger/30 bg-danger-soft text-danger",
  MEDIUM: "border-amber/30 bg-amber-soft text-amber",
  WEAK: "text-faint",
};

export const LEVEL_STYLE: Record<Level, string> = {
  HIGH: "border-tone/30 bg-tone-soft text-tone",
  MEDIUM: "border-amber/30 bg-amber-soft text-amber",
  LOW: "text-faint",
};

export const STATUS_STYLE: Partial<Record<SignalStatusKey, string>> = {
  ACTIONABLE: "border-tone/30 bg-tone-soft text-tone",
  DETECTED: "border-amber/30 bg-amber-soft text-amber",
  DISMISSED: "text-faint",
  EXPIRED: "text-faint",
  ACTED_ON: "border-accent/30 bg-accent-soft text-accent",
};

export const levelText = (l: Level | null | undefined) => (l ? `${l.charAt(0)}${l.slice(1).toLowerCase()}` : "Not assessed");

/** "32 min ago", "5 h ago", "3 days ago" — signals can be minutes old, so finer than knowledge `agoOf`. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return `in ${timeUntil(iso)}`;
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 60) return `${d} days ago`;
  return `${Math.round(d / 30)} months ago`;
}

function timeUntil(iso: string): string {
  const d = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** SignalListQuery → `?status=…&priority=true` (empty values dropped). */
export function listQueryString(q: SignalListQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    p.set(k, String(v));
  }
  return p.size ? `?${p}` : "";
}

export const ACT_LABEL: Record<string, string> = {
  RESEARCH: "Research",
  ATTACH_TO_DEAL: "Attach to deal",
  NOTIFY_OWNER: "Notify owner",
  RE_ENGAGE: "Re-engage",
  CAMPAIGN_CANDIDATE: "Campaign candidate",
  VALIDATE: "Validate",
  MONITOR: "Monitor",
};

/** A saved market as the signal filters need it (from `GET /markets`). */
export interface MarketRef {
  id: string;
  name: string;
}
