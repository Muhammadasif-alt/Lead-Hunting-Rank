import type { CompanyContext } from './context.js';

/**
 * Deterministic validators around the model (docs/08 §98). They can reject an AI answer; they never repair one. A
 * failed blocking check means nothing from that answer is stored except the decision that it was rejected.
 */
export interface ValidationResult {
  validator: string;
  ok: boolean;
  detail: string;
  /** false = noted in the decision but the answer is still usable (e.g. a soft style issue). */
  blocking?: boolean;
}

const ok = (validator: string, detail = 'ok'): ValidationResult => ({ validator, ok: true, detail });
const fail = (validator: string, detail: string, blocking = true): ValidationResult => ({ validator, ok: false, detail, blocking });

/** Every evidence id cited exists in the context the agent was given (ClaimGroundingValidator). */
export function grounded(label: string, evidenceIds: string[], ctx: CompanyContext, { required = true } = {}): ValidationResult {
  const known = new Set(ctx.evidence.map((e) => e.id));
  if (required && evidenceIds.length === 0) return fail('grounding', `${label}: cites no evidence`);
  const unknown = evidenceIds.filter((id) => !known.has(id));
  return unknown.length ? fail('grounding', `${label}: cites evidence that does not exist for this company (${unknown.slice(0, 3).join(', ')})`) : ok('grounding');
}

const HEDGE = /\b(?:may|might|could|possibly|perhaps|likely|appears?|seems?)\b/i;
const CERTAIN = /\b(?:definitely|certainly|guaranteed?|proven|undoubtedly|100%|will (?:double|triple|increase))\b/i;

/** A hypothesis is a possibility, worded as one (docs/08 §27). */
export function hedged(label: string, text: string): ValidationResult {
  if (CERTAIN.test(text)) return fail('hedging', `${label}: claims certainty ("${CERTAIN.exec(text)![0]}")`);
  return HEDGE.test(text) ? ok('hedging') : fail('hedging', `${label}: states a guess as fact — must say may/might/could`);
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL = /\bhttps?:\/\/[^\s"')]+/gi;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;

/**
 * No contact detail or link the context does not contain (ContactValidityValidator). Stops a model from inventing an
 * email — or repeating one planted in untrusted page text that we never recorded as a contact point.
 */
export function noInventedContacts(label: string, text: string, ctx: CompanyContext): ValidationResult {
  const knownEmails = new Set([...ctx.companyContacts, ...ctx.people.flatMap((p) => p.emails)].map((c) => c.value.toLowerCase()));
  const knownDigits = new Set([ctx.company.phone, ...ctx.companyContacts.map((c) => c.value)].filter(Boolean).map((v) => v!.replace(/\D/g, '')));
  const domain = ctx.company.website?.toLowerCase() ?? null;
  for (const m of text.match(EMAIL) ?? []) if (!knownEmails.has(m.toLowerCase())) return fail('contact_validity', `${label}: mentions an email we do not hold (${m})`);
  for (const m of text.match(URL) ?? []) {
    let host = '';
    try {
      host = new globalThis.URL(m).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      /* not a URL */
    }
    if (!domain || (host !== domain && !host.endsWith(`.${domain}`))) return fail('contact_validity', `${label}: links somewhere other than the company website (${m})`);
  }
  for (const m of text.match(PHONE) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 9 && !knownDigits.has(digits) && ![...knownDigits].some((k) => k.endsWith(digits) || digits.endsWith(k))) return fail('contact_validity', `${label}: mentions a phone number we do not hold`);
  }
  return ok('contact_validity');
}

/** Ids the model refers to must be ids we gave it. */
export function knownIds(label: string, ids: (string | null | undefined)[], allowed: Iterable<string>): ValidationResult {
  const set = new Set(allowed);
  const bad = ids.filter((id): id is string => !!id && !set.has(id));
  return bad.length ? fail('known_ids', `${label}: refers to unknown records (${bad.slice(0, 3).join(', ')})`) : ok('known_ids');
}

export function lengthCap(label: string, text: string, max: number): ValidationResult {
  return text.length <= max ? ok('length') : fail('length', `${label}: ${text.length} characters (max ${max})`);
}

export const blockingFailures = (results: ValidationResult[]) => results.filter((r) => !r.ok && r.blocking !== false);
