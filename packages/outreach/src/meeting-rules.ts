import { OPEN_PATH, QUALIFICATION_INFO, QUALIFICATION_KEYS, type MeetingOutcomeKey, type MeetingQualificationRuleKey, type QualificationKey, type StageSemantic } from '@revenue-os/shared';
import { stageRequirements, type DealSnapshot } from './opportunity-rules.js';

/**
 * Deterministic meeting rules (docs/17 §93-98, screen #8): which meeting type fits, who it is routed to, what the deal
 * must show before a type may be booked, what the brief says, and what an outcome recommends. The AI never decides
 * these; nothing here calls a model.
 */

const rank = (s: StageSemantic) => OPEN_PATH.indexOf(s);

// ───────────────────────────── meeting type ─────────────────────────────

/** Why a meeting type can't be booked yet (screen #8 §9: "Technical Demo requires a qualified opportunity"), or null. */
export function meetingTypeBlocked(rule: MeetingQualificationRuleKey, d: { known: ReadonlySet<string>; qualified: boolean }): string | null {
  if (rule === 'NEED' && !d.known.has('NEED')) return 'needs a stated need first — continue qualification';
  if (rule === 'QUALIFIED' && !d.qualified) return 'needs a qualified deal (need, plus who decides or the timeline) — continue qualification first';
  return null;
}

export interface TypeChoice {
  id: string;
  key: string;
  requiredQualification: MeetingQualificationRuleKey;
  active: boolean;
  position: number;
}

/**
 * The meeting type to suggest (screen #8 §10): a discovery call by default; a proposal review once a proposal stage is
 * reached; a decision call in negotiation; a demo after an earlier meeting on a qualified deal. Only types the deal
 * already qualifies for.
 */
export function recommendMeetingType<T extends TypeChoice>(types: T[], d: { stage: StageSemantic | null; known: ReadonlySet<string>; qualified: boolean; hadMeeting: boolean }): T | null {
  const usable = types.filter((t) => t.active && !meetingTypeBlocked(t.requiredQualification, d)).sort((a, b) => a.position - b.position);
  const want = d.stage === 'NEGOTIATION' ? 'DECISION' : d.stage === 'PROPOSAL' ? 'PROPOSAL_REVIEW' : d.hadMeeting && d.qualified ? 'TECHNICAL_DEMO' : 'DISCOVERY';
  return usable.find((t) => t.key === want) ?? usable.find((t) => t.key === 'DISCOVERY') ?? usable[0] ?? null;
}

// ───────────────────────────── routing ─────────────────────────────

export interface RoutingCandidate {
  userId: string;
  name: string;
  acceptsMeetings: boolean;
  unavailableUntil: Date | null;
  /** Booked meetings in the coming week — the round-robin load. */
  upcoming: number;
}

export interface RoutingInput {
  candidates: RoutingCandidate[];
  /** Relationship owners, most important first: deal owner, conversation owner / whoever took over, earlier meeting owner. */
  relationship: { userId: string; why: string }[];
  /** A person asked for this owner. */
  requested?: string | null;
  now: Date;
}

/**
 * Who takes the meeting (screen #8 §6-8, §42): a person's explicit choice; else the relationship owner (the AI does not
 * hand John to Alex because Alex has an earlier slot); if they are away, a backup by round robin, saying so; else round
 * robin by the lightest week. Null when nobody has set when they can be booked.
 */
export function routeMeeting(input: RoutingInput): { userId: string; reason: string } | null {
  const available = (c: RoutingCandidate) => c.acceptsMeetings && (!c.unavailableUntil || c.unavailableUntil <= input.now);
  const byId = new Map(input.candidates.map((c) => [c.userId, c]));
  if (input.requested) {
    const c = byId.get(input.requested);
    if (c) return { userId: c.userId, reason: available(c) ? 'Chosen by a person' : `Chosen by a person (away until ${c.unavailableUntil?.toISOString().slice(0, 10)})` };
  }
  let away: RoutingCandidate | null = null;
  for (const r of input.relationship) {
    const c = byId.get(r.userId);
    if (!c) continue;
    if (available(c)) return { userId: c.userId, reason: `Existing relationship: ${c.name} (${r.why})` };
    away ??= c;
  }
  const pool = input.candidates.filter(available).sort((a, b) => a.upcoming - b.upcoming || a.name.localeCompare(b.name));
  if (!pool.length) return null;
  const pick = pool[0]!;
  if (away) return { userId: pick.userId, reason: `${away.name} is away${away.unavailableUntil ? ` until ${away.unavailableUntil.toISOString().slice(0, 10)}` : ''} — routed to ${pick.name} (fewest meetings this week)` };
  return { userId: pick.userId, reason: `Round robin: ${pick.name} has the fewest meetings this week (${pick.upcoming})` };
}

// ───────────────────────────── brief ─────────────────────────────

export interface BriefInput {
  meeting: { typeKey: string; typeName: string; startAt: Date | null; timezone: string; timezoneConfidence: string; locationType: string; meetingUrl: string | null };
  company: { name: string; industry: string | null; city: string | null; region: string | null; website: string | null };
  people: { name: string; title: string | null; side: 'EXTERNAL' | 'INTERNAL'; role: string | null }[];
  deal: { name: string; stage: StageSemantic; service: string | null; originReason: string | null; originQuote: string | null } | null;
  /** Current qualification answers (deal) or stated facts (conversation) — with the prospect's words. */
  known: { key: QualificationKey; value: string; quote: string | null; verified: boolean }[];
  questionsAsked: string[];
  objections: { type: string; text: string }[];
  stakeholders: { name: string; role: string; status: string }[];
  hypotheses: { label: string; confidence: string }[];
  previousMeetings: { title: string; at: Date | null; status: string; outcome: string | null; nextStep: string | null }[];
  conversationSummary: string | null;
  lastResearchAt: Date | null;
  now: Date;
}

export interface BriefContent {
  who: { name: string; title: string | null; role: string | null }[];
  team: { name: string; role: string | null }[];
  company: { name: string; where: string; industry: string | null; website: string | null };
  whyEngaged: { reason: string; quote: string | null } | null;
  need: string | null;
  known: { label: string; value: string; quote: string | null; verified: boolean }[];
  unknown: { label: string; ask: string }[];
  questionsAsked: string[];
  objections: { type: string; text: string }[];
  stakeholders: { name: string; role: string; status: string }[];
  signals: { label: string; confidence: string }[];
  previousMeetings: { title: string; at: string | null; status: string; outcome: string | null; nextStep: string | null }[];
  suggestedQuestions: { question: string; reason: string }[];
  dontAskAgain: string[];
  objective: string;
  commitments: string[];
}

const ASK: Record<QualificationKey, string> = {
  NEED: 'What would you most like to improve — and why now?',
  TIMELINE: 'When would you like this in place?',
  BUDGET: 'Have you set aside a budget for this, even roughly?',
  AUTHORITY: 'Who makes the final decision on this?',
  DECISION_PROCESS: 'Who else is involved, and how do you usually decide on something like this?',
  CURRENT_SOLUTION: 'How do you handle this today?',
  PROJECT: 'What exactly would you want us to deliver?',
};

/**
 * The pre-meeting brief (screen #8 §20-23) from what is actually known — every known item with its source words, the
 * unknowns as a short list of questions with reasons (not a 30-question checklist), what not to ask again, and the gaps
 * said plainly ("research is 4 months old").
 */
export function buildBrief(b: BriefInput): { content: BriefContent; gaps: string[] } {
  const known = new Map(b.known.map((k) => [k.key, k]));
  const unknownKeys = QUALIFICATION_KEYS.filter((k) => !known.has(k) && k !== 'PROJECT');
  const suggested: { question: string; reason: string }[] = [];
  const partner = b.stakeholders.find((s) => s.status === 'SUGGESTED');
  const existing = b.objections.find((o) => o.type === 'ALREADY_HAS_SOLUTION');
  for (const k of unknownKeys) {
    let reason = `${QUALIFICATION_INFO[k].label} is unknown`;
    if (k === 'DECISION_PROCESS' && partner) reason = `They mentioned ${partner.name.replace(' (name unknown)', '')} — understand their part in the decision`;
    if (k === 'AUTHORITY' && partner) continue; // covered by the decision-process question
    if (k === 'CURRENT_SOLUTION' && existing) reason = `They mentioned an existing provider: “${existing.text}”`;
    if (k === 'NEED') reason = 'No need is stated yet — everything else depends on it';
    suggested.push({ question: ASK[k], reason });
  }
  for (const o of b.objections.filter((x) => x.type !== 'ALREADY_HAS_SOLUTION').slice(0, 1)) suggested.push({ question: 'What would need to be true for this to work for you?', reason: `Objection raised: “${o.text}”` });
  const dontAskAgain = [
    ...b.known.map((k) => `${QUALIFICATION_INFO[k.key].label}: ${k.value}`),
    ...b.people.filter((p) => p.side === 'EXTERNAL' && p.title).map((p) => `${p.name} is ${p.title}`),
  ];

  const objective =
    b.meeting.typeKey === 'TECHNICAL_DEMO'
      ? 'Show how it fits their setup and confirm the technical requirements'
      : b.meeting.typeKey === 'PROPOSAL_REVIEW'
        ? 'Walk through the proposal, answer questions, agree the decision date'
        : b.meeting.typeKey === 'DECISION'
          ? 'Agree terms and the start date — pricing needs a person with authority'
          : b.meeting.typeKey === 'ONBOARDING'
            ? 'Kick off: confirm scope, contacts and the first milestones'
            : unknownKeys.length
              ? `Confirm ${unknownKeys.slice(0, 3).map((k) => QUALIFICATION_INFO[k].label.toLowerCase()).join(', ')}`
              : 'Agree the next step (proposal or demo)';

  const gaps: string[] = [];
  if (!b.lastResearchAt) gaps.push('The company has not been researched — the brief only knows the conversation');
  else {
    const days = Math.floor((b.now.getTime() - b.lastResearchAt.getTime()) / 86_400_000);
    if (days > 90) gaps.push(`Research is ${days} days old — refresh it before the call`);
  }
  if (b.meeting.timezoneConfidence === 'LOW') gaps.push('Their time zone is a guess — confirm it at the start');
  if (!b.people.some((p) => p.side === 'EXTERNAL')) gaps.push('No contact person is known');
  gaps.push('Commitments (what we or they promised) are tracked from Phase 15 — check the conversation');

  return {
    content: {
      who: b.people.filter((p) => p.side === 'EXTERNAL').map((p) => ({ name: p.name, title: p.title, role: p.role })),
      team: b.people.filter((p) => p.side === 'INTERNAL').map((p) => ({ name: p.name, role: p.role })),
      company: { name: b.company.name, where: [b.company.city, b.company.region].filter(Boolean).join(', '), industry: b.company.industry, website: b.company.website },
      whyEngaged: b.deal?.originReason ? { reason: b.deal.originReason, quote: b.deal.originQuote } : b.conversationSummary ? { reason: b.conversationSummary, quote: null } : null,
      need: known.get('NEED')?.value ?? null,
      known: b.known.map((k) => ({ label: QUALIFICATION_INFO[k.key].label, value: k.value, quote: k.quote, verified: k.verified })),
      unknown: unknownKeys.map((k) => ({ label: QUALIFICATION_INFO[k].label, ask: QUALIFICATION_INFO[k].ask })),
      questionsAsked: b.questionsAsked.slice(0, 6),
      objections: b.objections.slice(0, 4),
      stakeholders: b.stakeholders,
      signals: b.hypotheses.slice(0, 4),
      previousMeetings: b.previousMeetings.map((m) => ({ ...m, at: m.at?.toISOString() ?? null })),
      suggestedQuestions: suggested.slice(0, 5),
      dontAskAgain,
      objective,
      commitments: [],
    },
    gaps,
  };
}

// ───────────────────────────── after the meeting ─────────────────────────────

/**
 * The stage a recorded outcome suggests (screen #8 §29) — applied only when a person accepts it. "Advanced" moves the
 * deal one real step (to Qualified when the evidence is there, else from Meeting to Proposal); "Nurture" parks it; lost
 * and disqualified go through Mark lost, with a reason.
 */
export function recommendStage(outcome: MeetingOutcomeKey, d: DealSnapshot | null): { stage: StageSemantic | null; why: string } {
  if (!d || d.status !== 'OPEN') return { stage: null, why: d ? 'The deal is closed' : 'No deal yet' };
  if (outcome === 'NURTURE') return { stage: 'NURTURE', why: 'They said not now' };
  if (outcome === 'LOST' || outcome === 'DISQUALIFIED') return { stage: null, why: 'Use “Mark lost” on the deal — it records the reason' };
  if (outcome !== 'ADVANCED') return { stage: null, why: 'Nothing moved' };
  const r = rank(d.semantic);
  if (r < rank('QUALIFIED')) {
    const missing = stageRequirements('QUALIFIED', d);
    return missing.length ? { stage: null, why: `Not qualified yet: ${missing.join('; ')}` } : { stage: 'QUALIFIED', why: 'Required qualification criteria are confirmed' };
  }
  if (r < rank('PROPOSAL')) {
    const missing = stageRequirements('PROPOSAL', d);
    return missing.length ? { stage: null, why: `Before a proposal: ${missing.join('; ')}` } : { stage: 'PROPOSAL', why: 'The meeting moved it forward and the scope is known' };
  }
  return { stage: null, why: 'Already at proposal or later — record the next step' };
}

/** The repeated no-show risk (screen #8 §19): from the second no-show, ask them to confirm before reserving time again. */
export function noShowRisk(noShows: number): string | null {
  return noShows >= 2 ? `${noShows} no-shows — ask them to confirm before reserving another slot` : null;
}

export interface MeetingState {
  status: string;
  startAt: Date | null;
  endAt: Date | null;
  pendingStartAt: Date | null;
  offeredAt: Date | null;
  slots: number;
  statusReason: string | null;
  hasOwner: boolean;
}

/** One line: what should happen next with this meeting, and who does it. */
export function meetingNextAction(m: MeetingState, now = new Date()): string {
  switch (m.status) {
    case 'PROPOSED':
      if (!m.hasOwner) return 'Set up availability (Meetings → Setup) so free times can be found';
      return m.slots ? 'Offer these times — or book one directly' : (m.statusReason ?? 'No free time found — widen availability or pick a time');
    case 'PENDING_CONFIRMATION':
      if (m.pendingStartAt) return m.statusReason ?? 'Booking with the calendar…';
      return m.offeredAt ? 'Waiting for them to pick a time — their reply books it' : 'Offer the times';
    case 'BOOKED':
      if (m.endAt && m.endAt < now) return 'Did it happen? Record the outcome (or mark a no-show)';
      return m.startAt && m.startAt.getTime() - now.getTime() < 2 * 3_600_000 ? 'Starting soon — read the brief' : 'Prepare with the brief';
    case 'RESCHEDULING':
      return 'Moving it — the old time stands until the calendar confirms';
    case 'NO_SHOW':
      return 'Offer to reschedule — a no-show is not a lost deal';
    case 'CANCELLED':
      return 'Decide whether to offer new times';
    default:
      return 'Follow the next step from the outcome';
  }
}
