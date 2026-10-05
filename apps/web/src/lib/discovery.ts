/** Shapes of the Lead Hunter API (`/api/v1/discovery-missions`, `/markets`) and display helpers (Phase 7). */

import type { DiscoveryMode, MarketInterpretation, ModeProfile, StopReason } from "@revenue-os/shared";
import { STOP_REASON_LABEL } from "@revenue-os/shared";
import type { Confidence } from "./crm";

export type MissionStatus =
  | "DRAFT"
  | "READY"
  | "PLANNING"
  | "DISCOVERING"
  | "RESOLVING"
  | "ENRICHING"
  | "ASSESSING_COVERAGE"
  | "COMPLETED"
  | "PAUSED"
  | "WAITING"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED";

export type MissionAction = "pause" | "resume" | "stop";
export type QueryStatus = "PLANNED" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
export type QueryType = "PRIMARY_CATEGORY" | "RELATED_CATEGORY" | "KEYWORD_VARIANT" | "GEO_VARIANT";
export type Outcome = "CREATED" | "MATCHED_EXISTING";

export interface MarketRef {
  name: string;
  country: string;
  region: string | null;
  city: string | null;
  industry: string;
}

export interface MissionSummary {
  id: string;
  version: number;
  marketId: string;
  market: MarketRef;
  mode: DiscoveryMode;
  status: MissionStatus;
  statusReason: string | null;
  stopReason: StopReason | null;
  coverageConfidence: Confidence | null;
  currentRound: number;
  maxRounds: number;
  queriesExecuted: number;
  maxQueries: number;
  providerCalls: number;
  maxProviderCalls: number;
  /** Lead target the person chose; null = no limit. */
  targetCount: number | null;
  failedQueries: number;
  observationsCount: number;
  uniqueCompanies: number;
  newCompanies: number;
  matchedExisting: number;
  duplicateObservations: number;
  reviewCandidates: number;
  rejectedObservations: number;
  withWebsite: number;
  withoutWebsite: number;
  withPhone: number;
  sourcesUsed: string[];
  categories: string[];
  request: string | null;
  retryAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
}

/** One CoverageAssessment row — measured after each round. */
export interface CoverageRound {
  id: string;
  round: number;
  queries: number;
  observations: number;
  newUnique: number;
  cumulativeUnique: number;
  /** 0…1 */
  marginalYield: number;
  /** 0…1 */
  duplicateRate: number;
  confidence: Confidence;
  decision: "CONTINUE" | "COMPLETE";
  stopReason: StopReason | null;
  reasons: string[];
  strategiesRemaining: number;
  assessedAt: string;
}

export interface QueryRow {
  id: string;
  round: number;
  queryType: QueryType;
  queryText: string;
  provider: string;
  providerName: string;
  status: QueryStatus;
  pagesFetched: number;
  resultCount: number;
  newUniqueCount: number;
  exhausted: boolean;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MissionSource {
  provider: string;
  name: string;
  queries: number;
  observations: number;
  uniqueCompanies: number;
}

export interface MissionDetail extends MissionSummary {
  rounds: CoverageRound[];
  queries: QueryRow[];
  sources: MissionSource[];
  /** Phase 8: research of the businesses this hunt found. */
  research: { companies: number; researched: number; active: number; failed: number; hypotheses: number };
  allowedActions: MissionAction[];
}

export interface MissionCompany {
  companyId: string;
  displayName: string;
  websiteDomain: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  status: string;
  outcome: Outcome;
  sources: string[];
  listings: number;
  firstRound: number;
  flaggedForReview: boolean;
  research: {
    status: "QUEUED" | "RUNNING" | "WAITING" | "COMPLETED" | "PARTIAL" | "FAILED" | null;
    hypotheses: number;
  };
}

export interface MissionCompaniesResponse {
  items: MissionCompany[];
  nextCursor: string | null;
  total: number;
}

export interface MissionListResponse {
  items: MissionSummary[];
  nextCursor: string | null;
}

export interface MarketRow {
  id: string;
  name: string;
  country: string;
  region: string | null;
  city: string | null;
  industry: string;
  lastDiscoveryAt: string | null;
  missions: number;
  uniqueCompanies: number;
  latestMission: { id: string; status: MissionStatus; coverageConfidence: Confidence | null } | null;
}

export interface PreviewSource {
  integrationId: string;
  provider: string;
  name: string;
  health: string;
}

export interface PreviewResponse {
  interpretation: MarketInterpretation | null;
  market: {
    name: string;
    marketKey: string;
    country: string;
    region: string | null;
    city: string | null;
    industry: string;
    industryLabel: string;
    existingMarketId: string | null;
    runningMissionId: string | null;
  };
  mode: DiscoveryMode;
  profile: ModeProfile;
  categories: { available: string[]; selected: string[] };
  sources: PreviewSource[];
  strategies: number;
  warnings: string[];
}

// ── Labels ──────────────────────────────────────────────────────────────────────────────────────

export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = {
  DRAFT: "Draft",
  READY: "Ready",
  PLANNING: "Planning queries",
  DISCOVERING: "Searching sources",
  RESOLVING: "Resolving duplicates",
  ENRICHING: "Enriching",
  ASSESSING_COVERAGE: "Measuring coverage",
  COMPLETED: "Completed",
  PAUSED: "Paused",
  WAITING: "Waiting (rate limit)",
  BLOCKED: "Blocked",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const RUNNING = new Set<MissionStatus>(["PLANNING", "DISCOVERING", "RESOLVING", "ENRICHING", "ASSESSING_COVERAGE"]);
const TERMINAL = new Set<MissionStatus>(["COMPLETED", "FAILED", "CANCELLED"]);

/** The engine is working on it right now (or will retry by itself, for WAITING). */
export function isActive(status: MissionStatus): boolean {
  return RUNNING.has(status) || status === "WAITING";
}

export function isTerminal(status: MissionStatus): boolean {
  return TERMINAL.has(status);
}

export function missionStatusClass(status: MissionStatus): string {
  if (RUNNING.has(status)) return "border-accent/30 bg-accent-soft text-accent";
  if (status === "COMPLETED") return "border-brand/25 bg-brand-soft text-brand";
  if (status === "WAITING" || status === "PAUSED") return "border-amber/30 bg-amber-soft text-amber";
  if (status === "BLOCKED" || status === "FAILED") return "border-danger/30 bg-danger-soft text-danger";
  return "";
}

export const MODE_LABEL: Record<DiscoveryMode, string> = {
  QUICK: "Quick Hunt",
  DEEP: "Deep Hunt",
  MARKET_EXHAUST: "Market Exhaust",
};

export const QUERY_TYPE_LABEL: Record<QueryType, string> = {
  PRIMARY_CATEGORY: "Main category",
  RELATED_CATEGORY: "Related category",
  KEYWORD_VARIANT: "Keyword variant",
  GEO_VARIANT: "Area variant",
};

export const COVERAGE_LABEL: Record<Confidence, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const COVERAGE_HINT: Record<Confidence, string> = {
  HIGH: "New results dried up across several rounds, sources and kinds of query.",
  MEDIUM: "New results slowed down, but the measurement is not strong enough for high confidence.",
  LOW: "Too little measured yet — more rounds or sources would find more.",
};

export const COVERAGE_CLASS: Record<Confidence, string> = {
  HIGH: "border-brand/25 bg-brand-soft text-brand",
  MEDIUM: "border-amber/30 bg-amber-soft text-amber",
  LOW: "border-line-strong text-muted",
};

export function coverageLabel(c: Confidence | null): string {
  return c ? `${COVERAGE_LABEL[c]} coverage confidence` : "Coverage not measured yet";
}

export function stopReasonLabel(r: StopReason | null): string | null {
  return r ? (STOP_REASON_LABEL[r] ?? r) : null;
}

/** Integration health states from the provider gateway (Phase 5). */
export const SOURCE_HEALTH: Record<string, { label: string; className: string }> = {
  HEALTHY: { label: "Healthy", className: "border-brand/25 bg-brand-soft text-brand" },
  ACTIVE: { label: "Connected", className: "border-brand/25 bg-brand-soft text-brand" },
  DEGRADED: { label: "Degraded", className: "border-amber/30 bg-amber-soft text-amber" },
  RATE_LIMITED: { label: "Rate-limited", className: "border-amber/30 bg-amber-soft text-amber" },
  AUTH_REQUIRED: { label: "Needs reconnect", className: "border-danger/30 bg-danger-soft text-danger" },
  AUTH_EXPIRED: { label: "Needs reconnect", className: "border-danger/30 bg-danger-soft text-danger" },
  UNAVAILABLE: { label: "Unavailable", className: "border-danger/30 bg-danger-soft text-danger" },
  ERROR: { label: "Unavailable", className: "border-danger/30 bg-danger-soft text-danger" },
};

export function sourceHealth(health: string): { label: string; className: string } {
  return (
    SOURCE_HEALTH[health] ?? { label: health ? health.toLowerCase().replace(/_/g, " ") : "Unknown", className: "" }
  );
}

export function percent(x: number): string {
  return `${Math.round(x * 100)}%`;
}
