import type { KnowledgeAnswer, KnowledgeType } from "@revenue-os/shared";

export type Level = "GOOD" | "MEDIUM" | "WEAK";

export interface KnowledgeOverview {
  status: "HEALTHY" | "FAIR" | "NEEDS_ATTENTION" | "EMPTY";
  counts: { approved: number; drafts: number; stale: number; conflicts: number; gaps: number; disabled: number };
  readiness: { percent: number; questions: number; answered: number } | null;
  health: {
    coverage: { level: Level; detail: string };
    freshness: { level: Level; detail: string };
    conflicts: { count: number };
    gaps: { count: number };
    pricingReadiness: { level: Level; detail: string };
    integrationCoverage: { level: Level; detail: string };
  };
  perType: { type: KnowledgeType; label: string; approved: number; total: number }[];
  controls: { pricingAnswers: boolean; technicalClaims: boolean };
  attention: { kind: string; text: string; href: string }[];
  mostUsed: { id: string; code: string; title: string; answers: number }[];
  lowConfidenceTopics: { topic: string; label: string; asked: number }[];
  profileId: string | null;
}

export interface KnowledgeListItem {
  id: string;
  code: string;
  type: KnowledgeType;
  title: string;
  status: string;
  version: number | null;
  content: Record<string, unknown>;
  draft: { status: string; version: number; origin: string; effectiveFrom: string | null } | null;
  scheduled: { version: number; effectiveFrom: string | null }[];
  aiDisabled: boolean;
  needsReview: boolean;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
  usageCount: number;
  conflicts: number;
  serviceItemId: string | null;
}

export interface Revision {
  id: string;
  version: number;
  status: string;
  origin: string;
  title: string;
  changeNote: string | null;
  effectiveFrom: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  publishedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  createdBy: string | null;
  rejectedReason: string | null;
  content: Record<string, unknown>;
  current: boolean;
}

export interface KnowledgeDetail {
  item: {
    id: string;
    code: string;
    type: KnowledgeType;
    title: string;
    status: string;
    authorityLevel: number;
    currentRevisionId: string | null;
    serviceItemId: string | null;
    reviewIntervalDays: number | null;
    lastReviewedAt: string | null;
    nextReviewAt: string | null;
    aiDisabled: boolean;
    aiDisabledReason: string | null;
    needsReview: boolean;
    needsReviewReason: string | null;
    usageCount: number;
    typeInfo: { label: string; plural: string; commercial: boolean; description: string };
  };
  current: { id: string; version: number; content: Record<string, unknown>; text: string; approvedAt: string | null } | null;
  draft: { id: string; version: number; status: string; origin: string; content: Record<string, unknown>; effectiveFrom: string | null; changeNote: string | null; sourceIds: string[]; gapId: string | null } | null;
  scheduled: { id: string; version: number; effectiveFrom: string | null }[];
  revisions: Revision[];
  conflicts: { id: string; topic: string; conflictType: string; detail: string; status: string; resolution: string | null; detectedAt: string; other: { id: string; code: string; title: string } | null }[];
  usage: { at: string; version: number; question: string | null; conversationId: string | null; company: string | null }[];
  feedback: Record<string, number>;
  audit: { at: string; action: string; by: string | null; reason: string | null }[];
  children: { id: string; code: string; type: KnowledgeType; title: string; status: string }[];
  service: { id: string; code: string; title: string } | null;
  sources: { id: string; fileName: string; uploadedAt: string }[];
  gaps: { id: string; question: string; occurrences: number; status: string }[];
}

export interface ReviewQueue {
  drafts: { revisionId: string; itemId: string; code: string; type: KnowledgeType; title: string; version: number; status: string; origin: string; isUpdate: boolean; effectiveFrom: string | null; createdAt: string; source: string | null; priority: string }[];
  conflicts: { id: string; topic: string; conflictType: string; detail: string; detectedAt: string; item: { id: string; code: string; title: string } | null; other: { id: string; code: string; title: string } | null; priority: string }[];
  stale: { id: string; code: string; type: KnowledgeType; title: string; status: string; needsReviewReason: string | null; nextReviewAt: string | null; usageCount: number; priority: string }[];
}

export interface Gap {
  id: string;
  question: string;
  topic: string;
  topicLabel: string;
  occurrences: number;
  conversations: number;
  companies: string[];
  openDeals: number;
  pipelineMinor: number;
  status: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  draft: { id: string; code: string; status: string } | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DocumentRow {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  statusReason: string | null;
  candidates: number;
  conflicts: number;
  uploadedAt: string;
  processedAt: string | null;
  uploadedBy: string | null;
}

export interface Simulation {
  outcome: "ANSWER" | "PARTIAL" | "ESCALATE";
  answers: KnowledgeAnswer[];
  proposed: string | null;
  escalate: { question: string; reason: string }[];
  gaps: string[];
  conflicts: string[];
  semantic: boolean;
  approvedItems: number;
}

export const LEVEL_STYLE: Record<Level, string> = {
  GOOD: "border-tone/30 bg-tone-soft text-tone",
  MEDIUM: "border-amber/30 bg-amber-soft text-amber",
  WEAK: "border-danger/30 bg-danger-soft text-danger",
};

export const KSTATUS_STYLE: Record<string, string> = {
  APPROVED: "border-tone/30 bg-tone-soft text-tone",
  DRAFT: "",
  IN_REVIEW: "border-amber/30 bg-amber-soft text-amber",
  STALE: "border-amber/30 bg-amber-soft text-amber",
  CONFLICT: "border-danger/30 bg-danger-soft text-danger",
  REJECTED: "text-faint",
  ARCHIVED: "text-faint",
  SUPERSEDED: "text-faint",
};

export const ORIGIN_LABEL: Record<string, string> = {
  HUMAN: "Written by a person",
  DOCUMENT: "From a document",
  HUMAN_ANSWER: "From a person’s reply",
  AI_DRAFT: "AI draft",
  ROLLBACK: "Restored",
};

/** The library tabs, in screen order (screen #13 main screen). */
export const LIBRARY: { tab: string; type: KnowledgeType }[] = [
  { tab: "services", type: "SERVICE" },
  { tab: "pricing", type: "PRICING" },
  { tab: "faqs", type: "FAQ" },
  { tab: "policies", type: "POLICY" },
  { tab: "integrations", type: "INTEGRATION" },
  { tab: "cases", type: "CASE_STUDY" },
  { tab: "competitors", type: "COMPETITOR" },
  { tab: "claims", type: "CLAIM" },
  { tab: "blocks", type: "PROPOSAL_BLOCK" },
];

export function dateOf(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function agoOf(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 60) return `${d} days ago`;
  return `${Math.round(d / 30)} months ago`;
}

export function bytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Raw upload (application/octet-stream) — the API keeps JSON bodies small. */
export async function uploadFile(file: File): Promise<{ id: string; fileName: string; status: string; duplicate: boolean }> {
  const res = await fetch("/api/v1/knowledge/documents", {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name), "x-file-type": file.type || "application/octet-stream" },
    body: file,
  });
  const body = (await res.json().catch(() => null)) as { data?: { id: string; fileName: string; status: string; duplicate: boolean }; error?: { message: string } } | null;
  if (!res.ok) throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
  return body!.data!;
}
