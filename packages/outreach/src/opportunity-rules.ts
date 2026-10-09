import { OPEN_PATH, QUALIFICATION_INFO, type DealHealth, type LossReasonCode, type QualificationKey, type StageSemantic } from '@revenue-os/shared';

/**
 * Deterministic deal rules (docs/17 §87-92, screen #7). No pipeline spam: an opportunity needs commercial evidence;
 * a stage needs its requirements; health and the next action come from evidence — never a made-up probability.
 */

const DAY_MS = 86_400_000;

// ───────────────────────────── commercial evidence ─────────────────────────────

export interface CommercialSignal {
  strength: 'STRONG' | 'MODERATE';
  reason: string;
  quote: string | null;
}

/**
 * "Can you send examples?" is interest, not a deal. "We're looking for a new website and want it done this quarter"
 * is commercial need (screen #7 §3). STRONG = a stated need plus timing, budget, pricing or a meeting request; MODERATE
 * = one of those alone (a person decides).
 */
export function commercialSignal(known: Partial<Record<string, { value: string; quote: string }>>, intent: string | null): CommercialSignal | null {
  const need = known.NEED;
  const extra = known.TIMELINE ? 'a timeline' : known.BUDGET ? 'a budget' : intent === 'PRICING' ? 'asked about price' : intent === 'MEETING_REQUEST' ? 'asked for a meeting' : null;
  if (need && extra) return { strength: 'STRONG', reason: `Stated a need and ${extra}`, quote: need.quote };
  if (need) return { strength: 'MODERATE', reason: 'Stated a need', quote: need.quote };
  if (intent === 'PRICING') return { strength: 'MODERATE', reason: 'Asked about price', quote: null };
  if (intent === 'MEETING_REQUEST') return { strength: 'MODERATE', reason: 'Asked for a meeting', quote: null };
  return null;
}

/** Conversation facts → qualification answers. "I need to check with my partner" is about the decision process. */
export function qualificationKeyFor(field: string, quote: string): QualificationKey | null {
  if (field === 'AUTHORITY') return /\b(need to (ask|check|run)|partner|boss|manager|wife|husband|co-?owner|accountant)\b/i.test(quote) ? 'DECISION_PROCESS' : 'AUTHORITY';
  if (field === 'NEED' || field === 'TIMELINE' || field === 'BUDGET' || field === 'CURRENT_SOLUTION') return field;
  return null;
}

/** Someone else who decides, mentioned by the prospect ("my partner", "our office manager") — a suggested stakeholder. */
export function mentionedStakeholder(quote: string): { name: string; role: 'DECISION_MAKER' | 'INFLUENCER' } | null {
  const m = /\b(?:my|our)\s+(business partner|partner|co-?owner|boss|manager|office manager|accountant|wife|husband)\b/i.exec(quote);
  if (!m) return null;
  const who = m[1]!.toLowerCase();
  const label = who.replace(/^co-?owner$/, 'co-owner');
  return { name: `${label[0]!.toUpperCase()}${label.slice(1)} (name unknown)`, role: /partner|owner|boss|wife|husband/.test(who) ? 'DECISION_MAKER' : 'INFLUENCER' };
}

// ───────────────────────────── stage guards ─────────────────────────────

export interface DealSnapshot {
  semantic: StageSemantic;
  status: 'OPEN' | 'WON' | 'LOST' | 'ARCHIVED';
  known: ReadonlySet<string>;
  hasPrimaryContact: boolean;
  service: string | null;
  amountMinor: number | null;
  /** Stages this deal has been in. */
  reached: ReadonlySet<string>;
}

/**
 * What a stage needs before a deal may enter it (docs/09 §48-55: required fields / evidence). Skipping stages is fine
 * when the evidence is there; history records the real path.
 */
export function stageRequirements(target: StageSemantic, d: DealSnapshot): string[] {
  const missing: string[] = [];
  const need = (k: QualificationKey) => {
    if (!d.known.has(k)) missing.push(`${QUALIFICATION_INFO[k].label} is unknown`);
  };
  switch (target) {
    case 'QUALIFIED':
      need('NEED');
      if (!d.known.has('AUTHORITY') && !d.known.has('TIMELINE')) missing.push('Who decides or the timeline must be known');
      break;
    case 'MEETING':
      need('NEED');
      break;
    case 'PROPOSAL':
      need('NEED');
      if (!d.hasPrimaryContact) missing.push('No primary contact');
      if (!d.service?.trim()) missing.push('Say what we would deliver (service)');
      break;
    case 'NEGOTIATION':
      need('NEED');
      if (!d.reached.has('PROPOSAL')) missing.push('A proposal comes before negotiation');
      break;
    default:
      break;
  }
  return missing;
}

/** Which commands make sense now — the UI shows these instead of deciding by itself (docs/09 allowed actions). */
export function allowedStages(d: DealSnapshot): StageSemantic[] {
  if (d.status !== 'OPEN') return [];
  return [...OPEN_PATH, 'NURTURE'].filter((s) => s !== d.semantic) as StageSemantic[];
}

// ───────────────────────────── health + next action ─────────────────────────────

export interface HealthInput extends DealSnapshot {
  stakeholders: { role: string; status: string }[];
  conversation: { waitingOn: string; lastInboundAt: Date | null; lastOutboundAt: Date | null } | null;
  stageEnteredAt: Date;
  lastActivityAt: Date;
  contactName: string | null;
  revisitAt: Date | null;
  nextActionOverride: string | null;
}

export interface HealthResult {
  health: DealHealth;
  signals: string[];
  risks: { text: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' }[];
}

const rank = (s: StageSemantic) => OPEN_PATH.indexOf(s);
const days = (from: Date | null, now: Date) => (from ? Math.floor((now.getTime() - from.getTime()) / DAY_MS) : null);

/** Evidence-based deal health (screen #7 §11-13). No "87% to close" — signals, risks and their severity. */
export function dealHealth(d: HealthInput, now = new Date()): HealthResult {
  if (d.status !== 'OPEN') return { health: 'CLOSED', signals: [], risks: [] };
  const signals: string[] = [];
  const risks: HealthResult['risks'] = [];
  const r = rank(d.semantic);
  if (d.known.has('NEED')) signals.push('Need stated');
  if (d.known.has('AUTHORITY') || d.stakeholders.some((s) => s.role === 'DECISION_MAKER' && s.status !== 'SUGGESTED')) signals.push('Decision maker known');
  if (d.known.has('TIMELINE')) signals.push('Timeline known');
  const sinceThem = days(d.conversation?.lastInboundAt ?? null, now);
  if (sinceThem !== null && sinceThem <= 7) signals.push('Recent reply');
  if (d.reached.has('MEETING')) signals.push('Meeting reached');

  if (!d.known.has('NEED') && r >= rank('QUALIFIED')) risks.push({ text: 'Need not confirmed', severity: 'HIGH' });
  if (!d.known.has('BUDGET') && r >= rank('QUALIFIED')) risks.push({ text: 'Budget unknown', severity: r >= rank('PROPOSAL') ? 'MEDIUM' : 'LOW' });
  if (!d.known.has('AUTHORITY') && !d.stakeholders.some((s) => s.role === 'DECISION_MAKER' && s.status !== 'SUGGESTED') && r >= rank('QUALIFIED')) {
    risks.push({ text: 'Decision maker not confirmed', severity: r >= rank('PROPOSAL') ? 'HIGH' : 'MEDIUM' });
  }
  const suggested = d.stakeholders.filter((s) => s.status === 'SUGGESTED').length;
  if (suggested) risks.push({ text: `${suggested} stakeholder(s) mentioned but not involved yet`, severity: 'MEDIUM' });
  if (d.conversation?.waitingOn === 'US' && d.conversation.lastInboundAt) {
    const hours = (now.getTime() - d.conversation.lastInboundAt.getTime()) / 3_600_000;
    if (hours >= 24) risks.push({ text: `Waiting on us for ${Math.floor(hours / 24)} day(s)`, severity: 'HIGH' });
  }
  const quiet = days(d.conversation?.lastInboundAt ?? d.lastActivityAt, now) ?? 0;
  if (quiet > 7 && d.semantic !== 'NURTURE') risks.push({ text: `No activity from them for ${quiet} days`, severity: quiet > 14 ? 'HIGH' : 'MEDIUM' });
  const age = days(d.stageEnteredAt, now) ?? 0;
  if (age > 14 && d.semantic !== 'NURTURE') risks.push({ text: `In ${d.semantic.toLowerCase()} for ${age} days`, severity: 'MEDIUM' });

  const stalled = quiet > 14 && d.conversation?.waitingOn !== 'US' && d.semantic !== 'NURTURE';
  const high = risks.filter((x) => x.severity === 'HIGH').length;
  const medium = risks.filter((x) => x.severity === 'MEDIUM').length;
  return { health: stalled ? 'STALLED' : high || medium >= 2 ? 'AT_RISK' : 'HEALTHY', signals, risks };
}

/** Exactly one current next action, always with why (screen #7 §14). A person's own next step wins. */
export function nextBestAction(d: HealthInput, now = new Date()): { action: string; why: string } {
  if (d.status === 'WON') return { action: 'Hand over to delivery', why: 'The deal is won' };
  if (d.status !== 'OPEN') return { action: 'Nothing', why: 'The deal is closed' };
  if (d.nextActionOverride) return { action: d.nextActionOverride, why: 'Set by a person' };
  const who = d.contactName ?? 'them';
  if (d.conversation?.waitingOn === 'US') return { action: `Reply to ${who}`, why: 'They wrote last and are waiting on us' };
  if (d.semantic === 'NURTURE') return { action: d.revisitAt ? `Revisit after ${d.revisitAt.toISOString().slice(0, 10)}` : 'Revisit later', why: 'They said not now' };
  if (!d.known.has('NEED')) return { action: 'Confirm what they need', why: 'No need is stated yet — everything else depends on it' };
  if (rank(d.semantic) < rank('QUALIFIED') && stageRequirements('QUALIFIED', d).length === 0) return { action: 'Move to Qualified', why: `Need${d.known.has('AUTHORITY') ? ' and who decides' : ' and timeline'} are known` };
  if (!d.known.has('AUTHORITY') && !d.known.has('DECISION_PROCESS')) return { action: 'Find out who decides', why: 'The decision maker is not confirmed' };
  const suggested = d.stakeholders.some((s) => s.status === 'SUGGESTED');
  if (suggested && rank(d.semantic) <= rank('PROPOSAL')) return { action: 'Understand the other decision maker’s role', why: 'They mentioned someone else who decides — before a proposal' };
  const health = dealHealth(d, now);
  switch (d.semantic) {
    case 'NEW':
    case 'DISCOVERY':
      return { action: 'Learn when they want it done', why: 'Qualification needs who decides or the timeline' };
    case 'QUALIFIED':
      return { action: 'Book a meeting', why: 'The deal is qualified' };
    case 'MEETING':
      return d.service ? { action: 'Prepare the proposal', why: 'Meeting stage reached and the scope is known' } : { action: 'Agree the scope', why: 'A proposal needs to say what we would deliver' };
    case 'PROPOSAL':
      return health.health === 'STALLED'
        ? { action: 'Refer to the proposal and ask whether priorities changed', why: 'No reply for a while — not a generic “checking in”' }
        : { action: 'Discuss the proposal', why: 'Proposal stage' };
    case 'NEGOTIATION':
      return { action: 'Agree terms', why: 'Pricing, discounts and terms need a person with authority' };
    default:
      return { action: 'Wait for their answer', why: 'We replied last' };
  }
}

/** Qualification status from what is known (unknown stays unknown). */
export function qualificationStatus(known: ReadonlySet<string>): 'UNQUALIFIED' | 'PARTIAL' | 'QUALIFIED' {
  if (known.has('NEED') && (known.has('AUTHORITY') || known.has('TIMELINE'))) return 'QUALIFIED';
  return known.size ? 'PARTIAL' : 'UNQUALIFIED';
}

/** The likely loss reason from what they said (screen #7 §36) — a suggestion a person confirms, with the evidence. */
export function suggestLossReason(readings: { primaryIntent: string; objections: { type: string; text: string }[]; text: string }[]): { code: LossReasonCode; quote: string } | null {
  for (const r of [...readings].reverse()) {
    const o = r.objections[0];
    if (o?.type === 'NO_BUDGET') return { code: 'NO_BUDGET', quote: o.text };
    if (o?.type === 'TOO_EXPENSIVE') return { code: 'PRICE', quote: o.text };
    if (o?.type === 'ALREADY_HAS_SOLUTION') return { code: 'COMPETITOR', quote: o.text };
    if (o?.type === 'NO_NEED') return { code: 'NO_NEED', quote: o.text };
    if (r.primaryIntent === 'NOT_NOW') return { code: 'TIMING', quote: r.text.slice(0, 200) };
    if (r.primaryIntent === 'NEGATIVE') return { code: 'NO_NEED', quote: r.text.slice(0, 200) };
  }
  return null;
}
