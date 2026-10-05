/**
 * Development seed (docs/17 Phase 2/3): workspace, owner + one demo user per role, roles, permissions,
 * default pipeline, policy skeleton. Idempotent — safe to run repeatedly. Contains no production secrets.
 * Run: `pnpm db:seed` (after `pnpm db:deploy`).
 */
import { existsSync } from 'node:fs';
import type { RoleKey } from '@revenue-os/shared';
import { hashPassword } from '@revenue-os/shared/server';
import { createPrismaClient } from './index.js';
import { provisionWorkspaceDefaults } from './bootstrap.js';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set — run `pnpm setup` first.');
if (process.env.APP_ENV === 'production') throw new Error('Refusing to run the development seed in production.');

/** Development-only password shared by the demo users. Override with SEED_PASSWORD. */
const PASSWORD = process.env.SEED_PASSWORD ?? 'rankhighlead-dev';

const USERS: { email: string; name: string; role: RoleKey }[] = [
  { email: process.env.SEED_OWNER_EMAIL ?? 'owner@rankhighlead.dev', name: 'Workspace Owner', role: 'OWNER' },
  { email: 'admin@rankhighlead.dev', name: 'Ayesha Admin', role: 'ADMIN' },
  { email: 'sales@rankhighlead.dev', name: 'Sam Sales', role: 'SALES' },
  { email: 'researcher@rankhighlead.dev', name: 'Rida Researcher', role: 'RESEARCHER' },
  { email: 'viewer@rankhighlead.dev', name: 'Vik Viewer', role: 'VIEWER' },
];

const db = createPrismaClient(databaseUrl);

try {
  const passwordHash = await hashPassword(PASSWORD);
  await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.upsert({
      where: { slug: 'dev' },
      create: { name: 'Rank High Lead (Dev)', slug: 'dev' },
      update: {},
    });
    const roleIds = await provisionWorkspaceDefaults(tx, workspace.id);

    for (const u of USERS) {
      const user = await tx.user.upsert({
        where: { email: u.email },
        create: { email: u.email, name: u.name, status: 'ACTIVE', passwordHash, passwordUpdatedAt: new Date() },
        update: {},
      });
      // Existing users keep their password unless they never had one.
      if (!user.passwordHash) {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordUpdatedAt: new Date(), status: 'ACTIVE' } });
      }
      const member = await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
        create: { workspaceId: workspace.id, userId: user.id, status: 'ACTIVE' },
        update: {},
      });
      await tx.userRole.createMany({
        data: [{ workspaceId: workspace.id, memberId: member.id, roleId: roleIds[u.role] }],
        skipDuplicates: true,
      });
    }

    console.log(`✓ Seeded workspace "${workspace.name}" (slug: ${workspace.slug})`);
    console.log(`  Sign in at http://localhost:3000/login — password for every demo user: ${process.env.SEED_PASSWORD ? '(SEED_PASSWORD)' : PASSWORD}`);
    for (const u of USERS) console.log(`  ${u.role.padEnd(10)} ${u.email}`);
    // maxWait: on a cold Docker database the first connection can take longer than the 2 s default (P2028).
  }, { timeout: 60_000, maxWait: 20_000 });
} finally {
  await db.$disconnect();
}
