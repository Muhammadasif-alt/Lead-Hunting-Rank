import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { executeExternalAction } from '@revenue-os/events';
import {
  addStakeholder,
  changeStage,
  checkCampaign,
  createCampaign,
  createFromConversation,
  findAudience,
  launchCampaign,
  markLost,
  markWon,
  prepareStep,
  processConversationMessage,
  reopenOpportunity,
  setQualificationAnswer,
  settleCampaignAction,
  sweepCampaigns,
  syncMailbox,
  updateOpportunity,
  withCampaignGuard,
  type OutreachDeps,
} from '@revenue-os/outreach';
import { createPolicyRevalidator, updatePolicy } from '@revenue-os/policy';
import { createEmailSendExecutor, FakeEmailProvider } from '@revenue-os/providers';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { BusinessRuleError, ConflictError, DEFAULT_POLICY_SETTINGS, normalizeCompanyName, ValidationError } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';
import { OpportunitiesQuery } from './opportunities.query.js';

const DAY = 86_400_000;

/**
 * Phase 13 (docs/17 §87-92): a conversation can progress into a qualified opportunity → meeting → proposal →
 * negotiation → won / lost, with complete history. No pipeline spam (commercial evidence only), unknown stays unknown,
 * stage changes go through a command that checks requirements, won and lost are explicit with evidence and a reason.
 */
describe('Phase 13 — Qualification + opportunities', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let storage: string;
  let runtime: ProviderRuntime;
  let deps: OutreachDeps;
  let query: OpportunitiesQuery;
  const OPEN = { ...DEFAULT_POLICY_SETTINGS, sendWindow: { ...DEFAULT_POLICY_SETTINGS.sendWindow, enabled: false }, contactCooldownDays: 0, firstTouchApproval: false };

  /** A workspace with one prospect who got the first campaign email (and a second prospect still in the sequence). */
  const setup = async (autonomyLevel: 'L1' | 'L2' = 'L1') => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, { name: 'Deals Test', slug: uniqueSlug('deals'), owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Olivia Owner' } });
    const owner: ServiceContext = { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } };
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L3', settings: OPEN }));
    const mailbox = await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'fake_email', category: 'EMAIL', name: 'Test mailbox', accountRef: `sam@${uniqueSlug('ours')}.example`, capabilities: ['EMAIL_SEND', 'EMAIL_READ'], status: 'ACTIVE', connectedAt: new Date() } });
    await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'fake_llm', category: 'AI', name: 'Test model', capabilities: ['LLM_REASONING', 'LLM_EXTRACTION'], status: 'ACTIVE', connectedAt: new Date() } });
    const p = await prospect(owner, 'Golden Gate Plumbing', 'Ann');
    const c = await prisma.client.$transaction((tx) => createCampaign(tx, owner, { name: 'Austin plumbers', offer: 'websites with online booking', audience: { industries: ['plumb'] }, mailboxIntegrationId: mailbox.id, senderName: 'Sam', cohortSize: 5 }));
    assert.equal((await prisma.client.$transaction((tx) => checkCampaign(tx, owner, c.id))).ready, true);
    await prisma.client.$transaction((tx) => launchCampaign(tx, owner, c.id));
    const jobs: { workspaceId: string; enrollmentId: string; position: number }[] = [];
    await sweepCampaigns(prisma.client, async (j) => void jobs.push(j));
    for (const j of jobs.filter((x) => x.workspaceId === owner.workspaceId)) await prepareStep(deps, j);
    const e = await prisma.client.campaignEnrollment.findFirstOrThrow({ where: { campaignId: c.id } });
    const m1 = await prisma.client.campaignMessage.findFirstOrThrow({ where: { enrollmentId: e.id, position: 1 } });
    await executeExternalAction(prisma.client, { workspaceId: owner.workspaceId, externalActionId: m1.externalActionId! }, { executors: { 'email.send': createEmailSendExecutor(runtime.gateway) }, revalidate: withCampaignGuard(createPolicyRevalidator()) });
    await settleCampaignAction(prisma.client, m1.externalActionId!);
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel }));
    return { owner, mailbox, p, campaign: c, enrollment: await prisma.client.campaignEnrollment.findUniqueOrThrow({ where: { id: e.id } }) };
  };

  const prospect = async (ctx: ServiceContext, name: string, first: string) => {
    const domain = `${uniqueSlug(first.toLowerCase())}.example`;
    const company = await prisma.client.company.create({ data: { workspaceId: ctx.workspaceId, displayName: name, normalizedName: normalizeCompanyName(name), websiteDomain: domain, industry: 'Plumbing', city: 'Austin' } });
    const person = await prisma.client.person.create({ data: { workspaceId: ctx.workspaceId, fullName: `${first} Smith`, firstName: first } });
    await prisma.client.employment.create({ data: { workspaceId: ctx.workspaceId, personId: person.id, companyId: company.id, title: 'Owner', isCurrent: true } });
    const email = `${first.toLowerCase()}@${domain}`;
    const cp = await prisma.client.contactPoint.create({ data: { workspaceId: ctx.workspaceId, entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: email, normalizedValue: email, status: 'VERIFIED' } });
    await prisma.client.contactVerification.create({ data: { workspaceId: ctx.workspaceId, contactPointId: cp.id, provider: 'fake_verification', status: 'VALID', verifiedAt: new Date() } });
    return { company, person, email };
  };

  const fake = (integrationId: string) => runtime.factory.forIntegration({ id: integrationId, workspaceId: '', provider: 'fake_email' }) as FakeEmailProvider;
  const writes = async (s: Awaited<ReturnType<typeof setup>>, text: string) => {
    await fake(s.mailbox.id).receive({ from: s.p.email, to: [s.mailbox.accountRef], subject: 'Re: Idea for Golden Gate Plumbing', text, threadId: s.enrollment.threadRef! });
    await syncMailbox(prisma.client, runtime.gateway, s.mailbox);
    const msg = await prisma.client.conversationMessage.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' } });
    await processConversationMessage(deps, { workspaceId: s.owner.workspaceId, conversationId: msg.conversationId, messageId: msg.id });
    return prisma.client.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } });
  };
  const deal = (id: string) => prisma.client.opportunity.findUniqueOrThrow({ where: { id }, include: { stage: true } });
  const answers = async (id: string) => Object.fromEntries((await prisma.client.qualificationAnswer.findMany({ where: { qualification: { opportunityId: id }, supersededAt: null } })).map((a) => [a.key, a]));

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    storage = await mkdtemp(join(tmpdir(), 'rhl-phase13-'));
    runtime = createProviderRuntime(prisma.client, { appEnv: 'test', storagePath: storage });
    deps = { db: prisma.client, providers: runtime.gateway, publicUrl: 'http://localhost:3000' };
    query = new OpportunitiesQuery(prisma);
  });
  after(async () => {
    await close();
    await rm(storage, { recursive: true, force: true });
  });

  test('no pipeline spam: interest alone creates nothing; a stated need is only proposed at L1; need + timing creates a deal at L2', async () => {
    const s = await setup('L1');
    let conv = await writes(s, 'Thanks — can you send some examples?');
    assert.equal(conv.opportunityId, null);
    assert.equal(conv.commercialSignal, null, 'interest is not a deal');
    conv = await writes(s, "We're looking for a better way to take bookings, it's been a pain.");
    assert.equal(conv.opportunityId, null, 'L1: nothing is created on its own');
    assert.equal((conv.commercialSignal as { strength: string }).strength, 'MODERATE');
    assert.equal(await prisma.client.domainEvent.count({ where: { aggregateId: conv.id, eventType: 'OpportunityProposed' } }), 1);

    const s2 = await setup('L2');
    const c2 = await writes(s2, "We're looking for a new website with online booking and want it done next month.");
    assert.ok(c2.opportunityId, 'strong commercial evidence at L2 creates the deal');
    const o = await deal(c2.opportunityId!);
    assert.equal(o.stage.semantic, 'NEW');
    assert.equal(o.source, 'CONVERSATION');
    assert.equal(o.createdByType, 'SYSTEM');
    assert.match(o.originReason ?? '', /need and a timeline/);
    assert.match(o.name, /Golden Gate Plumbing — Websites with online booking/);
    const a = await answers(o.id);
    assert.ok(a.NEED?.quote?.includes('new website'), 'the need comes with their words');
    assert.ok(a.TIMELINE?.quote?.includes('next month'));
    assert.equal(a.NEED?.verified, false, 'AI-read answers stay unverified');
    assert.equal(a.BUDGET, undefined, 'unknown stays unknown');
    const holders = await prisma.client.opportunityStakeholder.findMany({ where: { opportunityId: o.id } });
    assert.equal(holders.length, 1);
    assert.equal(holders[0]!.role, 'DECISION_MAKER', 'the owner is the primary decision maker');
    assert.equal((await prisma.client.qualification.findUniqueOrThrow({ where: { opportunityId: o.id } })).status, 'QUALIFIED', 'need + timeline known');
  });

  test('DoD: conversation → qualified opportunity → meeting → proposal → negotiation → won, with history; the customer leaves prospecting', async () => {
    const s = await setup('L1');
    const conv = await writes(s, 'Sounds interesting. How does it work?');
    // A person creates the deal from the inbox.
    const created = await createFromConversation(prisma.client, s.owner, conv.id);
    await assert.rejects(() => createFromConversation(prisma.client, s.owner, conv.id), ConflictError, 'one open deal per conversation');
    const id = created.id;

    // Guards: no need yet → can't be qualified; WON only through its own command.
    await assert.rejects(() => changeStage(prisma.client, s.owner, id, 'QUALIFIED', null), (e: unknown) => e instanceof BusinessRuleError && /Need is unknown/.test(e.message));
    await assert.rejects(() => changeStage(prisma.client, s.owner, id, 'WON', null), BusinessRuleError);

    // The prospect states need and timeline; a mentioned partner becomes a suggested stakeholder.
    await writes(s, "We need online booking before the spring rush, ideally next month. I need to check with my partner before we commit.");
    const a = await answers(id);
    assert.ok(a.NEED && a.TIMELINE && a.DECISION_PROCESS);
    const suggested = await prisma.client.opportunityStakeholder.findFirst({ where: { opportunityId: id, status: 'SUGGESTED' } });
    assert.match(suggested?.name ?? '', /Partner/);

    await changeStage(prisma.client, s.owner, id, 'QUALIFIED', null);
    await changeStage(prisma.client, s.owner, id, 'MEETING', 'Discovery call on Thursday');
    await assert.rejects(() => changeStage(prisma.client, s.owner, id, 'NEGOTIATION', null), (e: unknown) => e instanceof BusinessRuleError && /proposal comes before/.test(e.message));
    await updateOpportunity(prisma.client, s.owner, id, { service: 'Website with online booking', amountMinor: 450_000 });
    await changeStage(prisma.client, s.owner, id, 'PROPOSAL', 'Proposal v1 sent');
    // Going back needs a reason.
    await assert.rejects(() => changeStage(prisma.client, s.owner, id, 'MEETING', null), ValidationError);
    await changeStage(prisma.client, s.owner, id, 'NEGOTIATION', 'They asked about payment terms');

    // The second deal view: health and next action come from evidence.
    const view = await query.detail(s.owner.workspaceId, id);
    assert.equal(view.opportunity.stage, 'NEGOTIATION');
    assert.ok(view.health.risks.some((r) => /Budget unknown/.test(r.text)));
    assert.ok(view.nextAction.action.length > 0 && view.nextAction.why.length > 0);
    assert.equal(view.qualification.fields.find((f) => f.key === 'BUDGET')?.current, null);

    // Won: explicit, with value and confirmation. Company → customer; cold sequences to it stop; no future prospecting.
    await assert.rejects(() => markWon(prisma.client, s.owner, id, { amountMinor: 0, note: 'x' }), ValidationError);
    await assert.rejects(() => markWon(prisma.client, s.owner, id, { amountMinor: 450_000, note: ' ' }), ValidationError);
    const other = await prisma.client.campaignEnrollment.create({ data: { workspaceId: s.owner.workspaceId, campaignId: s.campaign.id, companyId: s.p.company.id, email: 'office@goldengate.example', status: 'ACTIVE', unsubscribeToken: uniqueSlug('tok').padEnd(24, 'x'), nextStepDueAt: new Date(Date.now() + DAY) } }).catch(() => null);
    const won = await markWon(prisma.client, s.owner, id, { amountMinor: 480_000, note: 'Signed proposal by email' });
    assert.equal(won.ok, true);
    const final = await deal(id);
    assert.equal(final.status, 'WON');
    assert.equal(final.stage.semantic, 'WON');
    assert.equal(final.wonAmountMinor, 480_000);
    assert.equal((await prisma.client.company.findUniqueOrThrow({ where: { id: s.p.company.id } })).status, 'CUSTOMER');
    if (other) assert.equal((await prisma.client.campaignEnrollment.findUniqueOrThrow({ where: { id: other.id } })).status, 'REMOVED');
    const audience = await findAudience(prisma.client, s.owner.workspaceId, { industries: ['plumb'] });
    assert.equal(audience.matched, 0, 'a customer is never cold-prospected');
    await assert.rejects(() => changeStage(prisma.client, s.owner, id, 'PROPOSAL', null), BusinessRuleError, 'won is terminal');

    // Complete history: the real path, each step with who and why.
    const history = await prisma.client.opportunityStageHistory.findMany({ where: { opportunityId: id }, orderBy: { changedAt: 'asc' } });
    assert.deepEqual(history.map((h) => h.toSemantic), ['NEW', 'QUALIFIED', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'WON']);
    assert.ok(history.every((h) => h.actorType === 'HUMAN'));
    assert.equal(history.at(-1)!.reason, 'Signed proposal by email');
    const types = (await prisma.client.domainEvent.findMany({ where: { aggregateId: id }, select: { eventType: true } })).map((e) => e.eventType);
    for (const t of ['OpportunityCreated', 'OpportunityStageChanged', 'QualificationUpdated', 'OpportunityStakeholderAdded', 'OpportunityWon']) assert.ok(types.includes(t), t);
    assert.ok(await prisma.client.auditLog.count({ where: { workspaceId: s.owner.workspaceId, action: 'opportunity.won' } }));
  });

  test('DoD: lost needs a reason (suggested from the conversation); a revisit date snoozes the relationship; reopening is explicit', async () => {
    const s = await setup('L1');
    await writes(s, "We're looking for online booking for the shop.");
    const conv = await writes(s, 'Actually not right now, maybe reach out in 3 months.');
    const { id } = await createFromConversation(prisma.client, s.owner, conv.id);
    const view = await query.detail(s.owner.workspaceId, id);
    assert.equal(view.lossSuggestion?.code, 'TIMING', 'the rules suggest the reason from what they said');
    assert.match(view.lossSuggestion?.quote ?? '', /not right now/);

    const revisit = new Date(Date.now() + 90 * DAY);
    await markLost(prisma.client, s.owner, id, { reason: 'TIMING', revisitAt: revisit, suggested: true, evidenceQuote: view.lossSuggestion!.quote });
    const lost = await deal(id);
    assert.equal(lost.status, 'LOST');
    const loss = await prisma.client.opportunityLoss.findFirstOrThrow({ where: { opportunityId: id } });
    assert.equal(loss.reasonCode, 'TIMING');
    assert.equal(loss.suggested, true);
    const snoozed = await prisma.client.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    assert.equal(snoozed.category, 'NURTURE');
    assert.equal(snoozed.snoozedUntil?.toISOString(), revisit.toISOString());

    await assert.rejects(() => reopenOpportunity(prisma.client, s.owner, id, '  '), ValidationError);
    await reopenOpportunity(prisma.client, s.owner, id, 'They wrote back early');
    const reopened = await deal(id);
    assert.equal(reopened.status, 'OPEN');
    assert.equal(reopened.stage.semantic, 'NEW', 'back to the stage it was in');
    assert.ok((await prisma.client.opportunityLoss.findFirstOrThrow({ where: { opportunityId: id } })).reopenedAt);
  });

  test('a person’s answer wins over later AI readings; stakeholders can be added; the board shows facts, not guesses', async () => {
    const s = await setup('L1');
    const conv = await writes(s, "We're looking for a booking system.");
    const { id } = await createFromConversation(prisma.client, s.owner, conv.id);
    await setQualificationAnswer(prisma.client, s.owner, id, 'TIMELINE', 'Before June');
    await writes(s, 'We would like it next month if possible.');
    const a = await answers(id);
    assert.equal(a.TIMELINE?.value, 'Before June', 'a verified answer is not overwritten by the AI');
    assert.equal(a.TIMELINE?.verified, true);
    await setQualificationAnswer(prisma.client, s.owner, id, 'BUDGET', null);
    assert.equal((await answers(id)).BUDGET, undefined);
    await addStakeholder(prisma.client, s.owner, id, { name: 'Mike', title: 'Operations', role: 'USER' });

    const board = await query.board(s.owner.workspaceId, s.owner.actor.id!, { view: 'pipeline' });
    assert.deepEqual(board.stages.map((x) => x.semantic), ['NEW', 'DISCOVERY', 'QUALIFIED', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'NURTURE']);
    const card = board.cards.find((c) => c.id === id)!;
    assert.equal(card.amountMinor, null, 'value unknown stays unknown');
    assert.ok(card.known.includes('NEED') && card.known.includes('TIMELINE'));
    assert.equal(board.summary.openCount, 1);
    assert.equal(board.summary.unpricedCount, 1);
  });
});
