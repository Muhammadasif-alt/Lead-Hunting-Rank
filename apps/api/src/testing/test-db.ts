import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@revenue-os/config';
import { createPrismaClient, type PrismaClient } from '@revenue-os/database';
import type { PrismaService } from '../infra/prisma.service.js';
import type { ServiceContext } from '../domain/service-context.js';

const databaseDir = fileURLToPath(new URL('../../../../packages/database/', import.meta.url));

/**
 * Integration tests run against a separate `<db>_test` database on the same Postgres (or TEST_DATABASE_URL).
 * It is created and migrated on first use. Tests create uniquely named workspaces instead of truncating —
 * AuditLog is append-only, and workspace isolation keeps runs independent.
 */
export async function setupTestDatabase(): Promise<{ prisma: PrismaService; close: () => Promise<void> }> {
  const devUrl = new URL(loadConfig().DATABASE_URL);
  const testUrl = new URL(process.env.TEST_DATABASE_URL ?? devUrl.href);
  if (!process.env.TEST_DATABASE_URL) testUrl.pathname = `${devUrl.pathname}_test`;
  const testDb = decodeURIComponent(testUrl.pathname.slice(1));

  const admin = createPrismaClient(devUrl.href);
  try {
    const rows = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${testDb}`;
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${testDb.replace(/"/g, '""')}"`);
  } catch (err) {
    throw new Error(`Cannot reach Postgres for integration tests — is Docker running? (pnpm infra:up)\n${String(err)}`);
  } finally {
    await admin.$disconnect();
  }

  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: databaseDir,
    env: { ...process.env, DATABASE_URL: testUrl.href },
    stdio: 'pipe',
  });

  const client: PrismaClient = createPrismaClient(testUrl.href);
  return { prisma: { client } as PrismaService, close: () => client.$disconnect() };
}

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const SYSTEM_ACTOR: ServiceContext['actor'] = { type: 'SYSTEM', id: null };
