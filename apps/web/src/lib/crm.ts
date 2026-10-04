/** Shapes of the CRM API (`/api/v1/companies`, `/duplicates`) and display helpers shared by the Company screens. */

export type CompanyStatus =
  "DISCOVERED" | "RESEARCHING" | "ACTIVE" | "CUSTOMER" | "FORMER_CUSTOMER" | "DISQUALIFIED" | "ARCHIVED";
export type Freshness = "FRESH" | "AGING" | "STALE";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";

export interface Company {
  id: string;
  displayName: string;
  legalName: string | null;
  websiteDomain: string | null;
  phone: string | null;
  status: CompanyStatus;
  industry: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  employeeRange: string | null;
  foundedYear: number | null;
  mergedIntoId: string | null;
  mergedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CompanyRow extends Company {
  peopleCount: number;
  evidenceCount: number;
  lastObservedAt: string | null;
  freshness: Freshness | null;
  openDuplicates: number;
}

export interface MatchSignal {
  kind: string;
  detail: string;
  weight: number;
}

export interface ContactPoint {
  id: string;
  type: "EMAIL" | "PHONE" | "MOBILE" | "BUSINESS_PHONE" | "OTHER";
  value: string;
  normalizedValue: string;
  label: string | null;
  status: "UNVERIFIED" | "VERIFIED" | "INVALID" | "STALE";
  confidence: Confidence;
  isPrimary: boolean;
  firstSeenAt: string;
  verification: { status: string; provider: string; verifiedAt: string } | null;
}

export interface EvidenceItem {
  id: string;
  evidenceType: string;
  sourceType: string;
  sourceName: string | null;
  sourceUrl: string | null;
  provider: string | null;
  observedAt: string;
  excerpt: string | null;
  confidence: Confidence;
  freshness: Freshness;
  factCount?: number;
}

export interface FactItem {
  id: string;
  field: string;
  factType: string;
  value: unknown;
  status: "ACTIVE" | "CONFLICTED";
  confidence: Confidence;
  firstObservedAt: string;
  lastConfirmedAt: string;
  freshness: Freshness;
  evidence: EvidenceItem[];
}

export interface PersonRow {
  employmentId: string;
  title: string | null;
  department: string | null;
  seniority: string | null;
  isCurrent: boolean;
  startedAt: string | null;
  endedAt: string | null;
  person: { id: string; fullName: string; linkedinUrl: string | null; timezone: string | null; version: number };
  contactPoints: ContactPoint[];
}

export interface Overview {
  company: Company & { createdBy: { id: string; name: string } | null };
  mergedInto: { id: string; displayName: string } | null;
  mergedFrom: { id: string; displayName: string; mergedAt: string }[];
  aliases: {
    id: string;
    type: "NAME" | "DOMAIN" | "PHONE";
    value: string;
    normalizedValue: string;
    source: string | null;
  }[];
  externalIds: { id: string; provider: string; externalId: string; externalUrl: string | null; lastSeenAt: string }[];
  contactPoints: ContactPoint[];
  people: PersonRow[];
  facts: FactItem[];
  evidence: EvidenceItem[];
  sources: { source: string; sourceType: string; count: number; lastObservedAt: string }[];
  duplicates: {
    candidateId: string;
    version: number;
    score: number;
    confidence: Confidence;
    matching: MatchSignal[];
    conflicting: MatchSignal[];
    other: (Company & { peopleCount: number }) | null;
  }[];
  quality: {
    evidenceCount: number;
    factCount: number;
    conflictedFacts: number;
    staleFacts: number;
    lastObservedAt: string | null;
    freshness: Freshness | null;
    emails: number;
    phones: number;
    verifiedContacts: number;
    currentPeople: number;
  };
  allowedActions: {
    edit: boolean;
    archive: boolean;
    restore: boolean;
    managePeople: boolean;
    manageContacts: boolean;
    recordEvidence: boolean;
    resolveDuplicates: boolean;
    findDuplicates: boolean;
  };
}

export const STATUS_LABEL: Record<CompanyStatus, string> = {
  DISCOVERED: "Discovered",
  RESEARCHING: "Researching",
  ACTIVE: "Active",
  CUSTOMER: "Customer",
  FORMER_CUSTOMER: "Former customer",
  DISQUALIFIED: "Disqualified",
  ARCHIVED: "Archived",
};

export const FRESHNESS: Record<Freshness, { label: string; className: string; hint: string }> = {
  FRESH: {
    label: "Fresh",
    className: "border-brand/25 bg-brand-soft text-brand",
    hint: "Observed in the last 90 days",
  },
  AGING: { label: "Aging", className: "border-amber/30 bg-amber-soft text-amber", hint: "Observed 90–180 days ago" },
  STALE: {
    label: "Stale",
    className: "border-danger/30 bg-danger-soft text-danger",
    hint: "Older than 180 days — re-check",
  },
};

export const CONFIDENCE_CLASS: Record<Confidence, string> = {
  HIGH: "border-brand/25 bg-brand-soft text-brand",
  MEDIUM: "border-amber/30 bg-amber-soft text-amber",
  LOW: "",
};

export function location(c: Pick<Company, "city" | "region" | "country">): string {
  return [c.city, c.region, c.country].filter(Boolean).join(", ");
}

/** "+15125550100" → "(512) 555-0100" for North American numbers; other E.164 numbers are shown as stored. */
export function formatPhone(phone: string | null): string | null {
  const m = phone?.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

/** "employee_range" → "Employee range" */
export function fieldLabel(field: string): string {
  const s = field.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 60 ? `${d}d ago` : formatDate(iso);
}
