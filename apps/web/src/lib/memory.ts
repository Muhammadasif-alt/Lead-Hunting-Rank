import type { KnowledgeAnswer } from "@revenue-os/shared";

export interface MemoryRow {
  id: string;
  companyId: string;
  company: string | null;
  entityType: "COMPANY" | "PERSON" | "CONVERSATION" | "OPPORTUNITY";
  entityId: string;
  key: string;
  label: string;
  value: string;
  summary: string;
  origin: string;
  originLabel: string;
  confidence: string;
  status: string;
  statusReason: string | null;
  useInOutreach: boolean;
  observedAt: string;
  lastConfirmedAt: string;
  recheckAfter: string | null;
  validUntil: string | null;
  updatedAt: string;
  quote?: string | null;
  where?: string;
}

export interface MemoryOverview {
  health: { active: number; highConfidence: number; stale: number; conflicting: number; review: number; total: number; freshPercent: number; stalePercent: number; conflictPercent: number; staleOnDeals: number };
  attention: { kind: string; company: string | null; companyId: string | null; text: string; href: string }[];
  commitmentsDue: number;
  recent: MemoryRow[];
}

export interface Candidate {
  id: string;
  companyId: string;
  company: string | null;
  key: string;
  label: string;
  value: string;
  summary: string;
  quote: string | null;
  origin: string;
  confidence: string;
  entityType: string;
  reason: string | null;
  createdAt: string;
}

export interface MemoryConflictRow {
  id: string;
  companyId: string;
  company: string | null;
  key: string;
  label: string;
  a: { id: string; value: string; origin: string; observedAt: string; quote: string | null } | null;
  b: { id: string; value: string; origin: string; observedAt: string; quote: string | null } | null;
  detectedAt: string;
}

export interface CommitmentRow {
  id: string;
  companyId: string;
  company: string | null;
  conversationId: string | null;
  opportunityId: string | null;
  direction: "WE_PROMISED" | "PROSPECT_PROMISED" | "MUTUAL";
  title: string;
  detail: string | null;
  dueAt: string | null;
  status: string;
  origin: string;
  quote: string | null;
  owner: string | null;
  overdue: boolean;
  dueToday: boolean;
  completedAt: string | null;
  completionEvidence: string | null;
  statusReason: string | null;
  createdAt: string;
}

export interface RelationshipRow {
  id: string;
  companyId: string;
  company: string | null;
  from: string;
  to: string;
  label: string;
  type: string;
  status: string;
  confidence: string;
  quote: string | null;
  context: string | null;
  createdAt: string;
}

export interface MemoryDetail {
  memory: MemoryRow;
  why: { type: string; usedFor: string; source: string; retention: string; outreach: string };
  evidence: { id: string; sourceType: string; sourceId: string | null; quote: string | null; observedAt: string; message: { id: string; conversationId: string; fromEmail: string | null; occurredAt: string; subject: string } | null }[];
  history: MemoryRow[];
  conflicts: { id: string; status: string; resolution: string | null; conflictType: string; detectedAt: string }[];
  audit: { at: string; action: string; actorType: string; reason: string | null }[];
}

export interface CompanyMemory {
  company: { id: string; displayName: string };
  health: { stale: number; conflicts: number; openCommitments: number; overdue: number; review: number };
  layers: { facts: number; hypotheses: number };
  statements: MemoryRow[];
  notes: MemoryRow[];
  inferences: MemoryRow[];
  candidates: Candidate[];
  conflicts: MemoryConflictRow[];
  commitments: CommitmentRow[];
  relationships: RelationshipRow[];
  opportunities: { id: string; name: string; status: string }[];
  people: { id: string; name: string }[];
}

export interface AiContext {
  questions: string[];
  memories: { id: string; key: string; label: string; value: string; origin: string; confidence: string; scope: string; observedAt: string; outreach: boolean }[];
  commitments: { id: string; direction: string; title: string; dueAt: string | null; status: string; overdue: boolean }[];
  memoryConflicts: { key: string; label: string; values: string[] }[];
  knowledge: { answers: KnowledgeAnswer[]; semantic: boolean; controls: { pricingAnswers: boolean; technicalClaims: boolean }; used: { code: string; version: number; title: string }[]; approvedItems: number; profile: unknown };
  notIncluded: { label: string; reason: string }[];
}

export const MSTATUS_STYLE: Record<string, string> = {
  ACTIVE: "border-tone/30 bg-tone-soft text-tone",
  STALE: "border-amber/30 bg-amber-soft text-amber",
  CONFLICTED: "border-danger/30 bg-danger-soft text-danger",
  SUPERSEDED: "text-faint",
  INVALIDATED: "text-faint line-through",
  ARCHIVED: "text-faint",
};

export const ORIGIN_STYLE: Record<string, string> = {
  DIRECT_STATEMENT: "border-tone/30 bg-tone-soft text-tone",
  MEETING_NOTE: "border-tone/30 bg-tone-soft text-tone",
  HUMAN_CORRECTION: "border-tone/30 bg-tone-soft text-tone",
  HUMAN_NOTE: "",
  AI_INFERENCE: "border-amber/30 bg-amber-soft text-amber",
};

export const WHO: Record<string, string> = { WE_PROMISED: "We promised", PROSPECT_PROMISED: "They promised", MUTUAL: "Agreed" };

export function dueOf(c: { dueAt: string | null; overdue: boolean; dueToday: boolean; status: string }): string {
  if (c.status === "COMPLETED") return "Done";
  if (!c.dueAt) return "No date";
  const d = new Date(c.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return c.overdue ? `Overdue · ${d}` : c.dueToday ? "Due today" : `Due ${d}`;
}
