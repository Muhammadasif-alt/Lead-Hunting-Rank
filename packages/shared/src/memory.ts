/**
 * Sales memory (docs/13 §4-29, screen #12). Browser-safe rules: which record a statement belongs to (a deal's budget
 * never becomes the person's), how long it stays true, whether it is accepted on its own or waits for a person, what
 * happens when it disagrees with what we knew — and promises, ours and theirs, read from the words.
 *
 * Messages are not memory; facts, signals and suppression are not memory. Memory is entity-scoped, sourced and
 * time-aware; extraction proposes, validation decides.
 */
import type { ExtractedFact, Intent, ObjectionType } from './conversations.js';
import { OBJECTION_INFO, sentencesOf } from './conversations.js';

export type MemoryScopeKey = 'COMPANY' | 'PERSON' | 'CONVERSATION' | 'OPPORTUNITY';
export type MemoryTypeKey = 'COMPANY' | 'PERSON' | 'CONVERSATION' | 'RELATIONSHIP' | 'OPPORTUNITY' | 'PREFERENCE';

export interface MemoryKeyInfo {
  label: string;
  /** DEAL = the opportunity when there is one, otherwise the conversation (docs/13 §7-14 scope example). */
  scope: MemoryScopeKey | 'DEAL';
  memoryType: MemoryTypeKey;
  /** AUTO = a clear direct statement is accepted on its own; REVIEW = a person confirms (budget, authority). */
  review: 'AUTO' | 'REVIEW';
  /** One current value (a newer one supersedes or conflicts) vs. a list (questions, objections, needs). */
  single: boolean;
  /** When disagreeing values meet: the newer direct statement wins, or both wait for a person. */
  onConflict: 'NEWER_WINS' | 'REVIEW';
  /** Re-check after N days (STALE until confirmed) — null = holds until contradicted. */
  recheckDays: number | null;
  /** Stops mattering after N days ("busy this week") — null = no expiry. */
  validDays: number | null;
  /** May personalise outreach (inferred or sensitive memory never does — screen #12 §27). */
  outreach: boolean;
  /** Used for (screen #12 §64 "Why did AI remember this?"). */
  usedFor: string;
}

export const MEMORY_KEYS: Record<string, MemoryKeyInfo> = {
  CURRENT_SOLUTION: { label: 'Current solution', scope: 'COMPANY', memoryType: 'COMPANY', review: 'AUTO', single: true, onConflict: 'NEWER_WINS', recheckDays: 180, validDays: null, outreach: true, usedFor: 'Positioning and objections' },
  ROLE: { label: 'Role / decision authority', scope: 'PERSON', memoryType: 'PERSON', review: 'AUTO', single: true, onConflict: 'REVIEW', recheckDays: 365, validDays: null, outreach: true, usedFor: 'Who decides, who to address' },
  DECISION_PROCESS: { label: 'Decision process', scope: 'DEAL', memoryType: 'OPPORTUNITY', review: 'AUTO', single: false, onConflict: 'NEWER_WINS', recheckDays: 120, validDays: null, outreach: false, usedFor: 'Qualification and meeting preparation' },
  BUDGET: { label: 'Budget', scope: 'DEAL', memoryType: 'OPPORTUNITY', review: 'REVIEW', single: true, onConflict: 'REVIEW', recheckDays: 90, validDays: null, outreach: false, usedFor: 'Qualification and proposals (never quoted back)' },
  TIMELINE: { label: 'Timeline', scope: 'DEAL', memoryType: 'OPPORTUNITY', review: 'AUTO', single: true, onConflict: 'NEWER_WINS', recheckDays: null, validDays: 150, outreach: true, usedFor: 'Timing the next step' },
  NEED: { label: 'Need', scope: 'DEAL', memoryType: 'OPPORTUNITY', review: 'AUTO', single: false, onConflict: 'NEWER_WINS', recheckDays: 180, validDays: null, outreach: true, usedFor: 'Qualification, replies and the brief' },
  OBJECTION: { label: 'Objection', scope: 'CONVERSATION', memoryType: 'CONVERSATION', review: 'AUTO', single: false, onConflict: 'NEWER_WINS', recheckDays: null, validDays: 365, outreach: false, usedFor: 'Not asking them to repeat it' },
  QUESTION: { label: 'Question asked', scope: 'CONVERSATION', memoryType: 'CONVERSATION', review: 'AUTO', single: false, onConflict: 'NEWER_WINS', recheckDays: null, validDays: 180, outreach: false, usedFor: 'Knowing what was asked (and answered)' },
  MEETING_PREFERENCE: { label: 'Meeting preference', scope: 'PERSON', memoryType: 'PREFERENCE', review: 'AUTO', single: true, onConflict: 'NEWER_WINS', recheckDays: null, validDays: null, outreach: true, usedFor: 'Offering times that suit them' },
  PREFERRED_CHANNEL: { label: 'Preferred channel', scope: 'PERSON', memoryType: 'PREFERENCE', review: 'AUTO', single: true, onConflict: 'NEWER_WINS', recheckDays: null, validDays: null, outreach: true, usedFor: 'How to reach them' },
  CONTACT_LATER: { label: 'Contact again', scope: 'CONVERSATION', memoryType: 'CONVERSATION', review: 'AUTO', single: true, onConflict: 'NEWER_WINS', recheckDays: null, validDays: null, outreach: false, usedFor: 'Not contacting them before they asked' },
  NOTE: { label: 'Note', scope: 'COMPANY', memoryType: 'COMPANY', review: 'AUTO', single: false, onConflict: 'NEWER_WINS', recheckDays: null, validDays: null, outreach: false, usedFor: 'Internal context only' },
};

export const MEMORY_ORIGIN_INFO: Record<string, { label: string; description: string }> = {
  DIRECT_STATEMENT: { label: 'They said', description: 'The prospect said it — highest-value memory' },
  MEETING_NOTE: { label: 'Meeting note', description: 'Recorded after a meeting by a colleague' },
  HUMAN_NOTE: { label: 'Human note', description: 'A colleague’s note — not a verified prospect fact' },
  HUMAN_CORRECTION: { label: 'Corrected', description: 'A colleague corrected an earlier memory' },
  AI_INFERENCE: { label: 'AI inference', description: 'A possibility — never quoted as fact' },
};

export const MEMORY_STATUS_INFO: Record<string, { label: string; description: string }> = {
  ACTIVE: { label: 'Active', description: 'Current' },
  STALE: { label: 'Needs revalidation', description: 'Old enough to check again before use' },
  CONFLICTED: { label: 'Conflict', description: 'Disagrees with another memory — a person resolves it' },
  SUPERSEDED: { label: 'History', description: 'Replaced by a newer statement (kept as history)' },
  INVALIDATED: { label: 'Marked incorrect', description: 'A person marked it wrong — the AI no longer uses it' },
  ARCHIVED: { label: 'Archived', description: 'Expired or no longer relevant' },
};

export const COMMITMENT_STATUS_INFO: Record<string, string> = {
  OPEN: 'Open',
  WAITING: 'Waiting',
  DUE: 'Due',
  COMPLETED: 'Done',
  BROKEN: 'Broken',
  CANCELLED: 'Cancelled',
};

export const RELATIONSHIP_LABEL: Record<string, string> = {
  WORKS_AT: 'works at',
  FORMERLY_WORKED_AT: 'formerly worked at',
  REFERRED_BY: 'referred us to',
  INTRODUCED_BY: 'introduced',
  REPORTS_TO: 'reports to',
  DECISION_MAKER_FOR: 'decides for',
  INFLUENCER_FOR: 'influences',
  PARTNER_OF: 'partner of',
  RELATED_COMPANY: 'related to',
};

const DAY = 86_400_000;
export const memoryKeyInfo = (key: string): MemoryKeyInfo => MEMORY_KEYS[key] ?? MEMORY_KEYS.NOTE!;

export function memoryTiming(key: string, observedAt: Date, value?: string): { recheckAfter: Date | null; validUntil: Date | null } {
  const k = memoryKeyInfo(key);
  let validUntil = k.validDays ? new Date(observedAt.getTime() + k.validDays * DAY) : null;
  // "Contact me after January": the date itself is the meaning; it stops mattering a month after.
  if (key === 'CONTACT_LATER' && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) validUntil = new Date(new Date(`${value}T00:00:00.000Z`).getTime() + 30 * DAY);
  return { recheckAfter: k.recheckDays ? new Date(observedAt.getTime() + k.recheckDays * DAY) : null, validUntil };
}

/** Same value? Case/space-insensitive, or one contains the other ("Jobber" vs "We use Jobber"). */
export function sameMemoryValue(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%]+/g, ' ').trim();
  const x = n(a);
  const y = n(b);
  return x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)));
}

export interface MemoryProposal {
  key: string;
  scope: MemoryScopeKey;
  memoryType: MemoryTypeKey;
  value: string;
  summary: string;
  quote: string;
}

const ROLE_DIRECT = /\b(i'?m|i am) (the )?(owner|founder|co-?founder|ceo|president|managing director|general manager|gm|office manager|marketing manager|operations manager)\b|\bi own (the|this) (business|company)\b/i;
const DECIDES_WITH = /\b(need to (ask|check with|talk to|run it by|speak (to|with))|(my|our) (partner|boss|manager|owner|wife|husband|co-?owner|business partner) (decides|makes the call|has to (approve|sign off))|decide together)\b/i;
const CHANNEL: [RegExp, string][] = [
  [/\b(call me( instead)?|give me a (call|ring)|prefer (a )?(call|phone)|phone is (better|best|easier)|easier to (talk|chat) (on|over) the phone)\b/i, 'Phone'],
  [/\b(prefer (email|e-mail)|email (is|works) (best|better|fine)|(please )?keep it (to|on) email|rather (do|keep) (this|it) (over|by|on) email|don'?t call)\b/i, 'Email'],
  [/\b(text me|prefer (a )?text|sms is (better|best))\b/i, 'Text message'],
];
const ROLE_NAME = /\b(owner|founder|co-?founder|ceo|president|managing director|general manager|gm|office manager|marketing manager|operations manager)\b/i;

/**
 * Memory proposals from one message as the Inbox read it (docs/13 §4-6): stated facts with their exact words, mapped to
 * the right record. "Thanks!" proposes nothing. The extraction proposes; acceptance is decided elsewhere.
 */
export function memoryFromReading(input: { text: string; primaryIntent: Intent; extracted: ExtractedFact[]; objections: { type: ObjectionType; text: string }[]; questions: string[] }, ctx: { hasOpportunity: boolean; hasPerson: boolean }): MemoryProposal[] {
  if (['UNSUBSCRIBE', 'OUT_OF_OFFICE', 'AUTOMATED'].includes(input.primaryIntent)) return [];
  const out: MemoryProposal[] = [];
  const deal: MemoryScopeKey = ctx.hasOpportunity ? 'OPPORTUNITY' : 'CONVERSATION';
  const person = (fallback: MemoryScopeKey): MemoryScopeKey => (ctx.hasPerson ? 'PERSON' : fallback);
  const push = (key: string, value: string, quote: string, scopeOverride?: MemoryScopeKey) => {
    const k = memoryKeyInfo(key);
    const scope = scopeOverride ?? (k.scope === 'DEAL' ? deal : k.scope === 'PERSON' ? person('CONVERSATION') : k.scope);
    const v = value.trim().replace(/[.!]+$/, '').slice(0, 200);
    if (!v || out.some((o) => o.key === key && sameMemoryValue(o.value, v))) return;
    out.push({ key, scope, memoryType: k.memoryType, value: v, summary: `${k.label}: ${v}`.slice(0, 300), quote: quote.slice(0, 400) });
  };

  for (const f of input.extracted) {
    switch (f.field) {
      case 'CURRENT_SOLUTION':
      case 'TIMELINE':
      case 'BUDGET':
      case 'NEED':
      case 'MEETING_PREFERENCE':
      case 'CONTACT_LATER':
        push(f.field, f.value, f.quote);
        break;
      case 'AUTHORITY':
        if (ROLE_DIRECT.test(f.quote)) push('ROLE', ROLE_NAME.exec(f.quote)?.[0]?.replace(/^\w/, (c) => c.toUpperCase()) ?? f.value, f.quote);
        else if (DECIDES_WITH.test(f.quote)) push('DECISION_PROCESS', f.value, f.quote);
        break;
      default:
        break;
    }
  }
  for (const [re, channel] of CHANNEL) {
    const s = sentencesOf(input.text).find((x) => re.test(x));
    if (s) {
      push('PREFERRED_CHANNEL', channel, s);
      break;
    }
  }
  for (const o of input.objections) push('OBJECTION', `${OBJECTION_INFO[o.type]} — "${o.text.replace(/[.!]+$/, '')}"`, o.text);
  for (const q of input.questions.slice(0, 3)) push('QUESTION', q, q);
  return out.slice(0, 10);
}

/** Validation (docs/13 §4-6): accept a clear direct statement on its own; budget, authority conflicts and anything unsure wait. */
export function candidateDecision(key: string, confidence: 'HIGH' | 'MEDIUM' | 'LOW', origin: string): { accept: boolean; reason: string | null } {
  const k = memoryKeyInfo(key);
  if (origin === 'HUMAN_NOTE' || origin === 'HUMAN_CORRECTION') return { accept: true, reason: null };
  if (k.review === 'REVIEW') return { accept: false, reason: `${k.label} is high-impact — a person confirms it` };
  if (confidence === 'LOW') return { accept: false, reason: 'The reading was unsure — a person confirms it' };
  return { accept: true, reason: null };
}

// ───────────────────────────── promises (docs/13 §23-27) ─────────────────────────────

export interface PromiseFound {
  title: string;
  quote: string;
  dueAt: Date | null;
}

const WE = /\b(i|we)(['’]ll| will| shall|['’]m going to| are going to| am going to)\s+(send|get back|come back|follow up|check|confirm|share|forward|prepare|put together|draft|email|call|look into|find out|update)\b/i;
const THEY = /\b(i|we)(['’]ll| will|['’]m going to| are going to| am going to)\s+(send|get back|talk to|check with|run it by|speak (to|with)|share|forward|look (at|into)|have a look|let you know|review|discuss|think about|get you|loop in|introduce)\b/i;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "tomorrow", "by Friday", "next week", "end of the month", "in 3 days" → a due time (17:00 UTC), or null. */
export function dueFrom(text: string, now: Date): Date | null {
  const t = text.toLowerCase();
  const at = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17));
  if (/\b(today|this afternoon|tonight|end of (the )?day|eod)\b/.test(t)) return at(now);
  if (/\btomorrow\b/.test(t)) return at(new Date(now.getTime() + DAY));
  const n = /\bin (\d{1,2}|a couple of|a few) days?\b/.exec(t);
  if (n) return at(new Date(now.getTime() + (n[1] === 'a couple of' ? 2 : n[1] === 'a few' ? 3 : Number(n[1])) * DAY));
  const wd = new RegExp(`\\b(by|on|this|next)?\\s*(${WEEKDAYS.join('|')})\\b`).exec(t);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[2]!);
    const diff = (target - now.getUTCDay() + 7) % 7 || 7;
    return at(new Date(now.getTime() + diff * DAY));
  }
  if (/\b(this week|end of (the )?week|by the weekend)\b/.test(t)) return at(new Date(now.getTime() + (((5 - now.getUTCDay() + 7) % 7) || 0) * DAY));
  if (/\bnext week\b/.test(t)) return at(new Date(now.getTime() + 7 * DAY));
  if (/\bend of (the )?month\b/.test(t)) return at(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
  if (/\bnext month\b/.test(t)) return at(new Date(now.getTime() + 30 * DAY));
  return null;
}

/** Business days ahead (skips Saturday and Sunday), at 17:00 UTC. */
export function businessDaysAhead(now: Date, days: number): Date {
  let d = new Date(now.getTime());
  let left = days;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17));
}

/**
 * Promises in a message (docs/13 §23-27 "Promise extraction"): ours in what we send ("I'll send you the pricing sheet
 * tomorrow"), theirs in what they write ("I'll talk to my partner and get back to you by Friday").
 */
export function promisesIn(text: string, side: 'OURS' | 'THEIRS', now: Date): PromiseFound[] {
  const re = side === 'OURS' ? WE : THEY;
  const out: PromiseFound[] = [];
  for (const s of sentencesOf(text.replace(/^>.*$/gm, ''))) {
    if (!re.test(s) || /\?$/.test(s) || /\b(if you|would you|could you|let me know if)\b/i.test(s.slice(0, 20))) continue;
    const clause = s.slice(re.exec(s)!.index).replace(/[.!]+$/, '');
    // Written from our side: in our promise "you" is the prospect; in theirs "you" is us.
    const [you, your] = side === 'OURS' ? ['them', 'their'] : ['us', 'our'];
    const title = clause.replace(/^(i|we)(['’]ll| will| shall|['’]m going to| are going to| am going to)\s+/i, '').replace(/\byou\b/gi, you).replace(/\byour\b/gi, your);
    out.push({ title: `${title[0]!.toUpperCase()}${title.slice(1)}`.slice(0, 200), quote: s.slice(0, 400), dueAt: dueFrom(s, now) });
  }
  return out.slice(0, 3);
}
