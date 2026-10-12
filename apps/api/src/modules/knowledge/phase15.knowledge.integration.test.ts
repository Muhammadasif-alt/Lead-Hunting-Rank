import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { executeExternalAction } from '@revenue-os/events';
import {
  addMemoryNote,
  approveKnowledge,
  archiveKnowledge,
  buildBrainContext,
  correctMemory,
  createCommitment,
  createKnowledge,
  embedRevision,
  invalidateMemory,
  knowledgeSweep,
  memorySweep,
  processDocument,
  resolveAnsweredGaps,
  resolveKnowledgeConflict,
  restoreVersion,
  reviewMemoryCandidate,
  saveDraft,
  setKnowledgeControls,
  setKnowledgeDisabled,
  simulateAnswer,
  uploadDocument,
  type BrainDeps,
} from '@revenue-os/knowledge';
import {
  checkCampaign,
  createCampaign,
  createOpportunityTx,
  launchCampaign,
  prepareStep,
  processConversationMessage,
  sendHumanReply,
  settleCampaignAction,
  settleConversationReply,
  submitReply,
  sweepCampaigns,
  syncMailbox,
  withCampaignGuard,
  withConversationGuard,
  type OutreachDeps,
} from '@revenue-os/outreach';
import { createPolicyRevalidator, updatePolicy } from '@revenue-os/policy';
import { createEmailSendExecutor, FakeEmailProvider } from '@revenue-os/providers';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { DEFAULT_POLICY_SETTINGS, ForbiddenError, normalizeCompanyName } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';

const DAY = 86_400_000;

/**
 * Phase 15 (docs/17 §99-105): the AI answers business-specific questions only from approved truth and safely
 * identifies missing or conflicting knowledge; memory comes from conversations through candidates, stays scoped to its
 * record, keeps history, and promises are tracked so the AI never forgets them.
 */
describe('Phase 15 — Memory + Knowledge', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let storage: string;
  let runtime: ProviderRuntime;
  let deps: OutreachDeps;
  let brain: BrainDeps;
  const OPEN = { ...DEFAULT_POLICY_SETTINGS, sendWindow: { ...DEFAULT_POLICY_SETTINGS.sendWindow, enabled: false }, contactCooldownDays: 0, firstTouchApproval: false };

  const workspace = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, { name: 'Brain Test', slug: uniqueSlug('brain'), owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Olivia Owner' } });
    const owner: ServiceContext = { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } };
    // The Test AI model drafts and embeds (deterministic vectors).
    await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'fake_llm', category: 'AI', name: 'Test model', capabilities: ['LLM_REASONING', 'LLM_EXTRACTION', 'EMBEDDINGS'], status: 'ACTIVE', connectedAt: new Date() } });
    return { owner, ownerUserId: ws.ownerUserId };
  };

  /** A prospect in Austin who got the first campaign email — so their replies land in a conversation. */
  const setup = async () => {
    const { owner, ownerUserId } = await workspace();
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L3', settings: OPEN }));
    const mailbox = await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'fake_email', category: 'EMAIL', name: 'Test mailbox', accountRef: `sam@${uniqueSlug('ours')}.example`, capabilities: ['EMAIL_SEND', 'EMAIL_READ'], status: 'ACTIVE', connectedAt: new Date() } });
    const domain = `${uniqueSlug('evergreen')}.example`;
    const company = await prisma.client.company.create({ data: { workspaceId: owner.workspaceId, displayName: 'Evergreen Lawn Care', normalizedName: normalizeCompanyName('Evergreen Lawn Care'), websiteDomain: domain, industry: 'Landscaping', city: 'Austin', region: 'TX', country: 'US' } });
    const person = await prisma.client.person.create({ data: { workspaceId: owner.workspaceId, fullName: 'Grace Lee', firstName: 'Grace' } });
    await prisma.client.employment.create({ data: { workspaceId: owner.workspaceId, personId: person.id, companyId: company.id, title: 'Manager', isCurrent: true } });
    const email = `grace@${domain}`;
    const cp = await prisma.client.contactPoint.create({ data: { workspaceId: owner.workspaceId, entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: email, normalizedValue: email, status: 'VERIFIED' } });
    await prisma.client.contactVerification.create({ data: { workspaceId: owner.workspaceId, contactPointId: cp.id, provider: 'fake_verification', status: 'VALID', verifiedAt: new Date() } });
    const c = await prisma.client.$transaction((tx) => createCampaign(tx, owner, { name: 'Austin landscapers', offer: 'online booking for local businesses', audience: { industries: ['landscap'] }, mailboxIntegrationId: mailbox.id, senderName: 'Sam', cohortSize: 5 }));
    assert.equal((await prisma.client.$transaction((tx) => checkCampaign(tx, owner, c.id))).ready, true);
    await prisma.client.$transaction((tx) => launchCampaign(tx, owner, c.id));
    const jobs: { workspaceId: string; enrollmentId: string; position: number }[] = [];
    await sweepCampaigns(prisma.client, async (j) => void jobs.push(j));
    for (const j of jobs.filter((x) => x.workspaceId === owner.workspaceId)) await prepareStep(deps, j);
    const e = await prisma.client.campaignEnrollment.findFirstOrThrow({ where: { campaignId: c.id } });
    const m1 = await prisma.client.campaignMessage.findFirstOrThrow({ where: { enrollmentId: e.id, position: 1 } });
    await run(owner.workspaceId, m1.externalActionId!);
    // ASSIST: the AI drafts, a person sends.
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L1' }));
    return { owner, ownerUserId, mailbox, company, person, email, enrollment: await prisma.client.campaignEnrollment.findUniqueOrThrow({ where: { id: e.id } }) };
  };
  type Setup = Awaited<ReturnType<typeof setup>>;

  const run = async (workspaceId: string, actionId: string) => {
    const ex = createEmailSendExecutor(runtime.gateway);
    const outcome = await executeExternalAction(prisma.client, { workspaceId, externalActionId: actionId }, { executors: { 'email.send': ex, 'email.reply': ex }, revalidate: withConversationGuard(withCampaignGuard(createPolicyRevalidator())) });
    await settleCampaignAction(prisma.client, actionId);
    await settleConversationReply(prisma.client, actionId);
    return outcome;
  };
  const mailboxOf = (id: string) => runtime.factory.forIntegration({ id, workspaceId: '', provider: 'fake_email' }) as FakeEmailProvider;
  const writes = async (s: Setup, text: string) => {
    await mailboxOf(s.mailbox.id).receive({ from: s.email, to: [s.mailbox.accountRef], subject: 'Re: Idea for Evergreen Lawn Care', text, threadId: s.enrollment.threadRef! });
    await syncMailbox(prisma.client, runtime.gateway, s.mailbox);
    const msg = await prisma.client.conversationMessage.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' } });
    const outcome = await processConversationMessage(deps, { workspaceId: s.owner.workspaceId, conversationId: msg.conversationId, messageId: msg.id });
    return { conv: await prisma.client.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } }), outcome, messageId: msg.id };
  };
  const latestAiReply = (conversationId: string) => prisma.client.conversationReply.findFirstOrThrow({ where: { conversationId, author: 'AI' }, orderBy: { createdAt: 'desc' } });

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    storage = await mkdtemp(join(tmpdir(), 'rhl-phase15-'));
    runtime = createProviderRuntime(prisma.client, { appEnv: 'test', storagePath: storage });
    deps = { db: prisma.client, providers: runtime.gateway, publicUrl: 'http://localhost:3000' };
    brain = { db: prisma.client, providers: runtime.gateway };
  });
  after(async () => {
    await close();
    await rm(storage, { recursive: true, force: true });
  });

  test('DoD: a draft is not truth → gap; our promise is tracked; a person answers → FAQ draft; approved → the AI answers from it next time', async () => {
    const s = await setup();
    const faq = await createKnowledge(prisma.client, s.owner, { type: 'FAQ', content: { question: 'How long does setup take?', answer: 'Most setups are live within two weeks once we have access to your website.', category: 'IMPLEMENTATION' } });
    assert.equal(faq.item.status, 'DRAFT');

    // 1) Only a draft exists → the AI does not answer from it; the question becomes a knowledge gap.
    const first = await writes(s, 'Sounds interesting. How soon could we get this running?');
    let reply = await latestAiReply(first.conv.id);
    assert.equal(reply.status, 'DRAFT');
    assert.deepEqual(reply.unanswered, ['How soon could we get this running?']);
    assert.deepEqual(reply.knowledge, []);
    const gap = await prisma.client.knowledgeGap.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId } });
    assert.equal(gap.status, 'OPEN');
    assert.deepEqual(gap.conversationIds, [first.conv.id]);

    // 2) The AI's draft is sent as is: its "a colleague will come back" is now a promise with a due date.
    const sent = await submitReply(prisma.client, s.owner, first.conv.id, reply.id, { agent: false });
    await run(s.owner.workspaceId, sent.externalActionId!);
    const promise = await prisma.client.commitment.findFirstOrThrow({ where: { conversationId: first.conv.id, origin: 'AI_REPLY' } });
    assert.equal(promise.direction, 'WE_PROMISED');
    assert.equal(promise.status, 'OPEN');
    assert.ok(promise.dueAt && promise.dueAt > new Date());
    // The AI's context now carries the open promise (it cannot forget it).
    const ctx1 = await buildBrainContext(brain, { workspaceId: s.owner.workspaceId, companyId: s.company.id, personId: first.conv.personId, conversationId: first.conv.id, opportunityId: first.conv.opportunityId, questions: [] });
    assert.ok(ctx1.commitments.some((c) => c.id === promise.id));

    // 3) A person answers → the promise is kept (evidence: the reply) and the answer becomes a draft FAQ for review.
    const human = await sendHumanReply(prisma.client, s.owner, first.conv.id, { body: 'Usually about two weeks once we have access to your website.' });
    await run(s.owner.workspaceId, human.externalActionId!);
    const kept = await prisma.client.commitment.findUniqueOrThrow({ where: { id: promise.id } });
    assert.equal(kept.status, 'COMPLETED');
    assert.match(kept.completionEvidence ?? '', /Reply sent/);
    const drafted = await prisma.client.knowledgeGap.findUniqueOrThrow({ where: { id: gap.id } });
    assert.equal(drafted.status, 'DRAFTED');
    const fromHuman = await prisma.client.knowledgeRevision.findFirstOrThrow({ where: { itemId: drafted.draftItemId! } });
    assert.equal(fromHuman.origin, 'HUMAN_ANSWER');
    assert.equal(fromHuman.status, 'DRAFT', 'never live until approved');

    // 4) A person approves the FAQ → chunks get vectors → the gap is resolved by it.
    await assert.rejects(approveKnowledge(prisma.client, { workspaceId: s.owner.workspaceId, actor: { type: 'AI_AGENT', id: null } }, faq.item.id, { canApproveCommercial: true }), ForbiddenError);
    const approved = await approveKnowledge(prisma.client, s.owner, faq.item.id, { canApproveCommercial: false });
    assert.equal(approved.item.status, 'APPROVED');
    const emb = await embedRevision(brain, { workspaceId: s.owner.workspaceId, revisionId: approved.revision.id });
    assert.equal(emb.embedded, 1);
    const [{ n }] = await prisma.client.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "KnowledgeChunk" WHERE "revisionId" = ${approved.revision.id}::uuid AND "embedding" IS NOT NULL`;
    assert.equal(n, 1);
    assert.equal(await resolveAnsweredGaps(brain, s.owner.workspaceId), 1);
    assert.equal((await prisma.client.knowledgeGap.findUniqueOrThrow({ where: { id: gap.id } })).status, 'RESOLVED');

    // 5) Asked again (in other words) → answered from the approved FAQ, cited by revision, usage logged.
    const second = await writes(s, 'Thanks Sam. How soon could we get this running?');
    reply = await latestAiReply(second.conv.id);
    assert.equal(reply.status, 'DRAFT', reply.statusReason ?? '');
    assert.deepEqual(reply.unanswered, []);
    const answered = reply.answered as { source: string; knowledgeRevisionId?: string }[];
    assert.equal(answered[0]!.source, 'KNOWLEDGE');
    assert.equal(answered[0]!.knowledgeRevisionId, approved.revision.id);
    assert.match(reply.body, /two weeks/);
    assert.equal((reply.knowledge as { code: string }[])[0]!.code, faq.item.code);
    assert.equal(await prisma.client.knowledgeUsage.count({ where: { usedById: reply.id, revisionId: approved.revision.id } }), 1);
    assert.ok((reply.validation as { ok: boolean }[]).every((v) => v.ok));
    assert.equal(second.conv.needsHuman, false);
  });

  test('Pricing authority: commercial approval, quotes only from the record, custom range → person, schedule, rollback, disable, kill rule, conflicts', async () => {
    const s = await setup();
    const content = { name: 'Website Starter', currency: 'USD', priceType: 'FIXED', price: 1500, aiMayQuote: true, quantityUnit: 'locations', includedQuantity: 5, maxQuantity: 5 };
    const price = await createKnowledge(prisma.client, s.owner, { type: 'PRICING', content, submit: true });
    await assert.rejects(approveKnowledge(prisma.client, s.owner, price.item.id, { canApproveCommercial: false }), ForbiddenError, 'pricing needs commercial authority');
    const v1 = await approveKnowledge(prisma.client, s.owner, price.item.id, { canApproveCommercial: true });

    const asked = await writes(s, 'How much is the Website Starter?');
    let reply = await latestAiReply(asked.conv.id);
    assert.match(reply.body, /\$1,500/);
    assert.equal((reply.answered as { source: string }[])[0]!.source, 'KNOWLEDGE');
    assert.ok((reply.validation as { validator: string; ok: boolean }[]).find((v) => v.validator === 'pricing_authority')!.ok);
    // The rules escalate pricing on arrival; approved, quotable pricing that fully answered it clears that.
    assert.equal(asked.conv.needsHuman, false);
    assert.equal((reply.knowledge as { revisionId: string }[])[0]!.revisionId, v1.revision.id);

    // Above the approved range: DO NOT CALCULATE — a person quotes.
    const custom = await writes(s, 'And what would the Website Starter cost for 9 locations?');
    reply = await latestAiReply(custom.conv.id);
    assert.equal(reply.unanswered.length, 1);
    assert.doesNotMatch(reply.body, /\$/);
    assert.equal(custom.conv.needsHuman, true);

    // A price change scheduled for tomorrow: v1 keeps answering until then; the sweep publishes v2 on time.
    const tomorrow = new Date(Date.now() + DAY);
    await saveDraft(prisma.client, s.owner, price.item.id, { content: { ...content, price: 1800 }, effectiveFrom: tomorrow });
    const scheduled = await approveKnowledge(prisma.client, s.owner, price.item.id, { canApproveCommercial: true });
    assert.equal(scheduled.scheduled, true);
    assert.match((await simulateAnswer(brain, s.owner.workspaceId, 'How much is the Website Starter?')).proposed ?? '', /\$1,500/);
    const later = { ...brain, now: () => new Date(tomorrow.getTime() + 60_000) };
    assert.match((await simulateAnswer(later, s.owner.workspaceId, 'How much is the Website Starter?')).proposed ?? '', /\$1,800/, 'effective at its date even before the sweep');
    assert.ok((await knowledgeSweep(later)).published >= 1);
    const item = await prisma.client.knowledgeItem.findUniqueOrThrow({ where: { id: price.item.id } });
    assert.equal(item.currentRevisionId, scheduled.revision.id);
    assert.equal((await prisma.client.knowledgeRevision.findUniqueOrThrow({ where: { id: v1.revision.id } })).status, 'SUPERSEDED');
    // History stays linked: the first reply used v1.
    assert.equal(await prisma.client.knowledgeUsage.count({ where: { workspaceId: s.owner.workspaceId, revisionId: v1.revision.id } }), 1);

    // Rollback: a new version made from v1 — history untouched.
    const restored = await restoreVersion(prisma.client, s.owner, price.item.id, 1, { canApproveCommercial: true });
    assert.equal(restored.revision.version, 3);
    assert.match((await simulateAnswer(brain, s.owner.workspaceId, 'How much is the Website Starter?')).proposed ?? '', /\$1,500/);

    // Emergency disable and the global kill rule both send pricing to a person — without stopping the AI.
    await setKnowledgeDisabled(prisma.client, s.owner, price.item.id, true, 'Price under review');
    assert.equal((await simulateAnswer(brain, s.owner.workspaceId, 'How much is the Website Starter?')).outcome, 'ESCALATE');
    await setKnowledgeDisabled(prisma.client, s.owner, price.item.id, false);
    await setKnowledgeControls(prisma.client, s.owner, { pricingAnswers: false });
    const off = await simulateAnswer(brain, s.owner.workspaceId, 'How much is the Website Starter?');
    assert.match(off.escalate[0]!.reason, /turned off/);
    await setKnowledgeControls(prisma.client, s.owner, { pricingAnswers: true });

    // Two approved answers that disagree: the AI answers from neither until a person decides.
    const a = await createKnowledge(prisma.client, s.owner, { type: 'FAQ', content: { question: 'Do you offer refunds?', answer: 'Yes, within 14 days if work has not started.' } });
    await approveKnowledge(prisma.client, s.owner, a.item.id, { canApproveCommercial: false });
    const b = await createKnowledge(prisma.client, s.owner, { type: 'FAQ', content: { question: 'Do you offer refunds?', answer: 'No, all sales are final.' } });
    const second = await approveKnowledge(prisma.client, s.owner, b.item.id, { canApproveCommercial: false });
    assert.equal(second.conflicts, 1);
    const blocked = await simulateAnswer(brain, s.owner.workspaceId, 'Do you offer refunds?');
    assert.equal(blocked.outcome, 'ESCALATE');
    assert.equal(blocked.conflicts.length, 1);
    await archiveKnowledge(prisma.client, s.owner, b.item.id, 'Wrong — refunds are offered');
    const conflict = await prisma.client.knowledgeConflict.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId, status: 'OPEN' } });
    await resolveKnowledgeConflict(prisma.client, s.owner, conflict.id, { resolution: 'RESOLVED', note: 'Archived the wrong one' });
    assert.match((await simulateAnswer(brain, s.owner.workspaceId, 'Do you offer refunds?')).proposed ?? '', /14 days/);
  });

  test('Documents are sources, not truth: parsed into candidates; a contradicting price is a review item while the approved price keeps answering', async () => {
    const { owner } = await workspace();
    await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'local_storage', category: 'STORAGE', name: 'Local file storage', capabilities: ['STORAGE'], status: 'ACTIVE', connectedAt: new Date() } });
    const price = await createKnowledge(prisma.client, owner, { type: 'PRICING', content: { name: 'Website Starter', currency: 'USD', priceType: 'FIXED', price: 1500, aiMayQuote: true } });
    await approveKnowledge(prisma.client, owner, price.item.id, { canApproveCommercial: true });

    const md = '# Sales FAQ\n\nQ: Do you offer refunds?\nA: Yes, within 14 days if work has not started.\n\n# Pricing\n\nWebsite Starter: $2,000\nSEO Retainer: starting at $900/month\n';
    const up = await uploadDocument(brain, owner, { fileName: 'Pricing-2024.md', contentType: 'text/markdown', data: Buffer.from(md) });
    assert.equal(up.duplicate, false);
    assert.equal((await uploadDocument(brain, owner, { fileName: 'copy.md', contentType: 'text/markdown', data: Buffer.from(md) })).duplicate, true, 'the same file twice is one source');
    const done = (await processDocument(brain, { sourceId: up.source.id })) as { status: string; conflicts?: number };
    assert.equal(done.status, 'EXTRACTED');
    assert.equal(done.conflicts, 1);
    const drafts = await prisma.client.knowledgeRevision.findMany({ where: { workspaceId: owner.workspaceId, origin: 'DOCUMENT' }, include: { item: true } });
    assert.deepEqual(drafts.map((d) => d.item.type).sort(), ['DOCUMENT', 'FAQ', 'PRICING', 'PRICING']);
    assert.ok(drafts.every((d) => d.status === 'DRAFT'), 'nothing from a document is approved automatically');
    const seo = drafts.find((d) => d.title === 'SEO Retainer')!;
    assert.equal((seo.content as { aiMayQuote: boolean }).aiMayQuote, false, 'a person decides whether the AI may quote it');
    const conflict = await prisma.client.knowledgeConflict.findFirstOrThrow({ where: { workspaceId: owner.workspaceId } });
    assert.equal(conflict.sourceId, up.source.id);
    assert.equal(conflict.otherItemId, price.item.id);
    // Current approved structured pricing still wins over an old document.
    const sim = await simulateAnswer(brain, owner.workspaceId, 'How much is the Website Starter?');
    assert.equal(sim.outcome, 'ANSWER');
    assert.match(sim.proposed ?? '', /\$1,500/);
    assert.equal((await processDocument(brain, { sourceId: up.source.id })).status, 'EXTRACTED', 'idempotent');
  });

  test('Memory: candidates on the right record, budget waits for a person, newer statements supersede, corrections keep history, deals never mix, promises fall due', async () => {
    const s = await setup();
    const { conv } = await writes(s, "I'm the owner. We use Jobber for scheduling. Our budget is around $5k for the website. I'll talk to my partner and get back to you by Friday.");
    const mems = await prisma.client.memory.findMany({ where: { workspaceId: s.owner.workspaceId, companyId: s.company.id } });
    const role = mems.find((m) => m.key === 'ROLE')!;
    assert.equal(role.entityType, 'PERSON');
    assert.equal(role.entityId, s.person.id);
    assert.equal(role.value, 'Owner');
    assert.equal(role.origin, 'DIRECT_STATEMENT');
    const tool = mems.find((m) => m.key === 'CURRENT_SOLUTION')!;
    assert.equal(tool.entityType, 'COMPANY');
    assert.ok(!mems.some((m) => m.key === 'BUDGET'), 'budget is not accepted on its own');
    const budget = await prisma.client.memoryCandidate.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId, key: 'BUDGET' } });
    assert.equal(budget.status, 'NEEDS_REVIEW');
    assert.notEqual(budget.entityType, 'COMPANY', 'a deal budget never becomes a company-wide truth');
    assert.match((await prisma.client.memoryEvidence.findFirstOrThrow({ where: { memoryId: role.id } })).quote ?? '', /I'm the owner/);
    const theirs = await prisma.client.commitment.findFirstOrThrow({ where: { conversationId: conv.id, direction: 'PROSPECT_PROMISED' } });
    assert.match(theirs.title, /Talk to my partner and get back to us by Friday/);
    assert.equal(theirs.dueAt?.getUTCDay(), 5);

    // A newer direct statement supersedes the old one — history kept, not overwritten.
    await writes(s, 'Quick update: we switched and now we use HubSpot for scheduling.');
    const old = await prisma.client.memory.findUniqueOrThrow({ where: { id: tool.id } });
    assert.equal(old.status, 'SUPERSEDED');
    const now = await prisma.client.memory.findUniqueOrThrow({ where: { id: old.supersededById! } });
    assert.match(now.value, /HubSpot/);
    assert.equal(now.status, 'ACTIVE');

    // A person confirms the budget (editing the value), corrects the role, marks something wrong.
    const accepted = await reviewMemoryCandidate(prisma.client, s.owner, budget.id, { action: 'ACCEPT', value: 'About $5,000' });
    assert.equal(accepted.memory?.value, 'About $5,000');
    const corrected = await correctMemory(prisma.client, s.owner, role.id, { value: 'Co-owner', reason: 'Shares ownership with her partner' });
    assert.equal(corrected.origin, 'HUMAN_CORRECTION');
    assert.equal((await prisma.client.memory.findUniqueOrThrow({ where: { id: role.id } })).status, 'SUPERSEDED');
    assert.ok(await prisma.client.auditLog.findFirst({ where: { entityType: 'MEMORY', entityId: corrected.id, action: 'memory.corrected' } }));
    await invalidateMemory(prisma.client, s.owner, now.id, 'Different branch, not this company');
    const ctx = await buildBrainContext(brain, { workspaceId: s.owner.workspaceId, companyId: s.company.id, personId: s.person.id, conversationId: conv.id, opportunityId: null, questions: [] });
    assert.ok(ctx.memories.some((m) => m.key === 'ROLE' && m.value === 'Co-owner'));
    assert.ok(!ctx.memories.some((m) => m.key === 'CURRENT_SOLUTION'), 'an invalidated memory is never used (and the superseded one is history)');

    // Deals never mix: deal A's budget is not in deal B's context (and is said to be left out).
    const [dealA, dealB] = await prisma.client.$transaction(async (tx) => [await createOpportunityTx(tx, s.owner, { companyId: s.company.id, name: 'Website redesign' }), await createOpportunityTx(tx, s.owner, { companyId: s.company.id, name: 'SEO retainer' })]);
    await addMemoryNote(prisma.client, s.owner, { companyId: s.company.id, entityType: 'OPPORTUNITY', entityId: dealA.id, text: '$10,000', key: 'BUDGET' });
    const inA = await buildBrainContext(brain, { workspaceId: s.owner.workspaceId, companyId: s.company.id, personId: null, conversationId: null, opportunityId: dealA.id, questions: [] });
    const inB = await buildBrainContext(brain, { workspaceId: s.owner.workspaceId, companyId: s.company.id, personId: null, conversationId: null, opportunityId: dealB.id, questions: [] });
    assert.ok(inA.memories.some((m) => m.value === '$10,000'));
    assert.ok(!inB.memories.some((m) => m.value === '$10,000'));
    assert.ok(inB.notIncluded.some((x) => /other deals/.test(x.label)));

    // Promises fall due (and stay in the AI's context until kept).
    const due = await createCommitment(prisma.client, s.owner, { companyId: s.company.id, conversationId: conv.id, direction: 'WE_PROMISED', title: 'Send the integration overview', dueAt: new Date(Date.now() - 60_000) });
    await memorySweep(brain);
    assert.equal((await prisma.client.commitment.findUniqueOrThrow({ where: { id: due.id } })).status, 'DUE');
    const withDue = await buildBrainContext(brain, { workspaceId: s.owner.workspaceId, companyId: s.company.id, personId: null, conversationId: conv.id, opportunityId: null, questions: [] });
    assert.ok(withDue.commitments.find((c) => c.id === due.id)?.overdue);
  });
});
