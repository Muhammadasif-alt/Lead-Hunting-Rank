/**
 * Opportunities + qualification catalog (docs/17 §87-92, screen #7). Browser-safe labels shared by the API and the web
 * app. Stage guards, health and next actions are decided on the server by @revenue-os/outreach.
 */

export const STAGE_SEMANTICS = ['NEW', 'DISCOVERY', 'QUALIFIED', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'NURTURE'] as const;
export type StageSemantic = (typeof STAGE_SEMANTICS)[number];

/** The forward path of an open deal (Nurture, Won and Lost sit beside it). */
export const OPEN_PATH: readonly StageSemantic[] = ['NEW', 'DISCOVERY', 'QUALIFIED', 'MEETING', 'PROPOSAL', 'NEGOTIATION'];

export const STAGE_SEMANTIC_INFO: Record<StageSemantic, { label: string; description: string }> = {
  NEW: { label: 'New', description: 'Commercial interest noticed — not yet explored' },
  DISCOVERY: { label: 'Discovery', description: 'Understanding the need and who is involved' },
  QUALIFIED: { label: 'Qualified', description: 'Need confirmed, plus who decides or when' },
  MEETING: { label: 'Meeting', description: 'A meeting is booked or has happened' },
  PROPOSAL: { label: 'Proposal', description: 'A proposal is being prepared or was sent' },
  NEGOTIATION: { label: 'Negotiation', description: 'Terms are being agreed — pricing needs authority' },
  WON: { label: 'Won', description: 'They said yes — revenue recorded' },
  LOST: { label: 'Lost', description: 'Closed with a reason (maybe revisit later)' },
  NURTURE: { label: 'Nurture', description: 'Not now — back on the radar at a set time' },
};

export const LOSS_REASONS = ['PRICE', 'TIMING', 'COMPETITOR', 'NO_BUDGET', 'NO_NEED', 'INTERNAL_DECISION', 'NO_RESPONSE', 'TECHNICAL_FIT', 'WRONG_PROSPECT', 'OTHER'] as const;
export type LossReasonCode = (typeof LOSS_REASONS)[number];
export const LOSS_REASON_INFO: Record<LossReasonCode, string> = {
  PRICE: 'Price',
  TIMING: 'Timing',
  COMPETITOR: 'Went with someone else',
  NO_BUDGET: 'No budget',
  NO_NEED: 'No need',
  INTERNAL_DECISION: 'Internal decision',
  NO_RESPONSE: 'Stopped responding',
  TECHNICAL_FIT: 'Technical fit',
  WRONG_PROSPECT: 'Wrong prospect',
  OTHER: 'Other',
};

/** What we want to know about a deal (screen #7 §6). Unknown stays unknown — the AI never fills a gap by guessing. */
export const QUALIFICATION_KEYS = ['NEED', 'TIMELINE', 'BUDGET', 'AUTHORITY', 'DECISION_PROCESS', 'CURRENT_SOLUTION', 'PROJECT'] as const;
export type QualificationKey = (typeof QUALIFICATION_KEYS)[number];
export const QUALIFICATION_INFO: Record<QualificationKey, { label: string; ask: string }> = {
  NEED: { label: 'Need', ask: 'What problem do they want solved?' },
  TIMELINE: { label: 'Timeline', ask: 'When do they want it done?' },
  BUDGET: { label: 'Budget', ask: 'Is money set aside, and roughly how much?' },
  AUTHORITY: { label: 'Who decides', ask: 'Who makes the final decision?' },
  DECISION_PROCESS: { label: 'Decision process', ask: 'Who else is involved and how do they decide?' },
  CURRENT_SOLUTION: { label: 'Current solution', ask: 'What do they use today?' },
  PROJECT: { label: 'Project / scope', ask: 'What exactly would we deliver?' },
};

export const STAKEHOLDER_ROLES = ['DECISION_MAKER', 'INFLUENCER', 'USER', 'CHAMPION', 'UNKNOWN'] as const;
export type StakeholderRoleKey = (typeof STAKEHOLDER_ROLES)[number];
export const STAKEHOLDER_ROLE_INFO: Record<StakeholderRoleKey, string> = {
  DECISION_MAKER: 'Decision maker',
  INFLUENCER: 'Influencer',
  USER: 'User',
  CHAMPION: 'Champion',
  UNKNOWN: 'Role unknown',
};

export const DEAL_HEALTH = ['HEALTHY', 'AT_RISK', 'STALLED', 'CLOSED'] as const;
export type DealHealth = (typeof DEAL_HEALTH)[number];
export const DEAL_HEALTH_INFO: Record<DealHealth, { label: string; description: string }> = {
  HEALTHY: { label: 'Healthy', description: 'Moving, with confirmed signals' },
  AT_RISK: { label: 'At risk', description: 'Something important is missing or waiting' },
  STALLED: { label: 'Possibly stalled', description: 'No meaningful activity from them for a while' },
  CLOSED: { label: 'Closed', description: 'Won or lost' },
};
