import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { executeExternalAction, type ActionExecutor } from '@revenue-os/events';
import {
  addSuppression,
  createPolicyRevalidator,
  decideApproval,
  liftSuppression,
  memberPermissions,
  policySweep,
  requestExternalAction,
  setOutboundState,
  simulatePolicy,
  updatePolicy,
} from '@revenue-os/policy';
import { DEFAULT_POLICY_SETTINGS, ForbiddenError, normalizeCompanyName, PolicyError, type RoleKey } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';

/**
 * Phase 10 (docs/17 §62-66, docs/10): every external action goes prepare → Policy Engine → queue / ask / wait / block,
 * and is decided again right before the provider call. Definition of Done: a suppressed contact, the kill switch, an
 * unauthorized AI, a stale approval and a policy failure can never lead to a send.
 */
describe('Phase 10 — Policy Engine', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  const sent: string[] = [];
  const executors: Record<string, ActionExecutor> = {
    'email.send': {
      execute: async (a) => {
        sent.push(a.id);
        return { providerRef: `msg-${a.id}` };
      },
    },
  };

  // Deterministic regardless of when the tests run: no sending hours, no cool-down.
  const OPEN = { ...DEFAULT_POLICY_SETTINGS, sendWindow: { ...DEFAULT_POLICY_SETTINGS.sendWindow, enabled: false }, contactCooldownDays: 0 };

  const setup = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, { name: 'Policy Test', slug: uniqueSlug('pol'), owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner' } });
    const owner: ServiceContext = { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } };
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { settings: OPEN }));
    const company = await prisma.client.company.create({ data: { workspaceId: owner.workspaceId, displayName: 'Target Co', normalizedName: normalizeCompanyName('Target Co'), websiteDomain: 'target.example' } });
    return { owner, company };
  };
  const member = async (owner: ServiceContext, role: RoleKey): Promise<ServiceContext> => {
    const m = await new WorkspaceService(prisma).addMember(owner, { email: `${uniqueSlug(role.toLowerCase())}@example.com`, name: role, role });
    await prisma.client.workspaceMember.update({ where: { id: m.memberId }, data: { status: 'ACTIVE' } });
    return { workspaceId: owner.workspaceId, actor: { type: 'HUMAN', id: m.userId } };
  };
  const perms = async (ctx: ServiceContext) => new Set((await memberPermissions(prisma.client, ctx.workspaceId, ctx.actor.id!)) ?? []);
  const ai = (owner: ServiceContext): ServiceContext => ({ workspaceId: owner.workspaceId, actor: { type: 'AI_AGENT', id: null } });

  const send = (ctx: ServiceContext, companyId: string, to: string, opts: { agent?: string; key?: string; actionType?: string } = {}) =>
    requestExternalAction(prisma.client, ctx, {
      actionType: opts.actionType ?? 'email.send',
      provider: 'fake_email',
      entityType: 'COMPANY',
      entityId: companyId,
      idempotencyKey: opts.key ?? uniqueSlug('send'),
      payload: { from: 'me@ours.example', to: [to], subject: 'Hello', text: 'A short note' },
      requestedByAgent: opts.agent,
    });
  const run = (ctx: ServiceContext, id: string) => executeExternalAction(prisma.client, { workspaceId: ctx.workspaceId, externalActionId: id }, { executors, revalidate: createPolicyRevalidator() });
  const status = async (id: string) => (await prisma.client.externalAction.findUniqueOrThrow({ where: { id } })).status;

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
  });
  after(async () => close());

  test('a permitted send: decided at prepare and again at execution, both recorded', async () => {
    const { owner, company } = await setup();
    const { action, decision } = await send(owner, company.id, 'Ann@Target.example');
    assert.equal(decision?.decision, 'ACT');
    assert.equal(action.status, 'QUEUED');
    assert.equal(action.requestedByType, 'HUMAN');
    assert.equal(await run(owner, action.id), 'SUCCEEDED');
    assert.ok(sent.includes(action.id));
    const decisions = await prisma.client.policyDecision.findMany({ where: { externalActionId: action.id }, orderBy: { evaluatedAt: 'asc' } });
    assert.deepEqual(decisions.map((d) => [d.stage, d.decision]), [['PREPARE', 'ACT'], ['EXECUTION', 'ACT']]);
    assert.ok(decisions[0]!.policyVersion >= 2, 'decisions keep the policy version they were made under');
    // Decisions are a record — never rewritten.
    await assert.rejects(prisma.client.policyDecision.update({ where: { id: decisions[0]!.id }, data: { reasonSummary: 'x' } }));
    // Same idempotency key → same action, no second decision.
    const again = await send(owner, company.id, 'Ann@Target.example', { key: action.idempotencyKey });
    assert.equal(again.action.id, action.id);
    assert.equal(again.decision, null);
  });

  test('DoD: a suppressed contact cannot be sent to — pending actions are cancelled, the execution gate blocks the rest', async () => {
    const { owner, company } = await setup();
    const queued = await send(owner, company.id, 'bob@target.example');
    assert.equal(queued.action.status, 'QUEUED');
    const s = await prisma.client.$transaction((tx) => addSuppression(tx, owner, { scope: 'EMAIL', value: 'Bob@Target.example', reason: 'UNSUBSCRIBED' }));
    assert.equal(s.cancelledActions, 1);
    assert.equal(await status(queued.action.id), 'CANCELLED');

    const blocked = await send(owner, company.id, 'bob@target.example');
    assert.deepEqual([blocked.action.status, blocked.decision?.reasonCodes], ['BLOCKED', ['SUPPRESSED_CONTACT']]);

    // A domain suppression covers every address at the domain.
    await prisma.client.$transaction((tx) => addSuppression(tx, owner, { scope: 'DOMAIN', value: 'https://www.other.example', reason: 'DO_NOT_CONTACT' }));
    assert.equal((await send(owner, company.id, 'anyone@other.example')).action.status, 'BLOCKED');

    // Suppressed after it was queued, without the cancel step (e.g. a racing unsubscribe): the worker still won't send.
    const racing = await send(owner, company.id, 'carol@target.example');
    await prisma.client.suppression.create({ data: { workspaceId: owner.workspaceId, scope: 'COMPANY', value: company.id, reason: 'COMPLAINT', createdByType: 'SYSTEM' } });
    const before = sent.length;
    assert.equal(await run(owner, racing.action.id), 'BLOCKED');
    assert.equal(sent.length, before, 'the provider was never called');

    // Unsubscribes can't be lifted; a manual entry can. Suppressions are never deleted.
    await assert.rejects(prisma.client.$transaction((tx) => liftSuppression(tx, owner, s.suppression.id, 'please')), PolicyError);
    const manual = await prisma.client.$transaction((tx) => addSuppression(tx, owner, { scope: 'EMAIL', value: 'dan@target.example', reason: 'MANUAL' }));
    assert.equal((await prisma.client.$transaction((tx) => liftSuppression(tx, owner, manual.suppression.id, 'Added by mistake'))).status, 'LIFTED');
    await assert.rejects(prisma.client.suppression.delete({ where: { id: manual.suppression.id } }));
  });

  test('DoD: the kill switch stops sending — emergency stop blocks queued actions, pause waits and resumes one by one', async () => {
    const { owner, company } = await setup();
    const sales = await member(owner, 'SALES');
    const ownerPerms = await perms(owner);

    // Emergency stop: needs the permission; queued work is blocked at execution, never sent.
    await assert.rejects(prisma.client.$transaction(async (tx) => setOutboundState(tx, sales, await perms(sales), 'EMERGENCY_STOP', 'test')), ForbiddenError);
    const queued = await send(owner, company.id, 'erin@target.example');
    await prisma.client.$transaction((tx) => setOutboundState(tx, owner, ownerPerms, 'EMERGENCY_STOP', 'Mailbox looks compromised'));
    const before = sent.length;
    assert.equal(await run(owner, queued.action.id), 'BLOCKED');
    assert.equal(sent.length, before);
    assert.equal((await send(owner, company.id, 'erin2@target.example')).decision?.reasonCodes[0], 'GLOBAL_EMERGENCY_STOP');
    // Resuming after an emergency stop is owner-only.
    await assert.rejects(prisma.client.$transaction(async (tx) => setOutboundState(tx, sales, await perms(sales), 'ACTIVE', null)), ForbiddenError);
    await prisma.client.$transaction((tx) => setOutboundState(tx, owner, ownerPerms, 'ACTIVE', null));

    // Pause: new sends wait; the sweep leaves them while paused, and re-queues them (revalidated) after resuming.
    await prisma.client.$transaction(async (tx) => setOutboundState(tx, sales, await perms(sales), 'PAUSED', 'Checking copy'));
    const waiting = await send(owner, company.id, 'fay@target.example');
    assert.deepEqual([waiting.action.status, waiting.decision?.reasonCodes], ['WAITING', ['GLOBAL_OUTBOUND_PAUSED']]);
    await policySweep(prisma.client, new Date(Date.now() + 60_000));
    assert.equal(await status(waiting.action.id), 'WAITING');
    await prisma.client.$transaction(async (tx) => setOutboundState(tx, sales, await perms(sales), 'ACTIVE', null));
    await policySweep(prisma.client, new Date(Date.now() + 60_000));
    assert.equal(await status(waiting.action.id), 'QUEUED');
    assert.equal(await run(owner, waiting.action.id), 'SUCCEEDED');

    const changes = await prisma.client.domainEvent.count({ where: { workspaceId: owner.workspaceId, eventType: 'OutboundStateChanged' } });
    assert.equal(changes, 4);
  });

  test('DoD: unauthorized AI cannot send — no authority blocks, low autonomy asks, a human without permission is blocked', async () => {
    const { owner, company } = await setup();
    const research = await send(ai(owner), company.id, 'gus@target.example', { agent: 'RESEARCH' });
    assert.deepEqual([research.action.status, research.decision?.reasonCodes], ['BLOCKED', ['AI_NOT_AUTHORIZED']]);

    const campaign = await send(ai(owner), company.id, 'gus@target.example', { agent: 'CAMPAIGN' });
    assert.equal(campaign.action.status, 'WAITING_APPROVAL');
    assert.deepEqual(campaign.decision?.reasonCodes, ['AUTONOMY_TOO_LOW', 'FIRST_TOUCH_REQUIRES_APPROVAL']);
    assert.ok(campaign.approvalId);
    // The AI can't approve its own action, and nothing runs while it waits.
    await assert.rejects(decideApproval(prisma.client, ai(owner), campaign.approvalId!, 'APPROVE'), ForbiddenError);
    assert.equal(await run(owner, campaign.action.id), 'NOT_EXECUTABLE');

    const viewer = await member(owner, 'VIEWER');
    const v = await send(viewer, company.id, 'gus@target.example');
    assert.deepEqual([v.action.status, v.decision?.reasonCodes], ['BLOCKED', ['INSUFFICIENT_PERMISSION']]);

    // At L3 without first-touch approval the Campaign agent may send on its own — the policy, not the prompt, decides.
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L3', settings: { ...OPEN, firstTouchApproval: false } }));
    const auto = await send(ai(owner), company.id, 'hal@target.example', { agent: 'CAMPAIGN' });
    assert.equal(auto.action.status, 'QUEUED');
    // …until the agent's authority is lowered: the gate re-checks at execution.
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L1' }));
    assert.equal(await run(owner, auto.action.id), 'BLOCKED');
  });

  test('DoD: a stale approval cannot send — edited, expired or re-decided approvals never lead to a send', async () => {
    const { owner, company } = await setup();
    const sales = await member(owner, 'SALES');

    // Approved → queued → executed.
    const ok = await send(ai(owner), company.id, 'ivy@target.example', { agent: 'CAMPAIGN' });
    assert.equal(await decideApproval(prisma.client, sales, ok.approvalId!, 'APPROVE'), 'QUEUED');
    assert.equal(await run(owner, ok.action.id), 'SUCCEEDED');
    // The first decision wins.
    await assert.rejects(decideApproval(prisma.client, owner, ok.approvalId!, 'REJECT'), /already/);

    // Edited before approval → the approval is invalidated and the action cancelled.
    const edited = await send(ai(owner), company.id, 'jay@target.example', { agent: 'CAMPAIGN' });
    await prisma.client.externalAction.update({ where: { id: edited.action.id }, data: { payload: { from: 'me@ours.example', to: ['jay@target.example'], subject: 'Hello', text: '50% off today only' } } });
    assert.equal(await decideApproval(prisma.client, sales, edited.approvalId!, 'APPROVE'), 'INVALIDATED');
    assert.equal(await status(edited.action.id), 'CANCELLED');

    // Edited after approval, before the worker runs → blocked at execution.
    const late = await send(ai(owner), company.id, 'kim@target.example', { agent: 'CAMPAIGN' });
    assert.equal(await decideApproval(prisma.client, sales, late.approvalId!, 'APPROVE'), 'QUEUED');
    await prisma.client.externalAction.update({ where: { id: late.action.id }, data: { payload: { from: 'me@ours.example', to: ['kim@target.example'], subject: 'Hello', text: 'Changed after approval' } } });
    const before = sent.length;
    assert.equal(await run(owner, late.action.id), 'BLOCKED');
    assert.equal(sent.length, before);

    // Expired: deciding late, or the sweep, cancels it.
    const old = await send(ai(owner), company.id, 'lee@target.example', { agent: 'CAMPAIGN' });
    await prisma.client.approvalRequest.update({ where: { id: old.approvalId! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await decideApproval(prisma.client, sales, old.approvalId!, 'APPROVE'), 'EXPIRED');
    assert.equal(await status(old.action.id), 'CANCELLED');
    const swept = await send(ai(owner), company.id, 'mo@target.example', { agent: 'CAMPAIGN' });
    await prisma.client.approvalRequest.update({ where: { id: swept.approvalId! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.ok((await policySweep(prisma.client)).expired >= 1);
    assert.equal(await status(swept.action.id), 'CANCELLED');

    // Rejected → cancelled, never sent.
    const no = await send(ai(owner), company.id, 'ned@target.example', { agent: 'CAMPAIGN' });
    assert.equal(await decideApproval(prisma.client, sales, no.approvalId!, 'REJECT', 'Wrong tone'), 'REJECTED');
    assert.equal(await status(no.action.id), 'CANCELLED');
  });

  test('DoD: a policy failure never defaults to allow', async () => {
    const { owner, company } = await setup();
    // No policy for this action type → default deny.
    const unknown = await send(owner, company.id, 'oz@target.example', { actionType: 'payment.refund' });
    assert.deepEqual([unknown.action.status, unknown.decision?.reasonCodes], ['BLOCKED', ['POLICY_UNKNOWN_ACTION']]);

    // The policy can't be evaluated at execution (the requester can't be resolved) → it waits, the provider isn't called.
    const queued = await send(owner, company.id, 'pat@target.example');
    await prisma.client.externalAction.update({ where: { id: queued.action.id }, data: { requestedById: 'not-a-user-id' } });
    const before = sent.length;
    assert.equal(await run(owner, queued.action.id), 'WAITING');
    assert.equal(sent.length, before);
    const d = await prisma.client.policyDecision.findFirstOrThrow({ where: { externalActionId: queued.action.id, stage: 'EXECUTION' } });
    assert.deepEqual([d.decision, d.reasonCodes], ['BLOCK', ['POLICY_EVALUATION_FAILED']]);
  });

  test('rules and autonomy are versioned; the simulator shows what a draft would change without changing anything', async () => {
    const { owner, company } = await setup();
    const v1 = (await prisma.client.policy.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, name: 'Workspace rules' } })).version;
    await send(ai(owner), company.id, 'quinn@target.example', { agent: 'CAMPAIGN' }); // history to replay

    const sim = await simulatePolicy(prisma.client, owner.workspaceId, { autonomyLevel: 'L3', settings: { ...OPEN, firstTouchApproval: false } });
    const first = sim.scenarios.find((s) => s.key === 'ai_first_touch')!;
    assert.deepEqual([first.current.decision, first.draft.decision, first.changed], ['ASK', 'ACT', true]);
    // Hard rules hold under any draft.
    for (const key of ['suppressed', 'emergency', 'research_agent_send', 'viewer_send']) assert.equal(sim.scenarios.find((s) => s.key === key)!.draft.decision, 'BLOCK', key);
    assert.ok(sim.history.replayed >= 1);
    assert.ok(sim.history.changes.some((c) => c.current.decision === 'ASK' && c.draft.decision === 'ACT'));
    // Nothing was saved.
    assert.equal((await prisma.client.policy.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, name: 'Workspace rules' } })).version, v1);

    const r = await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L2' }));
    assert.deepEqual([r.version, r.changedFields], [v1 + 1, ['autonomyLevel']]);
    await assert.rejects(prisma.client.$transaction((tx) => updatePolicy(tx, owner, { settings: { ...OPEN, sendWindow: { enabled: true, startHour: 17, endHour: 9, days: [1] } } })), /end after/);
  });
});
