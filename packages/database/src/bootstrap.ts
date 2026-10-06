import {
  AUTHORITY_LIMITS,
  DEFAULT_AUTHORITY_LIMITS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLES,
  type RoleKey,
} from '@revenue-os/shared';
import type { Prisma, PrismaClient } from './generated/prisma/client.js';

type Db = PrismaClient | Prisma.TransactionClient;

const ROLE_INFO: Record<RoleKey, { name: string; description: string }> = {
  OWNER: { name: 'Owner', description: 'Full control, including security, exports and resuming after an emergency stop.' },
  ADMIN: { name: 'Admin', description: 'Runs campaigns, team, knowledge, policies and integrations.' },
  SALES: { name: 'Sales', description: 'Works companies, conversations, opportunities and meetings.' },
  RESEARCHER: { name: 'Researcher', description: 'Markets, research, evidence and fact correction. No outbound.' },
  VIEWER: { name: 'Viewer', description: 'Read-only access.' },
};

const DEFAULT_PIPELINE_STAGES = [
  { name: 'New', stageType: 'OPEN' },
  { name: 'Qualified', stageType: 'OPEN' },
  { name: 'Meeting booked', stageType: 'OPEN' },
  { name: 'Proposal', stageType: 'OPEN' },
  { name: 'Negotiation', stageType: 'OPEN' },
  { name: 'Won', stageType: 'WON' },
  { name: 'Lost', stageType: 'LOST' },
] as const;

/** Hard safety rules (docs/10 §35-36). Shown read-only; enforced in code by @revenue-os/policy. */
const HARD_RULES = [
  { ruleType: 'NO_SEND_TO_SUPPRESSED', description: 'Never contact an actively suppressed email, phone, person, company or domain.' },
  { ruleType: 'NO_CROSS_WORKSPACE_ACCESS', description: 'No actor may read or change another workspace’s data.' },
  { ruleType: 'NO_DUPLICATE_EXTERNAL_ACTION', description: 'One idempotency key produces at most one external effect.' },
  { ruleType: 'NO_SECRETS_IN_AI_CONTEXT', description: 'Credentials and secrets never enter AI context.' },
  { ruleType: 'NO_AI_PERMISSION_ESCALATION', description: 'AI never gains authority because a human has it.' },
  { ruleType: 'KILL_SWITCH_BLOCKS_OUTBOUND', description: 'Emergency stop blocks every outbound action.' },
] as const;

/** Upserts the global permission catalog from @revenue-os/shared. Idempotent. */
export async function syncPermissionCatalog(db: Db): Promise<Map<string, string>> {
  for (const key of PERMISSION_KEYS) {
    const { class: actionClass, description } = PERMISSIONS[key];
    await db.permission.upsert({
      where: { key },
      create: { key, description, actionClass },
      update: { description, actionClass },
    });
  }
  const rows = await db.permission.findMany({ select: { id: true, key: true } });
  return new Map(rows.map((r) => [r.key, r.id]));
}

/**
 * Creates the defaults every workspace needs: system roles + grants, role authority limits, the default pipeline
 * and the policy skeleton. Idempotent, so it can run on existing workspaces after the catalog grows.
 * Call inside the same transaction that creates the workspace.
 */
export async function provisionWorkspaceDefaults(db: Db, workspaceId: string): Promise<Record<RoleKey, string>> {
  const permissionIds = await syncPermissionCatalog(db);
  const roleIds = {} as Record<RoleKey, string>;

  for (const key of ROLES) {
    const role = await db.role.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      create: { workspaceId, key, ...ROLE_INFO[key] },
      update: {},
    });
    roleIds[key] = role.id;

    await db.rolePermission.createMany({
      data: DEFAULT_ROLE_PERMISSIONS[key].map((p) => ({ roleId: role.id, permissionId: permissionIds.get(p)! })),
      skipDuplicates: true,
    });

    for (const [limitKey, maxValue] of Object.entries(DEFAULT_AUTHORITY_LIMITS[key])) {
      const unit = AUTHORITY_LIMITS[limitKey as keyof typeof AUTHORITY_LIMITS].unit;
      const existing = await db.authorityLimit.findFirst({ where: { workspaceId, roleId: role.id, key: limitKey } });
      if (!existing) await db.authorityLimit.create({ data: { workspaceId, roleId: role.id, key: limitKey, maxValue, unit } });
    }
  }

  const pipeline = await db.pipeline.upsert({
    where: { workspaceId_name: { workspaceId, name: 'Sales pipeline' } },
    create: { workspaceId, name: 'Sales pipeline', isDefault: true },
    update: {},
  });
  await db.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s, position) => ({
      workspaceId,
      pipelineId: pipeline.id,
      name: s.name,
      position,
      stageType: s.stageType,
      isClosed: s.stageType !== 'OPEN',
      isWon: s.stageType === 'WON',
      isLost: s.stageType === 'LOST',
    })),
    skipDuplicates: true,
  });

  const policy = await db.policy.upsert({
    where: { workspaceId_name: { workspaceId, name: 'Hard safety rules' } },
    create: { workspaceId, name: 'Hard safety rules', policyType: 'HARD_SAFETY', status: 'ACTIVE', priority: 0 },
    update: {},
  });
  await db.policyRule.createMany({
    data: HARD_RULES.map((r) => ({
      workspaceId,
      policyId: policy.id,
      ruleType: r.ruleType,
      description: r.description,
      conditionJson: {},
      effect: 'BLOCK' as const,
      isHardRule: true,
      priority: 0,
    })),
    skipDuplicates: true,
  });

  return roleIds;
}
