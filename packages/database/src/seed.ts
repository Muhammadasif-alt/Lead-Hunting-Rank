/**
 * Development seed (docs/17 Phase 2): workspace, owner user, roles, permissions, default pipeline, policy skeleton.
 * Idempotent — safe to run repeatedly. Contains no production secrets.
 * Run: `pnpm db:seed` (after `pnpm db:migrate`).
 */
import { existsSync } from 'node:fs';
import { createPrismaClient } from './index.js';
import { provisionWorkspaceDefaults } from './bootstrap.js';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set — run `pnpm setup` first.');
if (process.env.APP_ENV === 'production') throw new Error('Refusing to run the development seed in production.');

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@rankhighlead.dev';
const db = createPrismaClient(databaseUrl);

try {
  await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.upsert({
      where: { slug: 'dev' },
      create: { name: 'Rank High Lead (Dev)', slug: 'dev' },
      update: {},
    });
    const roleIds = await provisionWorkspaceDefaults(tx, workspace.id);

    const owner = await tx.user.upsert({
      where: { email: OWNER_EMAIL },
      create: { email: OWNER_EMAIL, name: 'Workspace Owner', status: 'ACTIVE' },
      update: {},
    });
    const member = await tx.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } },
      create: { workspaceId: workspace.id, userId: owner.id, status: 'ACTIVE' },
      update: {},
    });
    await tx.userRole.createMany({
      data: [{ workspaceId: workspace.id, memberId: member.id, roleId: roleIds.OWNER }],
      skipDuplicates: true,
    });

    console.log(`✓ Seeded workspace "${workspace.name}" (slug: ${workspace.slug}) with owner ${owner.email}`);
  });
} finally {
  await db.$disconnect();
}
