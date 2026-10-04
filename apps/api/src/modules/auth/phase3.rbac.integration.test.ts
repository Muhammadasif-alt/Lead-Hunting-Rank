import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { RoleKey } from '@revenue-os/shared';
import { AuthorityExceededError, ForbiddenError } from '@revenue-os/shared';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';
import { AccessService, type Access } from './access.service.js';

/** RBAC test matrix required by docs/17 §21-25. */
describe('Phase 3 — RBAC and authority', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let accessService: AccessService;
  let workspaceId: string;
  let otherOwner: string;
  const users = {} as Record<RoleKey, string>;
  const as = (role: RoleKey): Promise<Access> => accessService.resolve(users[role], workspaceId);

  before(async () => {
    ({ prisma, close } = await setupTestDatabase());
    accessService = new AccessService(prisma);
    const workspaces = new WorkspaceService(prisma);

    const a = await workspaces.createWorkspace(SYSTEM_ACTOR, {
      name: 'RBAC A',
      slug: uniqueSlug('rbac'),
      owner: { email: `${uniqueSlug('own')}@example.com`, name: 'Owner' },
    });
    workspaceId = a.workspace.id;
    users.OWNER = a.ownerUserId;
    const ctx = { workspaceId, actor: { type: 'HUMAN' as const, id: a.ownerUserId } };
    for (const role of ['ADMIN', 'SALES', 'RESEARCHER', 'VIEWER'] as const) {
      const m = await workspaces.addMember(ctx, { email: `${uniqueSlug(role.toLowerCase())}@example.com`, name: role, role });
      users[role] = m.userId;
    }
    // Invited members become ACTIVE once they accept (invite flow comes later) — activate directly here.
    await prisma.client.workspaceMember.updateMany({ where: { workspaceId }, data: { status: 'ACTIVE' } });

    const b = await workspaces.createWorkspace(SYSTEM_ACTOR, {
      name: 'RBAC B',
      slug: uniqueSlug('rbac'),
      owner: { email: `${uniqueSlug('own')}@example.com`, name: 'Other owner' },
    });
    otherOwner = b.ownerUserId;
  });

  after(async () => close());

  test('cross-workspace access is denied, even for an owner', async () => {
    await assert.rejects(accessService.resolve(otherOwner, workspaceId), ForbiddenError);
  });

  test('viewer cannot write', async () => {
    const viewer = await as('VIEWER');
    assert.ok(accessService.can(viewer, 'company.read'));
    for (const p of ['company.update', 'member.manage', 'campaign.create', 'conversation.send', 'task.manage'] as const) {
      assert.equal(accessService.can(viewer, p), false, `viewer must not have ${p}`);
    }
    assert.throws(() => accessService.assert(viewer, 'company.update'), ForbiddenError);
  });

  test('researcher cannot send or launch, but can research', async () => {
    const researcher = await as('RESEARCHER');
    assert.equal(accessService.can(researcher, 'conversation.send'), false);
    assert.equal(accessService.canLaunchCampaign(researcher, 10).allowed, false);
    assert.equal(accessService.canApprove(researcher, { type: 'discount', percent: 1 }).allowed, false);
    assert.ok(accessService.can(researcher, 'market.run'));
    assert.ok(accessService.can(researcher, 'evidence.manage'));
  });

  test('sales cannot change policy; discounts bounded by authority', async () => {
    const sales = await as('SALES');
    assert.equal(accessService.canChangePolicy(sales).allowed, false);
    assert.ok(accessService.can(sales, 'conversation.send'));
    assert.equal(accessService.canApprove(sales, { type: 'discount', percent: 5 }).allowed, true);
    const tooMuch = accessService.canApprove(sales, { type: 'discount', percent: 8 });
    assert.deepEqual([tooMuch.allowed, tooMuch.code], [false, 'AUTHORITY_EXCEEDED']);
    assert.throws(() => accessService.assertWithinLimit(sales, 'pricing.max_discount_percent', 8), AuthorityExceededError);
    assert.equal(accessService.canLaunchCampaign(sales, 1).allowed, false);
  });

  test('admin permissions respected — with owner-only operations held back', async () => {
    const admin = await as('ADMIN');
    assert.equal(accessService.canChangePolicy(admin).allowed, true);
    assert.equal(accessService.canLaunchCampaign(admin, 5000).allowed, true);
    assert.equal(accessService.canLaunchCampaign(admin, 5001).code, 'AUTHORITY_EXCEEDED');
    assert.equal(accessService.canApprove(admin, { type: 'discount', percent: 10 }).allowed, true);
    assert.equal(accessService.canApprove(admin, { type: 'discount', percent: 15 }).allowed, false);
    assert.equal(accessService.canResumeEmergencyStop(admin).allowed, false);
    assert.ok(accessService.can(admin, 'outbound.emergency_stop'), 'admins can stop, only owners resume');
    assert.equal(accessService.can(admin, 'data.export'), false);
  });

  test('owner authority respected', async () => {
    const owner = await as('OWNER');
    assert.equal(accessService.canApprove(owner, { type: 'discount', percent: 40 }).allowed, true);
    assert.equal(accessService.canLaunchCampaign(owner, 1_000_000).allowed, true);
    assert.equal(accessService.canResumeEmergencyStop(owner).allowed, true);
    assert.equal(accessService.canChangePolicy(owner).allowed, true);
  });

  test('explicit DENY wins over ALLOW', async () => {
    const role = await prisma.client.role.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId, key: 'SALES' } } });
    const perm = await prisma.client.permission.findUniqueOrThrow({ where: { key: 'conversation.send' } });
    await prisma.client.rolePermission.update({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      data: { effect: 'DENY' },
    });
    try {
      assert.equal(accessService.can(await as('SALES'), 'conversation.send'), false);
    } finally {
      await prisma.client.rolePermission.update({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        data: { effect: 'ALLOW' },
      });
    }
  });

  test('a member-specific authority limit overrides the role limit', async () => {
    const sales = await as('SALES');
    await prisma.client.authorityLimit.create({
      data: { workspaceId, memberId: sales.memberId, key: 'pricing.max_discount_percent', maxValue: 2, unit: 'PERCENT' },
    });
    const restricted = await as('SALES');
    assert.equal(accessService.canApprove(restricted, { type: 'discount', percent: 3 }).allowed, false);
    assert.equal(accessService.canApprove(restricted, { type: 'discount', percent: 2 }).allowed, true);
  });

  test('suspended members lose access immediately', async () => {
    await prisma.client.workspaceMember.updateMany({ where: { workspaceId, userId: users.VIEWER }, data: { status: 'SUSPENDED' } });
    await assert.rejects(as('VIEWER'), ForbiddenError);
  });
});
