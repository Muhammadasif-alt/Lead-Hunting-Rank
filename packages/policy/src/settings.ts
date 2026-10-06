import type { Prisma, PrismaClient } from '@revenue-os/database';
import { DEFAULT_POLICY_SETTINGS, ValidationError, type PolicySettings } from '@revenue-os/shared';

type Db = PrismaClient | Prisma.TransactionClient;

export const WORKSPACE_RULES_POLICY = 'Workspace rules';

/** Each configurable setting is one PolicyRule row (docs/10 §76-92 rule structure); its parameters live in conditionJson. */
const RULES = {
  FIRST_TOUCH_APPROVAL: { effect: 'REQUIRE_APPROVAL', description: 'AI first messages to a new contact need approval' },
  SEND_WINDOW: { effect: 'WAIT', description: 'Send only inside working hours (workspace time zone)' },
  DAILY_SEND_LIMIT: { effect: 'WAIT', description: 'At most N outbound emails per day' },
  CONTACT_COOLDOWN: { effect: 'WAIT', description: 'Minimum days between two messages to the same address' },
  APPROVAL_TTL: { effect: 'REQUIRE_APPROVAL', description: 'How long an approval stays valid' },
} as const;
type RuleType = keyof typeof RULES;

function toConditions(s: PolicySettings): Record<RuleType, Record<string, unknown>> {
  return {
    FIRST_TOUCH_APPROVAL: { enabled: s.firstTouchApproval },
    SEND_WINDOW: { ...s.sendWindow },
    DAILY_SEND_LIMIT: { limit: s.dailySendLimit },
    CONTACT_COOLDOWN: { days: s.contactCooldownDays },
    APPROVAL_TTL: { hours: s.approvalTtlHours },
  };
}

function fromConditions(rows: { ruleType: string; conditionJson: unknown }[]): PolicySettings {
  const c = Object.fromEntries(rows.map((r) => [r.ruleType, (r.conditionJson ?? {}) as Record<string, unknown>]));
  const d = DEFAULT_POLICY_SETTINGS;
  const w = (c.SEND_WINDOW ?? {}) as Partial<PolicySettings['sendWindow']>;
  return {
    firstTouchApproval: typeof c.FIRST_TOUCH_APPROVAL?.enabled === 'boolean' ? c.FIRST_TOUCH_APPROVAL.enabled : d.firstTouchApproval,
    sendWindow: {
      enabled: typeof w.enabled === 'boolean' ? w.enabled : d.sendWindow.enabled,
      startHour: typeof w.startHour === 'number' ? w.startHour : d.sendWindow.startHour,
      endHour: typeof w.endHour === 'number' ? w.endHour : d.sendWindow.endHour,
      days: Array.isArray(w.days) ? w.days.filter((x): x is number => typeof x === 'number') : d.sendWindow.days,
    },
    dailySendLimit: c.DAILY_SEND_LIMIT && 'limit' in c.DAILY_SEND_LIMIT ? (c.DAILY_SEND_LIMIT.limit as number | null) : d.dailySendLimit,
    contactCooldownDays: typeof c.CONTACT_COOLDOWN?.days === 'number' ? c.CONTACT_COOLDOWN.days : d.contactCooldownDays,
    approvalTtlHours: typeof c.APPROVAL_TTL?.hours === 'number' ? c.APPROVAL_TTL.hours : d.approvalTtlHours,
  };
}

/** Throws ValidationError for settings that make no sense (e.g. a window that ends before it starts). */
export function validateSettings(s: PolicySettings): void {
  const w = s.sendWindow;
  const int = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!int(w.startHour, 0, 23) || !int(w.endHour, 1, 24) || w.endHour <= w.startHour) throw new ValidationError('Sending hours must end after they start (0–24)');
  if (w.enabled && (!w.days.length || w.days.some((d) => !int(d, 0, 6)))) throw new ValidationError('Pick at least one sending day');
  if (s.dailySendLimit !== null && !int(s.dailySendLimit, 0, 100_000)) throw new ValidationError('Daily limit must be a whole number from 0 to 100000');
  if (!int(s.contactCooldownDays, 0, 365)) throw new ValidationError('Cool-down must be 0–365 days');
  if (!int(s.approvalTtlHours, 1, 24 * 30)) throw new ValidationError('Approvals must stay valid for 1 hour to 30 days');
}

/** The workspace's rules and their version, created with the defaults the first time (idempotent). */
export async function loadPolicySettings(db: Db, workspaceId: string): Promise<{ policyId: string; version: number; settings: PolicySettings }> {
  let policy = await db.policy.findUnique({ where: { workspaceId_name: { workspaceId, name: WORKSPACE_RULES_POLICY } }, include: { rules: true } });
  if (!policy) {
    await db.policy.createMany({
      data: [{ workspaceId, name: WORKSPACE_RULES_POLICY, policyType: 'WORKSPACE_RULES', status: 'ACTIVE', priority: 50 }],
      skipDuplicates: true,
    });
    policy = await db.policy.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId, name: WORKSPACE_RULES_POLICY } }, include: { rules: true } });
  }
  if (policy.rules.length < Object.keys(RULES).length) {
    const conditions = toConditions(DEFAULT_POLICY_SETTINGS);
    await db.policyRule.createMany({
      data: (Object.keys(RULES) as RuleType[]).map((ruleType) => ({
        workspaceId,
        policyId: policy!.id,
        ruleType,
        conditionJson: conditions[ruleType] as Prisma.InputJsonValue,
        effect: RULES[ruleType].effect,
        description: RULES[ruleType].description,
      })),
      skipDuplicates: true,
    });
    policy = await db.policy.findUniqueOrThrow({ where: { id: policy.id }, include: { rules: true } });
  }
  return { policyId: policy.id, version: policy.version, settings: fromConditions(policy.rules) };
}

/** Writes new settings and bumps the policy version; historical decisions keep the version they were made under. */
export async function savePolicySettings(tx: Prisma.TransactionClient, workspaceId: string, settings: PolicySettings): Promise<number> {
  validateSettings(settings);
  const { policyId } = await loadPolicySettings(tx, workspaceId);
  const conditions = toConditions(settings);
  for (const ruleType of Object.keys(RULES) as RuleType[]) {
    await tx.policyRule.update({ where: { policyId_ruleType: { policyId, ruleType } }, data: { conditionJson: conditions[ruleType] as Prisma.InputJsonValue } });
  }
  const policy = await tx.policy.update({ where: { id: policyId }, data: { version: { increment: 1 } } });
  return policy.version;
}

/** Bumps the version without rule changes (e.g. the autonomy level changed). */
export async function bumpPolicyVersion(tx: Prisma.TransactionClient, workspaceId: string): Promise<number> {
  const { policyId } = await loadPolicySettings(tx, workspaceId);
  return (await tx.policy.update({ where: { id: policyId }, data: { version: { increment: 1 } } })).version;
}
