/**
 * Role + permission catalog (docs/10 §8-19, docs/14 §6-12). Browser-safe: the web app uses it for UX hints only —
 * the API resolves effective permissions from the database and is the only enforcement point.
 */

export const ROLES = ['OWNER', 'ADMIN', 'SALES', 'RESEARCHER', 'VIEWER'] as const;
export type RoleKey = (typeof ROLES)[number];

/** docs/10 §31 — A internal read, B internal write, C reversible external, D commercial, E critical/governance. */
export type ActionClass = 'A' | 'B' | 'C' | 'D' | 'E';

export const PERMISSIONS = {
  'company.read': { class: 'A', description: 'View companies, people, evidence and facts' },
  'company.update': { class: 'B', description: 'Create and edit companies, people and contact points' },
  'evidence.manage': { class: 'B', description: 'Add evidence and correct facts' },
  'market.read': { class: 'A', description: 'View markets and discovery missions' },
  'market.create': { class: 'B', description: 'Define markets' },
  'market.run': { class: 'B', description: 'Run discovery missions (spends research budget)' },
  'campaign.read': { class: 'A', description: 'View campaigns' },
  'campaign.create': { class: 'B', description: 'Create and edit draft campaigns' },
  'campaign.start': { class: 'C', description: 'Launch campaigns (external outreach)' },
  'campaign.pause': { class: 'B', description: 'Pause campaigns' },
  'conversation.read': { class: 'A', description: 'Read conversations' },
  'conversation.send': { class: 'C', description: 'Send messages' },
  'conversation.takeover': { class: 'B', description: 'Take a conversation over from the AI' },
  'opportunity.read': { class: 'A', description: 'View opportunities' },
  'opportunity.create': { class: 'B', description: 'Create opportunities' },
  'opportunity.update': { class: 'B', description: 'Edit opportunities and move stages' },
  'opportunity.mark_won': { class: 'D', description: 'Mark opportunities won' },
  'meeting.book': { class: 'C', description: 'Book meetings' },
  'pricing.quote': { class: 'D', description: 'Quote approved prices' },
  'pricing.discount': { class: 'D', description: 'Offer discounts (bounded by authority limit)' },
  'approval.decide': { class: 'D', description: 'Approve or reject requests (bounded by authority limits)' },
  'task.manage': { class: 'B', description: 'Create and complete tasks' },
  'knowledge.read': { class: 'A', description: 'Read the knowledge base' },
  'knowledge.approve': { class: 'E', description: 'Publish knowledge used by AI' },
  'policy.read': { class: 'A', description: 'View policies' },
  'policy.manage': { class: 'E', description: 'Change policies and autonomy levels' },
  'integration.read': { class: 'A', description: 'View integrations, their health and usage' },
  'integration.manage': { class: 'E', description: 'Connect and disconnect integrations' },
  'member.manage': { class: 'E', description: 'Invite members and change roles' },
  'data.export': { class: 'E', description: 'Bulk export data' },
  'outbound.pause': { class: 'B', description: 'Pause all outbound activity' },
  'outbound.emergency_stop': { class: 'E', description: 'Trigger the emergency stop' },
  'outbound.resume': { class: 'E', description: 'Resume outbound after an emergency stop' },
  'workspace.manage': { class: 'E', description: 'Workspace settings, ownership and security' },
  'system.read': { class: 'A', description: 'View system health, event pipeline and failed jobs' },
  'system.manage': { class: 'E', description: 'Retry or dismiss failed jobs and run pipeline diagnostics' },
} as const satisfies Record<string, { class: ActionClass; description: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

const READ: PermissionKey[] = [
  'company.read',
  'market.read',
  'campaign.read',
  'conversation.read',
  'opportunity.read',
  'knowledge.read',
  'policy.read',
  'integration.read',
];

/** Default role → permission grants seeded into every workspace (docs/10 §8-14). */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  OWNER: PERMISSION_KEYS,
  // Owner-only: workspace/ownership/security, bulk export, resuming after an emergency stop.
  ADMIN: PERMISSION_KEYS.filter((p) => !['workspace.manage', 'data.export', 'outbound.resume'].includes(p)),
  SALES: [
    ...READ,
    'company.update',
    'campaign.pause',
    'conversation.send',
    'conversation.takeover',
    'opportunity.create',
    'opportunity.update',
    'opportunity.mark_won',
    'meeting.book',
    'pricing.quote',
    'pricing.discount',
    'approval.decide',
    'task.manage',
    'outbound.pause',
  ],
  RESEARCHER: [...READ, 'company.update', 'evidence.manage', 'market.create', 'market.run', 'task.manage'],
  VIEWER: READ,
};

/** Authority limits are separate from permissions (docs/10 §48-55): may discount, but only up to N%. */
export const AUTHORITY_LIMITS = {
  'pricing.max_discount_percent': { unit: 'PERCENT', description: 'Largest discount this role may give or approve' },
  'campaign.max_audience': { unit: 'COUNT', description: 'Largest audience this role may launch a campaign to' },
} as const;
export type AuthorityLimitKey = keyof typeof AUTHORITY_LIMITS;

/** Default limits per role. A missing entry means "no authority"; `null` means unlimited. */
export const DEFAULT_AUTHORITY_LIMITS: Record<RoleKey, Partial<Record<AuthorityLimitKey, number | null>>> = {
  OWNER: { 'pricing.max_discount_percent': null, 'campaign.max_audience': null },
  ADMIN: { 'pricing.max_discount_percent': 10, 'campaign.max_audience': 5000 },
  SALES: { 'pricing.max_discount_percent': 5 },
  RESEARCHER: {},
  VIEWER: {},
};
