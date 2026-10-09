import type { ActionClass, RiskLevel } from '@revenue-os/database';
import type { PermissionKey } from '@revenue-os/shared';

export interface ActionDefinition {
  /** docs/10 §31 — A internal read … E governance. */
  class: ActionClass;
  /** Reaches someone outside the workspace: the kill switch, suppression and sending rules apply. */
  outbound: boolean;
  /** What a person needs to take this action themselves. */
  permission: PermissionKey | null;
  risk: RiskLevel;
  description: string;
  /**
   * An answer inside a conversation the prospect started by replying (docs/10 §37-47): cold-outreach controls — first
   * touch, contact cool-down, daily volume — don't apply; suppression, the kill switch, permission and autonomy do.
   */
  conversational?: boolean;
}

/**
 * Every action type the Policy Engine knows. An action type that is not listed here is blocked (default deny,
 * docs/10 §76-92) — adding a new side effect means adding its policy first.
 */
export const ACTIONS: Record<string, ActionDefinition> = {
  'email.send': { class: 'C', outbound: true, permission: 'conversation.send', risk: 'MEDIUM', description: 'Send one email' },
  'email.reply': { class: 'C', outbound: true, permission: 'conversation.send', risk: 'MEDIUM', description: 'Reply in a conversation', conversational: true },
  // Meetings (Phase 14): an invitation reaches the prospect, so the kill switch and suppression apply. They asked to
  // meet, so cold-outreach caps don't. Cancelling never contacts anyone new — it only withdraws an invitation, and must
  // stay possible even when outbound is stopped.
  'calendar.book': { class: 'C', outbound: true, permission: 'meeting.book', risk: 'LOW', description: 'Book a meeting (calendar invite)', conversational: true },
  'calendar.update': { class: 'C', outbound: true, permission: 'meeting.book', risk: 'LOW', description: 'Move a meeting to a new time', conversational: true },
  'calendar.cancel': { class: 'C', outbound: false, permission: 'meeting.book', risk: 'LOW', description: 'Cancel a meeting' },
  // The pipeline self-test (System diagnostics) — fake, internal, never reaches anyone.
  'diagnostics.fake_send': { class: 'B', outbound: false, permission: 'system.manage', risk: 'LOW', description: 'Pipeline self-test (fake)' },
};

/**
 * Which AI agents may take which actions at all (docs/10 §20-31: AI authority is separate from human permission).
 * The Phase 9 agents (research, website audit, contact, scoring) and the Inbox Agent only read and propose, so none of
 * them is here. The Campaign Agent sends cold emails, the Conversation Agent replies, the Scheduling Agent books the
 * slot a prospect picked (never moves or cancels — people do); autonomy still decides ACT or ASK.
 */
export const AGENT_ACTIONS: Record<string, readonly string[]> = {
  CAMPAIGN: ['email.send'],
  CONVERSATION: ['email.reply'],
  SCHEDULING: ['calendar.book'],
};

export function actionDefinition(actionType: string): ActionDefinition | null {
  return Object.hasOwn(ACTIONS, actionType) ? ACTIONS[actionType]! : null;
}
