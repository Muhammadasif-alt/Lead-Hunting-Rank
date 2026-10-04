import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hashPassword } from '@revenue-os/shared/server';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../../app-setup.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { QueueService } from '../../infra/queue.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';
import { MAX_FAILURES_PER_ACCOUNT } from './login-throttle.service.js';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'green lawns in austin';

/** End-to-end through the real HTTP pipeline (guards, cookies, envelopes) against the test database. */
describe('Phase 3 — authentication over HTTP', () => {
  let app: INestApplication;
  let base: string;
  let close: () => Promise<void>;
  let owner: string, viewer: string, otherWorkspaceId: string;

  const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
    fetch(`${base}/api${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  const login = async (email: string, password = PASSWORD) => {
    const res = await call('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    return { res, cookie, body: (await res.json()) as any };
  };

  before(async () => {
    const db = await setupTestDatabase();
    const { prisma } = db;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
    close = async () => {
      await app.close();
      await db.close();
    };

    // Per-IP failure counters accumulate across runs from 127.0.0.1 — start each run clean.
    const redis = app.get(QueueService).redis;
    const stale = await redis.keys('auth:fail:ip:*');
    if (stale.length) await redis.del(...stale);

    const workspaces = new WorkspaceService(prisma);
    owner = `${uniqueSlug('owner')}@example.com`;
    viewer = `${uniqueSlug('viewer')}@example.com`;
    const ws = await workspaces.createWorkspace(SYSTEM_ACTOR, { name: 'E2E', slug: uniqueSlug('e2e'), owner: { email: owner, name: 'Owner' } });
    await workspaces.addMember({ workspaceId: ws.workspace.id, actor: SYSTEM_ACTOR }, { email: viewer, name: 'Viewer', role: 'VIEWER' });
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.client.user.updateMany({ where: { email: { in: [owner, viewer] } }, data: { passwordHash, status: 'ACTIVE' } });
    await prisma.client.workspaceMember.updateMany({ where: { workspaceId: ws.workspace.id }, data: { status: 'ACTIVE' } });
    const other = await workspaces.createWorkspace(SYSTEM_ACTOR, {
      name: 'Elsewhere',
      slug: uniqueSlug('else'),
      owner: { email: `${uniqueSlug('x')}@example.com`, name: 'X' },
    });
    otherWorkspaceId = other.workspace.id;
  });

  after(async () => close());

  test('health stays public', async () => {
    assert.equal((await call('/health/live')).status, 200);
  });

  test('protected routes need a session', async () => {
    const res = await call('/v1/auth/me');
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as any).error.code, 'UNAUTHENTICATED');
  });

  test('wrong password and unknown email give the same generic 401', async () => {
    const wrong = await login(owner, 'definitely not it');
    const unknown = await login(`${uniqueSlug('nobody')}@example.com`);
    assert.equal(wrong.res.status, 401);
    assert.equal(unknown.res.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
  });

  test('login sets an HttpOnly SameSite cookie and returns the profile — never the hash', async () => {
    const { res, body } = await login(owner);
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /^rhl_session=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.deepEqual(body.data.roles, ['OWNER']);
    assert.ok(body.data.permissions.includes('policy.manage'));
    assert.ok(!JSON.stringify(body).includes('argon2'));
  });

  test('permissions are enforced server-side', async () => {
    const asViewer = await login(viewer);
    const denied = await call('/v1/workspace/members', {
      method: 'POST',
      cookie: asViewer.cookie,
      body: JSON.stringify({ email: `${uniqueSlug('new')}@example.com`, name: 'New', role: 'SALES' }),
    });
    assert.equal(denied.status, 403);
    assert.equal(((await denied.json()) as any).error.code, 'FORBIDDEN');

    const asOwner = await login(owner);
    const created = await call('/v1/workspace/members', {
      method: 'POST',
      cookie: asOwner.cookie,
      body: JSON.stringify({ email: `${uniqueSlug('new')}@example.com`, name: 'New', role: 'SALES' }),
    });
    assert.equal(created.status, 201);
    const list = (await (await call('/v1/workspace/members', { cookie: asViewer.cookie })).json()) as any;
    assert.equal(list.data.length, 3, 'viewers can read the member list');
  });

  test('another workspace cannot be reached by naming it', async () => {
    const { cookie } = await login(owner);
    const res = await call('/v1/auth/me', { cookie, headers: { 'x-workspace-id': otherWorkspaceId } });
    assert.equal(res.status, 403);
  });

  test('cross-site and origin-less state changes are blocked (CSRF)', async () => {
    const { cookie } = await login(owner);
    const evil = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { origin: 'https://evil.example', cookie: cookie! } });
    assert.equal(evil.status, 403);
    const bare = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { cookie: cookie! } });
    assert.equal(bare.status, 403);
    assert.equal((await call('/v1/auth/me', { cookie })).status, 200, 'session survived the blocked requests');
  });

  test('logout revokes the session server-side', async () => {
    const { cookie } = await login(owner);
    assert.equal((await call('/v1/auth/logout', { method: 'POST', cookie })).status, 200);
    assert.equal((await call('/v1/auth/me', { cookie })).status, 401, 'old cookie is useless after logout');
  });

  test('sessions can be listed and revoked', async () => {
    const first = await login(owner);
    const second = await login(owner);
    const sessions = (await (await call('/v1/auth/sessions', { cookie: second.cookie })).json()) as any;
    const target = sessions.data.find((s: any) => !s.current);
    assert.ok(target);
    const revoke = await call(`/v1/auth/sessions/${target.id}`, { method: 'DELETE', cookie: second.cookie });
    assert.equal(revoke.status, 200);
    // At least one of the other sessions (possibly `first`) is now gone; the current one still works.
    assert.equal((await call('/v1/auth/me', { cookie: second.cookie })).status, 200);
    void first;
  });

  test('repeated failures lock the account temporarily — even the right password is refused', async () => {
    const email = `${uniqueSlug('locked')}@example.com`;
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++) await login(email, 'wrong password!!');
    const blocked = await login(email);
    assert.equal(blocked.res.status, 429);
    assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  });

  test('unknown fields in the login body are rejected', async () => {
    const res = await call('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: owner, password: PASSWORD, role: 'OWNER' }) });
    assert.equal(res.status, 400);
  });
});
