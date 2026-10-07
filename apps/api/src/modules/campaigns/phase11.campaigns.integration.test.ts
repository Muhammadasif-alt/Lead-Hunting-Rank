import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { executeExternalAction } from '@revenue-os/events';
import {
  checkCampaign,
  createCampaign,
  findAudience,
  launchCampaign,
  OPT_OUT_LINE,
  pauseCampaign,
  prepareStep,
  resumeCampaign,
  settleCampaignAction,
  sweepCampaigns,
  syncMailbox,
  unsubscribeByToken,
  withCampaignGuard,
  type OutreachDeps,
} from '@revenue-os/outreach';
import { createPolicyRevalidator, decideApproval, memberPermissions, policySweep, setOutboundState, updatePolicy } from '@revenue-os/policy';
import { createEmailSendExecutor, FakeEmailProvider, FakeLLMProvider } from '@revenue-os/providers';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { DEFAULT_POLICY_SETTINGS, normalizeCompanyName } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';

const DAY = 86_400_000;

/**
 * Phase 11 (docs/17 §67-76): a small controlled cohort can be enrolled, personalized, sent once, followed up, and
 * stopped by a reply, an unsubscribe, a bounce, a paused campaign or the kill switch — with audit and idempotency.
 * Real path end to end: Campaign Agent → validators → Policy Engine → ExternalAction → worker → test mailbox → sync.
 */
describe('Phase 11 — Campaigns + outreach', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let storage: string;
  let runtime: ProviderRuntime;
  let deps: OutreachDeps;
  const OPEN = { ...DEFAULT_POLICY_SETTINGS, sendWindow: { ...DEFAULT_POLICY_SETTINGS.sendWindow, enabled: false }, contactCooldownDays: 0, firstTouchApproval: true };

  const setup = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, { name: 'Outreach Test', slug: uniqueSlug('out'), owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner' } });
    const owner: ServiceContext = { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } };
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { settings: OPEN }));
    const mailbox = await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'fake_email', category: 'EMAIL', name: 'Test mailbox', accountRef: `sam@${uniqueSlug('ours')}.example`, capabilities: ['EMAIL_SEND', 'EMAIL_READ'], status: 'ACTIVE', connectedAt: new Date() } });
    await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'fake_llm', category: 'AI', name: 'Test model', capabilities: ['LLM_REASONING', 'LLM_EXTRACTION'], status: 'ACTIVE', connectedAt: new Date() } });
    return { owner, mailbox };
  };

  /** A company with an owner whose email passed verification — a contactable prospect. */
  const prospect = async (ctx: ServiceContext, name: string, first: string) => {
    const domain = `${uniqueSlug(first.toLowerCase())}.example`;
    const company = await prisma.client.company.create({ data: { workspaceId: ctx.workspaceId, displayName: name, normalizedName: normalizeCompanyName(name), websiteDomain: domain, industry: 'Plumbing', city: 'Austin' } });
    const person = await prisma.client.person.create({ data: { workspaceId: ctx.workspaceId, fullName: `${first} Smith`, firstName: first } });
    await prisma.client.employment.create({ data: { workspaceId: ctx.workspaceId, personId: person.id, companyId: company.id, title: 'Owner', isCurrent: true } });
    const email = `${first.toLowerCase()}@${domain}`;
    const cp = await prisma.client.contactPoint.create({ data: { workspaceId: ctx.workspaceId, entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: email, normalizedValue: email, status: 'VERIFIED' } });
    await prisma.client.contactVerification.create({ data: { workspaceId: ctx.workspaceId, contactPointId: cp.id, provider: 'fake_verification', status: 'VALID', verifiedAt: new Date() } });
    return { company, person, email, contactPointId: cp.id };
  };

  const campaign = async (ctx: ServiceContext, mailboxId: string, cohortSize = 5) => {
    const c = await prisma.client.$transaction((tx) => createCampaign(tx, ctx, { name: 'Austin plumbers', offer: 'websites with online booking', audience: { industries: ['plumb'] }, mailboxIntegrationId: mailboxId, senderName: 'Sam', cohortSize }));
    const check = await prisma.client.$transaction((tx) => checkCampaign(tx, ctx, c.id));
    assert.equal(check.ready, true, JSON.stringify(check.checks.filter((x) => !x.ok)));
    const { enrolled } = await prisma.client.$transaction((tx) => launchCampaign(tx, ctx, c.id));
    return { campaign: c, enrolled };
  };

  /** The sweep covers every workspace (as in the worker); each test looks at its own. */
  const jobsDue = async (ctx: ServiceContext, at = new Date()) => {
    const jobs: { workspaceId: string; enrollmentId: string; position: number }[] = [];
    await sweepCampaigns(prisma.client, async (j) => void jobs.push(j), at);
    return jobs.filter((j) => j.workspaceId === ctx.workspaceId);
  };
  const executors = () => ({ 'email.send': createEmailSendExecutor(runtime.gateway) });
  const run = async (workspaceId: string, actionId: string) => {
    const outcome = await executeExternalAction(prisma.client, { workspaceId, externalActionId: actionId }, { executors: executors(), revalidate: withCampaignGuard(createPolicyRevalidator()) });
    await settleCampaignAction(prisma.client, actionId);
    return outcome;
  };
  const messageFor = (enrollmentId: string, position: number) => prisma.client.campaignMessage.findFirstOrThrow({ where: { enrollmentId, position } });
  const enrollment = (id: string) => prisma.client.campaignEnrollment.findUniqueOrThrow({ where: { id } });
  const mailboxOf = async (integrationId: string) => runtime.factory.forIntegration({ id: integrationId, workspaceId: '', provider: 'fake_email' }) as FakeEmailProvider;
  const approve = async (owner: ServiceContext, actionId: string) => {
    const a = await prisma.client.approvalRequest.findFirstOrThrow({ where: { externalActionId: actionId, status: 'PENDING' } });
    return decideApproval(prisma.client, owner, a.id, 'APPROVE');
  };

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    storage = await mkdtemp(join(tmpdir(), 'rhl-phase11-'));
    runtime = createProviderRuntime(prisma.client, { appEnv: 'test', storagePath: storage });
    deps = { db: prisma.client, providers: runtime.gateway, publicUrl: 'http://localhost:3000' };
  });
  after(async () => {
    await close();
    await rm(storage, { recursive: true, force: true });
  });

  test('DoD: enroll → personalize → policy asks → approve → sent exactly once → follow-up scheduled and sent in the same thread', async () => {
    const { owner, mailbox } = await setup();
    const a = await prospect(owner, 'Golden Gate Plumbing', 'Ann');
    const { campaign: c, enrolled } = await campaign(owner, mailbox.id);
    assert.equal(enrolled, 1);

    const [job] = await jobsDue(owner);
    assert.ok(job);
    assert.equal(await prepareStep(deps, job), 'PREPARED');
    assert.equal(await prepareStep(deps, job), 'ALREADY_PREPARED', 'a second run of the same job does nothing');
    const e = await prisma.client.campaignEnrollment.findFirstOrThrow({ where: { campaignId: c.id } });
    const m1 = await messageFor(e.id, 1);
    // L1 autonomy: the AI's first email needs a person.
    assert.equal(m1.status, 'PENDING_APPROVAL');
    assert.ok(m1.body.startsWith('Hi Ann,'));
    const action = await prisma.client.externalAction.findUniqueOrThrow({ where: { id: m1.externalActionId! } });
    const payload = action.payload as { text: string; unsubscribeUrl: string; to: string[] };
    assert.deepEqual(payload.to, [a.email]);
    assert.ok(payload.text.endsWith(OPT_OUT_LINE), 'the system adds the opt-out line');
    assert.match(payload.unsubscribeUrl, /\/api\/v1\/public\/unsubscribe\/[A-Za-z0-9_-]+$/);
    assert.equal(action.requestedByAgent, 'CAMPAIGN');

    assert.equal(await approve(owner, action.id), 'QUEUED');
    const fake = await mailboxOf(mailbox.id);
    const before = fake.sends;
    assert.equal(await run(owner.workspaceId, action.id), 'SUCCEEDED');
    assert.equal(await run(owner.workspaceId, action.id), 'ALREADY_SUCCEEDED');
    assert.equal(fake.sends - before, 1, 'sent exactly once');
    const sent = await messageFor(e.id, 1);
    assert.equal(sent.status, 'SENT');
    const afterSend = await enrollment(e.id);
    assert.equal(afterSend.nextStepPosition, 2);
    assert.ok(afterSend.threadRef);
    const due = afterSend.nextStepDueAt!.getTime() - sent.sentAt!.getTime();
    assert.ok(due >= 3 * DAY && due < 3 * DAY + 5 * 3_600_000, 'follow-up 3 days later (plus a little spread)');

    // Nothing is due today; in four days the follow-up is. At L2 the AI may send a routine follow-up on its own.
    assert.equal((await jobsDue(owner)).length, 0);
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L2' }));
    const later = new Date(Date.now() + 4 * DAY);
    const [fu] = await jobsDue(owner, later);
    assert.equal(fu?.position, 2);
    assert.equal(await prepareStep({ ...deps, now: () => later }, fu!), 'PREPARED');
    const m2 = await messageFor(e.id, 2);
    assert.equal(m2.status, 'QUEUED', 'L2: follow-up goes without asking');
    const a2 = await prisma.client.externalAction.findUniqueOrThrow({ where: { id: m2.externalActionId! } });
    const p2 = a2.payload as { threadRef?: string; inReplyTo?: string; subject: string };
    assert.equal(p2.threadRef, afterSend.threadRef, 'same thread for the recipient');
    assert.ok(p2.inReplyTo?.startsWith('<ros-'));
    assert.equal(p2.subject, sent.subject);
    assert.equal(await run(owner.workspaceId, a2.id), 'SUCCEEDED');
    assert.equal((await enrollment(e.id)).nextStepPosition, 3);

    const events = await prisma.client.domainEvent.findMany({ where: { workspaceId: owner.workspaceId, eventType: { in: ['CampaignStarted', 'ProspectsEnrolled', 'CampaignMessageDrafted'] } } });
    assert.ok(events.length >= 4);
    assert.ok(await prisma.client.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'campaign.started' } }));
  });

  test('DoD: a reply stops the sequence — the queued follow-up is cancelled and never sent', async () => {
    const { owner, mailbox } = await setup();
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L3', settings: { ...OPEN, firstTouchApproval: false } }));
    const b = await prospect(owner, 'Bay Plumbing', 'Bob');
    const { campaign: c } = await campaign(owner, mailbox.id);
    const [job] = await jobsDue(owner);
    await prepareStep(deps, job!);
    const e = await prisma.client.campaignEnrollment.findFirstOrThrow({ where: { campaignId: c.id } });
    assert.equal(await run(owner.workspaceId, (await messageFor(e.id, 1)).externalActionId!), 'SUCCEEDED');
    const later = new Date(Date.now() + 4 * DAY);
    const [fu] = await jobsDue(owner, later);
    await prepareStep({ ...deps, now: () => later }, fu!);
    const m2 = await messageFor(e.id, 2);
    assert.equal(m2.status, 'QUEUED');

    // Bob replies in the thread; mailbox sync notices.
    const fake = await mailboxOf(mailbox.id);
    await fake.receive({ from: b.email, to: [mailbox.accountRef], subject: 'Re: hello', text: 'Sounds interesting — what does it cost?\n\nOn Mon, Sam wrote:\n> Hi Bob', threadId: (await enrollment(e.id)).threadRef! });
    const synced = await syncMailbox(prisma.client, runtime.gateway, mailbox);
    assert.equal(synced.kinds.REPLY, 1);
    const replied = await enrollment(e.id);
    assert.equal(replied.status, 'REPLIED');
    assert.equal((await messageFor(e.id, 2)).status, 'CANCELLED');
    const sendsBefore = fake.sends;
    assert.equal(await run(owner.workspaceId, m2.externalActionId!), 'NOT_EXECUTABLE');
    assert.equal(fake.sends, sendsBefore);
    // Syncing again sees nothing new; a later due date doesn't revive the sequence.
    assert.equal((await syncMailbox(prisma.client, runtime.gateway, mailbox)).seen, 0);
    assert.equal((await jobsDue(owner, new Date(Date.now() + 30 * DAY))).length, 0);
    assert.equal(await prisma.client.domainEvent.count({ where: { workspaceId: owner.workspaceId, eventType: 'EnrollmentReplied' } }), 1);
  });

  test('DoD: unsubscribe (link or reply) and bounces stop contact for good', async () => {
    const { owner, mailbox } = await setup();
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L3', settings: { ...OPEN, firstTouchApproval: false } }));
    const p1 = await prospect(owner, 'Clear Pipes', 'Cara');
    const p2 = await prospect(owner, 'Drain Pros', 'Dev');
    const p3 = await prospect(owner, 'Eagle Plumbing', 'Eve');
    const { campaign: c, enrolled } = await campaign(owner, mailbox.id);
    assert.equal(enrolled, 3);
    for (const j of await jobsDue(owner)) await prepareStep(deps, j);
    const rows = await prisma.client.campaignEnrollment.findMany({ where: { campaignId: c.id } });
    for (const r of rows) assert.equal(await run(owner.workspaceId, (await messageFor(r.id, 1)).externalActionId!), 'SUCCEEDED');
    const byEmail = (email: string) => rows.find((r) => r.email === email)!;

    // One-click link: suppressed, idempotent, and the prospect never gets a follow-up.
    assert.equal(await unsubscribeByToken(prisma.client, byEmail(p1.email).unsubscribeToken), true);
    assert.equal(await unsubscribeByToken(prisma.client, byEmail(p1.email).unsubscribeToken), true);
    assert.equal(await unsubscribeByToken(prisma.client, 'not-a-real-token-1234567890'), false);
    assert.equal((await enrollment(byEmail(p1.email).id)).status, 'SUPPRESSED');
    assert.equal(await prisma.client.suppression.count({ where: { workspaceId: owner.workspaceId, scope: 'EMAIL', value: p1.email, status: 'ACTIVE', reason: 'UNSUBSCRIBED' } }), 1);

    // "Please unsubscribe me" by reply, and a bounce from the mailer daemon.
    const fake = await mailboxOf(mailbox.id);
    await fake.receive({ from: p2.email, to: [mailbox.accountRef], subject: 'Re: hi', text: 'Please unsubscribe me.', threadId: byEmail(p2.email).threadRef! });
    await fake.receive({ from: 'mailer-daemon@googlemail.com', to: [mailbox.accountRef], subject: 'Delivery Status Notification (Failure)', text: `Address not found: ${p3.email}`, threadId: byEmail(p3.email).threadRef! });
    const synced = await syncMailbox(prisma.client, runtime.gateway, mailbox);
    assert.equal(synced.kinds.UNSUBSCRIBE, 1);
    assert.equal(synced.kinds.BOUNCE, 1);
    assert.equal((await enrollment(byEmail(p2.email).id)).status, 'SUPPRESSED');
    const bounced = await enrollment(byEmail(p3.email).id);
    assert.equal(bounced.status, 'BLOCKED');
    assert.equal((await prisma.client.contactPoint.findUniqueOrThrow({ where: { id: p3.contactPointId } })).status, 'INVALID');
    assert.equal((await jobsDue(owner, new Date(Date.now() + 30 * DAY))).length, 0, 'no follow-ups for any of them');

    // None of them is eligible for another campaign either.
    const audience = await findAudience(prisma.client, owner.workspaceId, { industries: ['plumb'] });
    assert.equal(audience.eligible.length, 0);
    assert.equal(audience.excluded.suppressed, 2);
  });

  test('DoD: the kill switch and a paused campaign stop sending; resuming re-checks before anything goes out', async () => {
    const { owner, mailbox } = await setup();
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L3', settings: { ...OPEN, firstTouchApproval: false } }));
    await prospect(owner, 'Flow Plumbing', 'Fay');
    await prospect(owner, 'Grand Plumbing', 'Gus');
    const { campaign: c } = await campaign(owner, mailbox.id);
    for (const j of await jobsDue(owner)) await prepareStep(deps, j);
    const [r1, r2] = await prisma.client.campaignEnrollment.findMany({ where: { campaignId: c.id }, orderBy: { email: 'asc' } });
    const fake = await mailboxOf(mailbox.id);
    const sendsBefore = fake.sends;

    // Paused campaign: the queued email waits, then goes after resuming (revalidated).
    await prisma.client.$transaction((tx) => pauseCampaign(tx, owner, c.id, 'Checking copy'));
    const a1 = (await messageFor(r1!.id, 1)).externalActionId!;
    assert.equal(await run(owner.workspaceId, a1), 'WAITING');
    assert.equal(await prepareStep(deps, { workspaceId: owner.workspaceId, enrollmentId: r1!.id, position: 2 }), 'CAMPAIGN_NOT_ACTIVE');
    await prisma.client.$transaction((tx) => resumeCampaign(tx, owner, c.id));
    await policySweep(prisma.client, new Date(Date.now() + 20 * 60_000));
    assert.equal(await run(owner.workspaceId, a1), 'SUCCEEDED');

    // Emergency stop: the other queued email is blocked at execution — never sent.
    const perms = new Set((await memberPermissions(prisma.client, owner.workspaceId, owner.actor.id!)) ?? []);
    await prisma.client.$transaction((tx) => setOutboundState(tx, owner, perms, 'EMERGENCY_STOP', 'Test'));
    assert.equal(await run(owner.workspaceId, (await messageFor(r2!.id, 1)).externalActionId!), 'BLOCKED');
    assert.equal(fake.sends - sendsBefore, 1);
    assert.equal((await messageFor(r2!.id, 1)).status, 'BLOCKED');
    await prisma.client.$transaction((tx) => setOutboundState(tx, owner, perms, 'ACTIVE', null));
  });

  test('guardrails: a draft that breaks the message rules is rejected and nothing is sent; checks catch a mailbox that can’t read', async () => {
    const { owner, mailbox } = await setup();
    await prospect(owner, 'Hill Plumbing', 'Hal');
    const { campaign: c } = await campaign(owner, mailbox.id);
    const llm = runtime.factory.forIntegration((await prisma.client.integration.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, provider: 'fake_llm' } }))) as FakeLLMProvider;
    llm.respondWith({ subject: 'RE: our call', body: 'Hi Hal, hope this finds you well! Visit https://deal.example for 50% off. Ready? Now?', claims: [], confidence: 'HIGH' });
    const [job] = await jobsDue(owner);
    assert.equal(await prepareStep(deps, job!), 'DRAFT_REJECTED');
    const e = await prisma.client.campaignEnrollment.findFirstOrThrow({ where: { campaignId: c.id } });
    assert.equal(e.status, 'BLOCKED');
    assert.match(e.statusReason ?? '', /AI draft rejected/);
    assert.equal((await messageFor(e.id, 1)).externalActionId, null, 'no external action was ever created');

    // A mailbox that can send but not read can't notice replies → not launchable.
    await prisma.client.integration.update({ where: { id: mailbox.id }, data: { capabilities: ['EMAIL_SEND'] } });
    const draft = await prisma.client.$transaction((tx) => createCampaign(tx, owner, { name: 'Second', offer: 'websites', audience: {}, mailboxIntegrationId: mailbox.id }));
    const check = await prisma.client.$transaction((tx) => checkCampaign(tx, owner, draft.id));
    assert.equal(check.ready, false);
    assert.equal(check.checks.find((x) => x.key === 'replies')?.ok, false);
  });
});
