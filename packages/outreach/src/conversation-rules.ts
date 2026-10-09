import type { ConversationMode, ConversationStage, InboxCategory, WaitingOn } from '@revenue-os/database';
import { RISK_INFO, type Intent, type RiskFlag } from '@revenue-os/shared';

/**
 * Deterministic inbox rules (docs/17 §77-86, screen #5 §2-3, §48). The AI reads messages; these rules — never the
 * model — decide the category, the stage and how urgent a conversation is.
 */

export interface ConversationState {
  stage: ConversationStage;
  mode: ConversationMode;
  waitingOn: WaitingOn;
  needsHuman: boolean;
  primaryIntent: string | null;
  snoozedUntil: Date | null;
  resolvedAt: Date | null;
}

const WARM: readonly string[] = ['POSITIVE', 'QUESTION', 'PRICING'];

/** Which inbox bucket a conversation belongs in — "which relationships need an action, and who takes it". */
export function categorize(c: ConversationState, now = new Date()): InboxCategory {
  if (c.stage === 'SUPPRESSED' || c.stage === 'CLOSED' || c.resolvedAt) return 'CLOSED';
  if (c.stage === 'NURTURE' || (c.snoozedUntil && c.snoozedUntil > now)) return 'NURTURE';
  if (c.stage === 'MEETING_REQUESTED') return 'MEETING';
  if (c.needsHuman) return 'NEEDS_HUMAN';
  if (c.waitingOn === 'US' && c.mode === 'HUMAN') return 'NEEDS_HUMAN';
  if (c.waitingOn === 'US' && c.mode === 'ASSIST') return WARM.includes(c.primaryIntent ?? '') ? 'HIGH_INTENT' : 'NEEDS_HUMAN';
  return 'AI_HANDLING';
}

/** Stage after a message with this intent (screen #5 §48). Never moves backwards from a meeting request. */
export function nextStage(current: ConversationStage, intent: Intent): ConversationStage {
  if (current === 'SUPPRESSED') return current;
  switch (intent) {
    case 'UNSUBSCRIBE':
      return 'SUPPRESSED';
    case 'NEGATIVE':
      return 'CLOSED';
    case 'NOT_NOW':
      return 'NURTURE';
    case 'MEETING_REQUEST':
      return 'MEETING_REQUESTED';
    case 'POSITIVE':
    case 'QUESTION':
    case 'PRICING':
    case 'OBJECTION':
      return current === 'MEETING_REQUESTED' ? current : 'ENGAGED';
    case 'OUT_OF_OFFICE':
    case 'AUTOMATED':
      return current;
    default:
      // A closed or nurtured conversation that gets a real message is open again.
      return current === 'CLOSED' || current === 'NURTURE' ? 'ENGAGED' : current;
  }
}

/** Who has to act after a message with this intent. */
export function waitingAfter(intent: Intent, current: WaitingOn): WaitingOn {
  if (intent === 'UNSUBSCRIBE' || intent === 'NEGATIVE') return 'NOBODY';
  if (intent === 'OUT_OF_OFFICE' || intent === 'AUTOMATED') return current;
  return 'US';
}

/** Intents that get a drafted answer. Refusals, unsubscribes and away messages don't. */
export const REPLY_INTENTS: readonly Intent[] = ['POSITIVE', 'QUESTION', 'PRICING', 'MEETING_REQUEST', 'OBJECTION', 'NOT_NOW', 'REFERRAL', 'WRONG_PERSON', 'UNKNOWN'];

const INTENT_WEIGHT: Record<string, number> = {
  MEETING_REQUEST: 50,
  PRICING: 45,
  POSITIVE: 40,
  QUESTION: 35,
  OBJECTION: 25,
  REFERRAL: 20,
  UNKNOWN: 15,
  WRONG_PERSON: 10,
  NOT_NOW: 5,
};

/**
 * Priority = intent + human requirement + risk + whose turn it is (screen #5 §3) — not unread time. Waiting time is
 * added when listing (`withWaiting`), so a prospect who has waited for hours rises on its own.
 */
export function priorityOf(input: { primaryIntent: string | null; needsHuman: boolean; riskFlags: string[]; waitingOn: WaitingOn; stage: ConversationStage }): { priority: number; reasons: string[] } {
  if (input.stage === 'SUPPRESSED' || input.stage === 'CLOSED') return { priority: 0, reasons: [] };
  const reasons: string[] = [];
  let p = INTENT_WEIGHT[input.primaryIntent ?? ''] ?? 0;
  if (p >= 35) reasons.push('Buying signal');
  if (input.needsHuman) {
    p += 20;
    reasons.push('Needs a person');
  }
  const risks = input.riskFlags.slice(0, 3);
  p += risks.length * 10;
  for (const r of risks) reasons.push(RISK_INFO[r as RiskFlag] ?? r);
  if (input.waitingOn === 'US') {
    p += 10;
    reasons.push('Waiting on us');
  }
  if (input.stage === 'NURTURE') p = Math.min(p, 10);
  return { priority: p, reasons };
}

/** Listing-time priority: up to +30 for a prospect waiting on us (2 per hour). */
export function withWaiting(priority: number, waitingOn: WaitingOn, lastInboundAt: Date | null, now = new Date()): number {
  if (waitingOn !== 'US' || !lastInboundAt) return priority;
  const hours = Math.max(0, (now.getTime() - lastInboundAt.getTime()) / 3_600_000);
  return priority + Math.min(30, Math.floor(hours * 2));
}

/** One line: what should happen next, and who does it (screen #5 §40 explainability, not chain of thought). */
export function nextActionFor(c: ConversationState & { escalationReason: string | null; pendingApproval: boolean; draftReady: boolean; replyQueued: boolean }, now = new Date()): string {
  if (c.stage === 'SUPPRESSED') return 'Nothing — they asked not to be contacted';
  if (c.stage === 'CLOSED' || c.resolvedAt) return 'Nothing — the conversation is closed';
  if (c.snoozedUntil && c.snoozedUntil > now) return `Get back in touch after ${c.snoozedUntil.toISOString().slice(0, 10)}`;
  if (c.replyQueued) return 'Reply is on its way (checked again right before sending)';
  if (c.pendingApproval) return 'Approve or edit the AI reply';
  if (c.stage === 'MEETING_REQUESTED') return 'Book the meeting — agree a time with them';
  if (c.needsHuman) return `Reply yourself: ${c.escalationReason ?? 'the AI should not answer this alone'}`;
  if (c.draftReady) return 'Review the AI draft and send it';
  if (c.waitingOn === 'US') return c.mode === 'HUMAN' ? 'Write a reply' : 'The AI is preparing a reply';
  if (c.stage === 'NURTURE') return 'Nurture — check back later';
  return 'Wait for their answer';
}
