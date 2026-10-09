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
  launchCampaign,
  prepareStep,
  processConversationMessage,
  sendHumanReply,
  setConversationMode,
  settleCampaignAction,
  settleConversationReply,
  sweepCampaigns,
  syncMailbox,
  wakeSnoozedConversations,
  withCampaignGuard,
  withConversationGuard,
  type OutreachDeps,
} from '@revenue-os/outreach';
import { createPolicyRevalidator, decideApproval, updatePolicy } from '@revenue-os/policy';
import { createEmailSendExecutor, FakeEmailProvider, FakeLLMProvider } from '@revenue-os/providers';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { DEFAULT_POLICY_SETTINGS, normalizeCompanyName, PolicyError } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';

const DAY = 86_400_000;

/**
 * Phase 12 (docs/17 §77-86): a prospect's reply automatically stops cold outreach, is classified, updates structured
 * context, and is answered according to policy — drafted for a person, sent by the AI within its autonomy, or escalated.
 * Takeover blocks AI replies; unsubscribes end it. Real path: mailbox sync → conversation → Inbox Agent → rules →
 * Conversation Agent → validators → Policy Engine (email.reply) → ExternalAction → test mailbox.
 */
describe('Phase 12 — Conversations + AI Inbox', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let storage: string;
  let runtime: ProviderRuntime;
  let deps: OutreachDeps;
  const OPEN = { ...DEFAULT_POLICY_SETTINGS, sendWindow: { ...DEFAULT_POLICY_SETTINGS.sendWindow, enabled: false }, contactCooldownDays: 0, firstTouchApproval: false };

  const setup = async (autonomyLevel: 'L1' | 'L3' = 'L3') => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, { name: 'Inbox Test', slug: uniqueSlug('inbox'), owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Olivia Owner' } });
    const owner: ServiceContext = { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } };
    // Campaign emails go out on their own (L3) so each test starts from a sent first touch.
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
    assert.equal(await run(owner.workspaceId, m1.externalActionId!), 'SUCCEEDED');
    // The follow-up is drafted and queued, so we can watch a reply cancel it.
    const later = new Date(Date.now() + 4 * DAY);
    await prepareStep({ ...deps, now: () => later }, { workspaceId: owner.workspaceId, enrollmentId: e.id, position: 2 });
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

  const executors = () => {
    const ex = createEmailSendExecutor(runtime.gateway);
    return { 'email.send': ex, 'email.reply': ex };
  };
  const run = async (workspaceId: string, actionId: string) => {
    const outcome = await executeExternalAction(prisma.client, { workspaceId, externalActionId: actionId }, { executors: executors(), revalidate: withConversationGuard(withCampaignGuard(createPolicyRevalidator())) });
    await settleCampaignAction(prisma.client, actionId);
    await settleConversationReply(prisma.client, actionId);
    return outcome;
  };
  const mailboxOf = (integrationId: string) => runtime.factory.forIntegration({ id: integrationId, workspaceId: '', provider: 'fake_email' }) as FakeEmailProvider;
  const llmOf = async (workspaceId: string) => runtime.factory.forIntegration(await prisma.client.integration.findFirstOrThrow({ where: { workspaceId, provider: 'fake_llm' } })) as FakeLLMProvider;

  /** The prospect writes; mailbox sync applies it; the worker's job processes the new message. */
  const prospectWrites = async (s: Awaited<ReturnType<typeof setup>>, text: string, opts: { subject?: string; from?: string } = {}) => {
    await mailboxOf(s.mailbox.id).receive({ from: opts.from ?? s.p.email, to: [s.mailbox.accountRef], subject: opts.subject ?? 'Re: Idea for Golden Gate Plumbing', text: `${text}\n\nOn Mon, Sam wrote:\n> Hi Ann`, threadId: s.enrollment.threadRef! });
    await syncMailbox(prisma.client, runtime.gateway, s.mailbox);
    const msg = await prisma.client.conversationMessage.findFirst({ where: { workspaceId: s.owner.workspaceId, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' } });
    if (!msg) return { conversation: null, outcome: null };
    const outcome = await processConversationMessage(deps, { workspaceId: s.owner.workspaceId, conversationId: msg.conversationId, messageId: msg.id });
    return { conversation: await prisma.client.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } }), outcome, messageId: msg.id };
  };
  const repliesOf = (conversationId: string) => prisma.client.conversationReply.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    storage = await mkdtemp(join(tmpdir(), 'rhl-phase12-'));
    runtime = createProviderRuntime(prisma.client, { appEnv: 'test', storagePath: storage });
    deps = { db: prisma.client, providers: runtime.gateway, publicUrl: 'http://localhost:3000' };
  });
  after(async () => {
    await close();
    await rm(storage, { recursive: true, force: true });
  });

  test('DoD: a reply stops cold outreach, is classified, updates context, and the AI drafts for a person (ASSIST) who sends it', async () => {
    const s = await setup('L1');
    const fake = mailboxOf(s.mailbox.id);
    const r = await prospectWrites(s, "Thanks Sam. We're looking for a better way to take bookings before the spring rush. How does it work?");
    const conv = r.conversation!;
    // Immediate protection: the queued follow-up was cancelled in the same transaction the reply arrived in.
    assert.equal((await prisma.client.campaignEnrollment.findUniqueOrThrow({ where: { id: s.enrollment.id } })).status, 'REPLIED');
    assert.equal((await prisma.client.campaignMessage.findFirstOrThrow({ where: { enrollmentId: s.enrollment.id, position: 2 } })).status, 'CANCELLED');

    // One conversation, with the cold email that started it.
    assert.equal(conv.mode, 'ASSIST', 'L1 workspace: the AI drafts, a person sends');
    const thread = await prisma.client.conversationMessage.findMany({ where: { conversationId: conv.id }, orderBy: { occurredAt: 'asc' } });
    assert.deepEqual(thread.map((m) => `${m.direction}:${m.author}`), ['OUTBOUND:AI', 'INBOUND:PROSPECT']);
    assert.equal(thread[1]!.text.includes('On Mon'), false, 'quoted history is cut off');

    // Classified with provenance; context updated.
    const cls = await prisma.client.messageClassification.findUniqueOrThrow({ where: { messageId: r.messageId! } });
    assert.equal(cls.primaryIntent, 'QUESTION');
    assert.equal(cls.method, 'AI');
    assert.deepEqual(cls.questions, ['How does it work?']);
    const context = conv.context as Record<string, { value: string; quote: string }>;
    assert.ok(context.NEED?.quote.includes('better way to take bookings'));
    assert.equal(conv.stage, 'ENGAGED');
    assert.equal(conv.waitingOn, 'US');
    assert.equal(conv.category, 'HIGH_INTENT');

    // Draft answered from the offer, not sent.
    assert.equal(r.outcome, 'DRAFTED');
    const [draft] = await repliesOf(conv.id);
    assert.equal(draft!.status, 'DRAFT');
    assert.equal(draft!.author, 'AI');
    assert.ok(draft!.body.startsWith('Hi Ann,'));
    assert.match(draft!.body, /online booking/);
    assert.equal(draft!.unanswered.length, 0);
    assert.equal(await prisma.client.externalAction.count({ where: { workspaceId: s.owner.workspaceId, actionType: 'email.reply' } }), 0);

    // Retrying the job changes nothing.
    assert.equal(await processConversationMessage(deps, { workspaceId: s.owner.workspaceId, conversationId: conv.id, messageId: r.messageId! }), 'ALREADY_PROCESSED');

    // A person edits and sends: the policy lets a salesperson reply (no cool-down, no first-touch rule for replies).
    const sendsBefore = fake.sends;
    const sent = await sendHumanReply(prisma.client, s.owner, conv.id, { body: `${draft!.body}\n\nHappy to show you an example.`, fromReplyId: draft!.id, signature: 'Olivia' });
    assert.equal(sent.status, 'QUEUED');
    assert.equal(await run(s.owner.workspaceId, sent.externalActionId!), 'SUCCEEDED');
    assert.equal(fake.sends - sendsBefore, 1);
    const action = await prisma.client.externalAction.findUniqueOrThrow({ where: { id: sent.externalActionId! } });
    assert.equal((action.payload as { threadRef?: string }).threadRef, s.enrollment.threadRef, 'same thread');
    assert.match((action.payload as { text: string }).text, /\n\nOlivia$/);
    const after = await prisma.client.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    assert.equal(after.waitingOn, 'PROSPECT');
    assert.equal(after.category, 'AI_HANDLING');
    assert.equal((await prisma.client.conversationReply.findUniqueOrThrow({ where: { id: draft!.id } })).statusReason, 'Sent by a person after editing');
    assert.equal(await prisma.client.conversationMessage.count({ where: { conversationId: conv.id, direction: 'OUTBOUND', author: 'HUMAN' } }), 1);

    // Same thread, second message → same conversation (no duplicate).
    await prospectWrites(s, 'Great, thanks!');
    assert.equal(await prisma.client.conversation.count({ where: { workspaceId: s.owner.workspaceId } }), 1);
    const types = (await prisma.client.domainEvent.findMany({ where: { aggregateId: conv.id }, select: { eventType: true } })).map((e) => e.eventType);
    for (const t of ['ConversationStarted', 'ConversationMessageReceived', 'ConversationMessageClassified', 'ConversationReplyDrafted', 'ConversationReplySent']) assert.ok(types.includes(t), t);
  });

  test('DoD: in AUTO mode the AI replies within policy — sent at L3, approval at L1, never for pricing (escalated)', async () => {
    const s = await setup('L3');
    const r = await prospectWrites(s, 'Sounds interesting. How does it work?');
    const conv = r.conversation!;
    assert.equal(conv.mode, 'AUTO', 'L3 workspace: conversations start in AUTO');
    assert.equal(r.outcome, 'REPLY_REQUESTED');
    const [reply] = await repliesOf(conv.id);
    assert.equal(reply!.status, 'QUEUED', 'L3: a routine answer goes without asking');
    const action = await prisma.client.externalAction.findUniqueOrThrow({ where: { id: reply!.externalActionId! } });
    assert.equal(action.actionType, 'email.reply');
    assert.equal(action.requestedByAgent, 'CONVERSATION');
    assert.equal(await run(s.owner.workspaceId, action.id), 'SUCCEEDED');
    assert.equal((await prisma.client.conversationReply.findUniqueOrThrow({ where: { id: reply!.id } })).status, 'SENT');

    // Pricing: the AI drafts, but a person must answer — no auto-send even in AUTO.
    const p = await prospectWrites(s, 'OK. How much does it cost for a small business like ours?');
    assert.equal(p.outcome, 'DRAFTED');
    const c2 = p.conversation!;
    assert.equal(c2.needsHuman, true);
    assert.equal(c2.category, 'NEEDS_HUMAN');
    assert.match(c2.escalationReason ?? '', /pric|answer/i);
    const latest = (await repliesOf(conv.id)).at(-1)!;
    assert.equal(latest.status, 'DRAFT');
    assert.ok(latest.unanswered.length >= 1, 'the cost question is left for a person, not invented');
    assert.doesNotMatch(latest.body, /\$\s?\d/);

    // At L1 the same AI reply asks a person first.
    await prisma.client.$transaction((tx) => updatePolicy(tx, s.owner, { autonomyLevel: 'L1' }));
    const q = await prospectWrites(s, 'Also, could you tell me more about how the booking part works?');
    assert.equal(q.outcome, 'REPLY_REQUESTED');
    const asked = (await repliesOf(conv.id)).at(-1)!;
    assert.equal(asked.status, 'PENDING_APPROVAL');
    const approval = await prisma.client.approvalRequest.findFirstOrThrow({ where: { externalActionId: asked.externalActionId!, status: 'PENDING' } });
    assert.ok(approval.reasonCodes.includes('AUTONOMY_TOO_LOW'));
    assert.equal(await decideApproval(prisma.client, s.owner, approval.id, 'APPROVE'), 'QUEUED');
    assert.equal(await run(s.owner.workspaceId, asked.externalActionId!), 'SUCCEEDED');
  });

  test('DoD: Take Over immediately blocks AI replies — pending ones are cancelled and the worker re-checks the mode', async () => {
    const s = await setup('L1');
    await prisma.client.conversation.updateMany({ where: { workspaceId: s.owner.workspaceId }, data: { mode: 'AUTO' } });
    const r = await prospectWrites(s, 'Sounds interesting. How does it work?');
    const conv = r.conversation!;
    await setConversationMode(prisma.client, s.owner, conv.id, 'AUTO');
    const again = await prospectWrites(s, 'And could you tell me more about it?');
    const pending = (await repliesOf(conv.id)).at(-1)!;
    assert.equal(again.outcome, 'REPLY_REQUESTED');
    assert.equal(pending.status, 'PENDING_APPROVAL');

    const result = await setConversationMode(prisma.client, s.owner, conv.id, 'HUMAN');
    assert.equal(result.cancelledReplies, 1);
    assert.equal((await prisma.client.conversationReply.findUniqueOrThrow({ where: { id: pending.id } })).status, 'CANCELLED');
    assert.equal((await prisma.client.externalAction.findUniqueOrThrow({ where: { id: pending.externalActionId! } })).status, 'CANCELLED');
    assert.equal((await prisma.client.approvalRequest.findFirstOrThrow({ where: { externalActionId: pending.externalActionId! } })).status, 'CANCELLED');
    const taken = await prisma.client.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    assert.equal(taken.mode, 'HUMAN');
    assert.equal(taken.takenOverById, s.owner.actor.id);
    assert.equal(taken.category, 'NEEDS_HUMAN');

    // Race: an AI reply already queued when the takeover lands is cancelled at execution, never sent.
    await setConversationMode(prisma.client, s.owner, conv.id, 'AUTO');
    await prisma.client.$transaction((tx) => updatePolicy(tx, s.owner, { autonomyLevel: 'L3' }));
    const third = await prospectWrites(s, 'Thanks — how does it work exactly?');
    assert.equal(third.outcome, 'REPLY_REQUESTED');
    const queued = (await repliesOf(conv.id)).at(-1)!;
    assert.equal(queued.status, 'QUEUED');
    await prisma.client.conversation.update({ where: { id: conv.id }, data: { mode: 'HUMAN' } }); // takeover lands between queue and execution
    const sendsBefore = mailboxOf(s.mailbox.id).sends;
    assert.equal(await run(s.owner.workspaceId, queued.externalActionId!), 'CANCELLED');
    assert.equal(mailboxOf(s.mailbox.id).sends, sendsBefore);
    assert.match((await prisma.client.externalAction.findUniqueOrThrow({ where: { id: queued.externalActionId! } })).statusReason ?? '', /took over/);

    // In HUMAN mode a new message gets no AI draft — the person writes.
    const human = await prospectWrites(s, 'Hello? How does it work?');
    assert.equal(human.outcome, 'CLASSIFIED');
  });

  test('DoD: unsubscribe in a conversation suppresses at once; a newer message makes an AI draft obsolete; out-of-office pauses the sequence', async () => {
    const s = await setup('L1');
    const r = await prospectWrites(s, 'How does it work?');
    const conv = r.conversation!;
    const [draft] = await repliesOf(conv.id);
    assert.equal(draft!.status, 'DRAFT');
    const newer = await prospectWrites(s, 'Actually, can you tell me more about it?');
    assert.equal((await prisma.client.conversationReply.findUniqueOrThrow({ where: { id: draft!.id } })).status, 'SUPERSEDED');
    assert.equal(newer.outcome, 'DRAFTED');

    const u = await prospectWrites(s, 'Please remove me from your list.');
    const closed = u.conversation!;
    assert.equal(closed.stage, 'SUPPRESSED');
    assert.equal(closed.category, 'CLOSED');
    assert.equal(await prisma.client.suppression.count({ where: { workspaceId: s.owner.workspaceId, scope: 'EMAIL', value: s.p.email, status: 'ACTIVE' } }), 1);
    assert.equal((await repliesOf(conv.id)).filter((x) => x.status === 'DRAFT').length, 0, 'no draft answers an unsubscribe');
    await assert.rejects(() => sendHumanReply(prisma.client, s.owner, conv.id, { body: 'Are you sure?' }), PolicyError);

    // Out of office before any reply: no conversation, and the follow-up waits until they are back.
    const s2 = await setup('L1');
    await prisma.client.campaignMessage.updateMany({ where: { enrollmentId: s2.enrollment.id, position: 2 }, data: { status: 'CANCELLED' } });
    await prisma.client.campaignMessage.deleteMany({ where: { enrollmentId: s2.enrollment.id, position: 2 } });
    await prisma.client.campaignEnrollment.update({ where: { id: s2.enrollment.id }, data: { nextStepPosition: 2, nextStepDueAt: new Date(Date.now() + DAY) } });
    const back = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
    const ooo = await prospectWrites(s2, `I am out of the office until ${back} with limited access to email.`, { subject: 'Automatic reply: Idea for Golden Gate Plumbing' });
    assert.equal(ooo.conversation, null, 'an away message does not open a conversation');
    const paused = await prisma.client.campaignEnrollment.findUniqueOrThrow({ where: { id: s2.enrollment.id } });
    assert.equal(paused.status, 'ACTIVE');
    assert.ok(paused.nextStepDueAt!.toISOString().slice(0, 10) > back, 'the follow-up waits until after they are back');
  });

  test('grounding: an ungrounded AI reply (a price, a promise) is rejected and the conversation goes to a person; snooze wakes it later', async () => {
    const s = await setup('L3');
    const llm = await llmOf(s.owner.workspaceId);
    llm.respondWith(
      { primaryIntent: 'POSITIVE', secondaryIntents: [], sentiment: 'POSITIVE', confidence: 'HIGH', questions: [], objections: [], riskFlags: [], extracted: [], returnDate: null, summary: 'Interested', needsHuman: false, reason: '' },
      { subject: 'Re: hello', body: 'Hi Ann, great! It is only $99 per month and we guarantee results by Friday.', answered: [], unanswered: [], claims: [], proposesMeeting: false, confidence: 'HIGH', needsHuman: false, reason: '' },
    );
    const r = await prospectWrites(s, 'Sounds good to me.');
    assert.equal(r.outcome, 'DRAFTED');
    const [rejected] = await repliesOf(r.conversation!.id);
    assert.equal(rejected!.status, 'REJECTED');
    assert.match(rejected!.statusReason ?? '', /failed its checks/);
    assert.equal(rejected!.externalActionId, null, 'nothing was ever requested');
    const conv = await prisma.client.conversation.findUniqueOrThrow({ where: { id: r.conversation!.id } });
    assert.equal(conv.needsHuman, true);
    assert.equal(conv.category, 'NEEDS_HUMAN');

    // Not now → nurture, snoozed; when the date passes it comes back to a person.
    const n = await prospectWrites(s, 'Not right now, maybe reach out in 2 months.');
    assert.equal(n.conversation!.stage, 'NURTURE');
    assert.equal(n.conversation!.category, 'NURTURE');
    const until = n.conversation!.snoozedUntil!;
    assert.ok(until.getTime() > Date.now() + 50 * DAY);
    const { woken } = await wakeSnoozedConversations(prisma.client, new Date(until.getTime() + 60_000));
    assert.ok(woken >= 1);
    const awake = await prisma.client.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    assert.equal(awake.category, 'NEEDS_HUMAN');
    assert.equal(awake.stage, 'ENGAGED');
  });

  test('a known contact who was never in a campaign still lands in the inbox; an unknown sender does not', async () => {
    const s = await setup('L1');
    const other = await prospect(s.owner, 'Bay Plumbing', 'Bob');
    const fake = mailboxOf(s.mailbox.id);
    await fake.receive({ from: other.email, to: [s.mailbox.accountRef], subject: 'Website question', text: 'Hi, a friend mentioned you. Can you tell me more about what you do?' });
    await fake.receive({ from: 'stranger@nowhere.example', to: [s.mailbox.accountRef], subject: 'Hello', text: 'Who is this?' });
    await syncMailbox(prisma.client, runtime.gateway, s.mailbox);
    const convs = await prisma.client.conversation.findMany({ where: { workspaceId: s.owner.workspaceId } });
    assert.equal(convs.length, 1);
    assert.equal(convs[0]!.companyId, other.company.id);
    assert.equal(convs[0]!.campaignId, null);
    assert.equal(await prisma.client.mailboxMessage.count({ where: { workspaceId: s.owner.workspaceId, kind: 'UNMATCHED' } }), 1);
  });
});
