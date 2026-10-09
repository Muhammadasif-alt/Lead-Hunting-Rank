/** Shapes of the Opportunities API (`/api/v1/opportunities`, Phase 13) and display helpers. */
import type { DealHealth, LossReasonCode, QualificationKey, StageSemantic, StakeholderRoleKey } from "@revenue-os/shared";

export type OpportunityStatus = "OPEN" | "WON" | "LOST" | "ARCHIVED";
export type View = "pipeline" | "priority" | "mine" | "closed";

export interface Risk {
  text: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
}

export interface DealCard {
  id: string;
  name: string;
  service: string | null;
  company: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  stage: StageSemantic;
  status: OpportunityStatus;
  amountMinor: number | null;
  wonAmountMinor: number | null;
  currency: string;
  owner: { id: string; name: string | null } | null;
  health: DealHealth;
  topRisk: Risk | null;
  nextAction: { action: string; why: string };
  known: QualificationKey[];
  waitingOnUs: boolean;
  daysInStage: number;
  lastActivityAt: string;
  closedAt: string | null;
  version: number;
}

export interface Board {
  summary: {
    openCount: number;
    openValue: Record<string, number>;
    unpricedCount: number;
    proposalValue: Record<string, number>;
    wonThisMonth: Record<string, number>;
    wonThisMonthCount: number;
    lostThisMonthCount: number;
  };
  stages: { id: string; name: string; semantic: StageSemantic }[];
  cards: DealCard[];
}

export interface QualificationField {
  key: QualificationKey;
  current: {
    id: string;
    value: string;
    quote: string | null;
    source: string;
    confidence: string;
    verified: boolean;
    verifiedBy: string | null;
    messageId: string | null;
    at: string;
  } | null;
  history: { id: string; value: string; quote: string | null; source: string; at: string; supersededAt: string }[];
}

export interface Stakeholder {
  id: string;
  personId: string | null;
  name: string;
  title: string | null;
  role: StakeholderRoleKey;
  influence: string;
  status: "SUGGESTED" | "KNOWN" | "ENGAGED" | "NOT_CONTACTED";
  source: string;
  quote: string | null;
}

export interface OpportunityDetail {
  opportunity: {
    id: string;
    name: string;
    service: string | null;
    status: OpportunityStatus;
    stage: StageSemantic;
    stageName: string;
    amountMinor: number | null;
    wonAmountMinor: number | null;
    wonNote: string | null;
    currency: string;
    source: string;
    originReason: string | null;
    originQuote: string | null;
    createdByType: string;
    nextActionOverride: string | null;
    nextActionDueAt: string | null;
    stageEnteredAt: string;
    lastActivityAt: string;
    closedAt: string | null;
    createdAt: string;
    primaryPersonId: string | null;
    version: number;
  };
  owner: { id: string; name: string } | null;
  company: { id: string; name: string; industry: string | null; city: string | null; region: string | null; website: string | null; status: string };
  contact: { id: string; name: string } | null;
  people: { id: string; name: string; title: string | null }[];
  conversation: { id: string; subject: string; email: string; contactName: string | null; category: string; waitingOn: string; mode: string; lastInboundAt: string | null; summary: string | null } | null;
  campaign: { id: string; name: string; offer: string } | null;
  origin: { market: { id: string; name: string } | null; leadSource: string | null; campaign: { id: string; name: string } | null; offer: string | null; source: string };
  health: { health: DealHealth; signals: string[]; risks: Risk[] };
  nextAction: { action: string; why: string };
  qualification: { status: "UNQUALIFIED" | "PARTIAL" | "QUALIFIED"; fields: QualificationField[] };
  stakeholders: Stakeholder[];
  stages: { id: string; name: string; semantic: StageSemantic; current: boolean; allowed: boolean; missing: string[] }[];
  history: { id: string; from: string | null; to: string; toSemantic: StageSemantic; actorType: string; actorName: string | null; reason: string | null; at: string }[];
  losses: { id: string; reasonCode: LossReasonCode; details: string | null; competitor: string | null; revisitAt: string | null; evidenceQuote: string | null; suggested: boolean; lostAt: string; reopenedAt: string | null }[];
  lossSuggestion: { code: LossReasonCode; quote: string } | null;
  timeline: { id: string; type: string; payload: Record<string, unknown>; actorType: string; actorName: string | null; at: string }[];
  members: { id: string; name: string }[];
}

export const HEALTH_STYLE: Record<DealHealth, { dot: string; badge: string }> = {
  HEALTHY: { dot: "bg-brand", badge: "border-brand/25 bg-brand-soft text-brand" },
  AT_RISK: { dot: "bg-amber", badge: "border-amber/30 bg-amber-soft text-amber" },
  STALLED: { dot: "bg-danger", badge: "border-danger/25 bg-danger-soft text-danger" },
  CLOSED: { dot: "bg-faint", badge: "" },
};

export const RISK_STYLE: Record<Risk["severity"], string> = {
  HIGH: "text-danger",
  MEDIUM: "text-amber",
  LOW: "text-muted",
};

/** Money from minor units; null means "not known yet" — shown as such, never as 0. */
export function formatMoney(minor: number | null | undefined, currency = "USD"): string {
  if (minor == null) return "Value TBD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
  } catch {
    return `${(minor / 100).toLocaleString()} ${currency}`;
  }
}

/** A per-currency total ({ USD: 450000 }) as text; empty → "—". */
export function formatTotals(by: Record<string, number>): string {
  const parts = Object.entries(by).map(([cur, v]) => formatMoney(v, cur));
  return parts.length ? parts.join(" + ") : "—";
}

export const KEY_SHORT: Record<QualificationKey, string> = {
  NEED: "Need",
  TIMELINE: "Time",
  BUDGET: "Budget",
  AUTHORITY: "Decider",
  DECISION_PROCESS: "Process",
  CURRENT_SOLUTION: "Current",
  PROJECT: "Scope",
};

export const TIMELINE_LABEL: Record<string, string> = {
  OpportunityCreated: "Opportunity created",
  OpportunityUpdated: "Details changed",
  OpportunityStageChanged: "Stage changed",
  OpportunityWon: "Won",
  OpportunityLost: "Lost",
  OpportunityReopened: "Reopened",
  OpportunityStakeholderAdded: "Stakeholder added",
  QualificationUpdated: "Qualification updated",
};
