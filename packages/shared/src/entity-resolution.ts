/**
 * Entity resolution scoring (docs/04 §76, docs/17 §40-45). Pure and deterministic: given two company records it lists
 * the signals that agree and the ones that disagree, and turns them into a score and a confidence. It never decides
 * to merge — callers create an EntityMatchCandidate, and only `autoMergeSafe` pairs may be merged without a human.
 */

import { normalizeAddress } from './normalize.js';

export type MatchSignalKind =
  | 'DOMAIN'
  | 'PHONE'
  | 'NAME_EXACT'
  | 'NAME_SIMILAR'
  | 'ADDRESS'
  | 'POSTAL_CODE'
  | 'CITY'
  | 'COUNTRY'
  | 'REGION';

export interface MatchSignal {
  kind: MatchSignalKind;
  /** Human-readable, e.g. "Same website greenscape.com". */
  detail: string;
  /** Contribution to the score (negative for conflicts). */
  weight: number;
}

export type MatchConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CompanyMatch {
  score: number;
  /** null = too weak to be worth a candidate. */
  confidence: MatchConfidence | null;
  matching: MatchSignal[];
  conflicting: MatchSignal[];
  /** HIGH, no conflict at all, and the website agrees together with the name or phone. */
  autoMergeSafe: boolean;
}

/** What scoring needs from a company. Already-normalized values (normalizedName, websiteDomain, E.164 phone). */
export interface CompanyMatchRecord {
  normalizedName: string;
  websiteDomain: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  /** Extra normalized names / domains / phones known for this company (CompanyAlias). */
  aliases?: { names?: string[]; domains?: string[]; phones?: string[] };
}

/** Shared hosts — two businesses "having" facebook.com as a website says nothing about them being the same. */
const SHARED_HOSTS = new Set([
  'facebook.com', 'm.facebook.com', 'instagram.com', 'google.com', 'business.site', 'yelp.com', 'linkedin.com', 'linktr.ee',
  'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'nextdoor.com', 'angi.com', 'homeadvisor.com', 'thumbtack.com',
]);

/** True for hosts many unrelated businesses share (social pages, listing sites). */
export function isSharedHost(domain: string): boolean {
  return SHARED_HOSTS.has(domain);
}

export const MATCH_THRESHOLDS = { candidate: 30, medium: 50, high: 75 } as const;

const STRONG: ReadonlySet<MatchSignalKind> = new Set(['DOMAIN', 'PHONE', 'NAME_EXACT', 'ADDRESS']);

export function scoreCompanyMatch(a: CompanyMatchRecord, b: CompanyMatchRecord): CompanyMatch {
  const matching: MatchSignal[] = [];
  const conflicting: MatchSignal[] = [];

  // Website
  const domainsA = valueSet(a.websiteDomain, a.aliases?.domains, (d) => !SHARED_HOSTS.has(d));
  const domainsB = valueSet(b.websiteDomain, b.aliases?.domains, (d) => !SHARED_HOSTS.has(d));
  const sharedDomain = first(domainsA, domainsB);
  if (sharedDomain) matching.push({ kind: 'DOMAIN', detail: `Same website ${sharedDomain}`, weight: 45 });
  else if (domainsA.size && domainsB.size && a.websiteDomain && b.websiteDomain && !SHARED_HOSTS.has(a.websiteDomain) && !SHARED_HOSTS.has(b.websiteDomain)) {
    conflicting.push({ kind: 'DOMAIN', detail: `Different websites (${a.websiteDomain} vs ${b.websiteDomain})`, weight: -35 });
  }

  // Phone — businesses often have several numbers, so a different phone is only a weak conflict.
  const sharedPhone = first(valueSet(a.phone, a.aliases?.phones), valueSet(b.phone, b.aliases?.phones));
  if (sharedPhone) matching.push({ kind: 'PHONE', detail: `Same phone ${sharedPhone}`, weight: 35 });
  else if (a.phone && b.phone) conflicting.push({ kind: 'PHONE', detail: 'Different phone numbers', weight: -5 });

  // Name
  const namesA = valueSet(a.normalizedName, a.aliases?.names);
  const namesB = valueSet(b.normalizedName, b.aliases?.names);
  const sameName = first(namesA, namesB);
  if (sameName) matching.push({ kind: 'NAME_EXACT', detail: `Same name "${sameName}"`, weight: 30 });
  else {
    let best = 0;
    for (const x of namesA) for (const y of namesB) best = Math.max(best, nameSimilarity(x, y));
    const pct = Math.round(best * 100);
    if (best >= 0.8) matching.push({ kind: 'NAME_SIMILAR', detail: `Names ${pct}% similar`, weight: 20 });
    else if (best >= 0.6) matching.push({ kind: 'NAME_SIMILAR', detail: `Names ${pct}% similar`, weight: 10 });
    else if (best < 0.3) conflicting.push({ kind: 'NAME_SIMILAR', detail: `Names differ (${pct}% similar)`, weight: -10 });
  }

  // Location
  const addrA = a.addressLine ? normalizeAddress(a.addressLine) : null;
  const addrB = b.addressLine ? normalizeAddress(b.addressLine) : null;
  const sameCity = eq(a.city, b.city);
  const samePostal = eq(a.postalCode, b.postalCode);
  if (addrA && addrA === addrB && (samePostal || sameCity)) {
    matching.push({ kind: 'ADDRESS', detail: `Same address ${a.addressLine}`, weight: 20 });
  } else if (samePostal) {
    matching.push({ kind: 'POSTAL_CODE', detail: `Same postal code ${a.postalCode}`, weight: 5 });
  } else if (sameCity) {
    matching.push({ kind: 'CITY', detail: `Same city ${a.city}`, weight: 5 });
  }
  if (a.country && b.country && !eq(a.country, b.country)) {
    conflicting.push({ kind: 'COUNTRY', detail: `Different countries (${a.country} vs ${b.country})`, weight: -40 });
  } else if (a.region && b.region && !eq(a.region, b.region)) {
    conflicting.push({ kind: 'REGION', detail: `Different states/regions (${a.region} vs ${b.region})`, weight: -20 });
  } else if (a.city && b.city && !sameCity) {
    conflicting.push({ kind: 'CITY', detail: `Different cities (${a.city} vs ${b.city})`, weight: -15 });
  }

  const raw = [...matching, ...conflicting].reduce((s, m) => s + m.weight, 0);
  const score = Math.max(0, Math.min(100, raw));
  const strong = new Set(matching.filter((m) => STRONG.has(m.kind)).map((m) => m.kind)).size;
  const seriousConflict = conflicting.some((c) => c.weight <= -15);

  let confidence: MatchConfidence | null = null;
  if (score >= MATCH_THRESHOLDS.high && strong >= 2 && !seriousConflict) confidence = 'HIGH';
  else if (score >= MATCH_THRESHOLDS.medium) confidence = 'MEDIUM';
  else if (score >= MATCH_THRESHOLDS.candidate) confidence = 'LOW';

  const has = (k: MatchSignalKind) => matching.some((m) => m.kind === k);
  const autoMergeSafe = confidence === 'HIGH' && conflicting.length === 0 && has('DOMAIN') && (has('NAME_EXACT') || has('PHONE'));
  return { score, confidence, matching, conflicting, autoMergeSafe };
}

/** Trigram similarity in the spirit of Postgres pg_trgm (Jaccard over word trigrams), 0…1. */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

function trigrams(value: string): Set<string> {
  const out = new Set<string>();
  for (const word of value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

function valueSet(primary: string | null, extra: string[] | undefined, keep: (v: string) => boolean = () => true): Set<string> {
  return new Set([primary, ...(extra ?? [])].filter((v): v is string => !!v && keep(v)));
}

function first(a: Set<string>, b: Set<string>): string | undefined {
  for (const v of a) if (b.has(v)) return v;
  return undefined;
}

function eq(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ── Freshness (docs/screens/04 §27) ─────────────────────────────────────────────────────────────

export type Freshness = 'FRESH' | 'AGING' | 'STALE';

/** Days after which information is aging / stale. Before important outreach, stale data gets re-checked (Phase 8). */
export const FRESHNESS_DAYS = { aging: 90, stale: 180 } as const;

export function freshnessOf(observedAt: Date | string, now: Date = new Date()): Freshness {
  const days = (now.getTime() - new Date(observedAt).getTime()) / 86_400_000;
  if (days > FRESHNESS_DAYS.stale) return 'STALE';
  if (days > FRESHNESS_DAYS.aging) return 'AGING';
  return 'FRESH';
}
