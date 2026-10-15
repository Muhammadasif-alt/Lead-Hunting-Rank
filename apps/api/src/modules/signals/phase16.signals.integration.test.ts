import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { approveKnowledge, createKnowledge } from '@revenue-os/knowledge';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { BusinessRuleError, normalizeCompanyName } from '@revenue-os/shared';
import {
  actOnSignal,
  analyzeSignal,
  companySignals,
  createSignalRule,
  detectSignals,
  dismissSignal,
  listSignalRules,
  listSignals,
  listWatchlists,
  recordSignal,
  searchSignals,
  signalAnalytics,
  signalDetail,
  signalOverview,
  signalSweep,
  WINDOW_MISSED_REASON,
  type SignalDeps,
} from '@revenue-os/signals';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const BASE = 'Evergreen Lawn Care offers Lawn Mowing Services and Hedge Trimming for homes across Austin. Family owned since 2009. Call for a free estimate today and ask about seasonal plans.';

/**
 * Phase 16 (docs/17 §106-110): a change becomes ONE signal with evidence (more sources merge into it), cosmetic change
 * is counted but never a signal, relevance and "why now" come from what we actually sell, the relationship decides the
 * action (open deal → attach, no cold campaign), follow-up dates open time-boxed signals, rules prioritise or ignore,
 * old signals expire — and nothing in any signal path sends anything or creates an external action.
 */
describe('Phase 16 — Signals + Intent', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let storage: string;
  let runtime: ProviderRuntime;
  let deps: SignalDeps;
  const workspaces: string[] = [];

  const workspace = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, { name: 'Signals Test', slug: uniqueSlug('signals'), owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Olivia Owner' } });
    const owner: ServiceContext = { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } };
    // The Test AI model (deterministic) runs the Signal Agent.
    await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'fake_llm', category: 'AI', name: 'Test model', capabilities: ['LLM_REASONING', 'LLM_EXTRACTION', 'EMBEDDINGS'], status: 'ACTIVE', connectedAt: new Date() } });
    workspaces.push(owner.workspaceId);
    return owner;
  };

  const company = async (owner: ServiceContext, name = 'Evergreen Lawn Care') => {
    const domain = `${uniqueSlug('evergreen')}.example`;
    const c = await prisma.client.company.create({ data: { workspaceId: owner.workspaceId, displayName: name, normalizedName: normalizeCompanyName(name), websiteDomain: domain, industry: 'Landscaping', city: 'Austin', region: 'TX', country: 'US' } });
    const website = await prisma.client.website.create({ data: { workspaceId: owner.workspaceId, companyId: c.id, domain, url: `https://${domain}/`, status: 'LIVE' } });
    return { ...c, domain, websiteId: website.id };
  };
  type Co = Awaited<ReturnType<typeof company>>;

  /** A finished research run as the researcher stores it: HOME snapshot + its evidence + the deterministic audit. */
  const researched = async (owner: ServiceContext, co: Co, at: Date, page: { text?: string; copyright?: number; booking?: boolean; loads?: boolean } = {}) => {
    const ws = owner.workspaceId;
    const run = await prisma.client.researchRun.create({ data: { workspaceId: ws, companyId: co.id, trigger: 'MANUAL', status: 'COMPLETED', startedAt: at, completedAt: new Date(at.getTime() + 60_000), createdAt: at } });
    if (page.loads === false) {
      await prisma.client.evidence.create({ data: { workspaceId: ws, entityType: 'COMPANY', entityId: co.id, evidenceType: 'WEBSITE_CHECK', sourceType: 'WEBSITE', sourceName: co.domain, sourceUrl: `https://${co.domain}/`, observedAt: at, createdAt: new Date(at.getTime() + 1000), contentExcerpt: `Could not load https://${co.domain}/: unreachable`, confidence: 'LOW' } });
      return run;
    }
    const text = page.text ?? BASE;
    const ev = await prisma.client.evidence.create({ data: { workspaceId: ws, entityType: 'COMPANY', entityId: co.id, evidenceType: 'WEBSITE_PAGE', sourceType: 'WEBSITE', sourceName: co.domain, sourceUrl: `https://${co.domain}/`, observedAt: at, contentExcerpt: text.slice(0, 600), confidence: 'HIGH' } });
    await prisma.client.websiteSnapshot.create({ data: { workspaceId: ws, websiteId: co.websiteId, researchRunId: run.id, evidenceId: ev.id, pageType: 'HOME', url: `https://${co.domain}/`, finalUrl: `https://${co.domain}/`, httpStatus: 200, contentHash: createHash('sha256').update(`${text}|${page.copyright ?? 2025}`).digest('hex'), byteSize: text.length, title: 'Evergreen Lawn Care — Austin lawn care', metadata: { description: 'Lawn care in Austin' }, textExcerpt: text, auditVersion: 1, fetchedAt: at } });
    await prisma.client.websiteAudit.create({ data: { workspaceId: ws, websiteId: co.websiteId, companyId: co.id, researchRunId: run.id, auditVersion: 1, status: 'COMPLETE', performedAt: at, hasSsl: true, mobileReady: true, hasContactForm: true, hasBooking: page.booking ?? false, hasChat: false, hasClearCta: true, copyrightYear: page.copyright ?? 2025, technologySummary: [], findings: [{ key: 'cta', observed: true, detail: 'Buttons/links ask visitors to: get a free estimate.' }], overallConfidence: 'HIGH' } });
    return run;
  };
  const detectResearch = (owner: ServiceContext, co: Co, runId: string) => detectSignals(deps, { workspaceId: owner.workspaceId, companyId: co.id, source: 'RESEARCH', refId: runId });
  const signalsOf = (co: Co, type?: string) => prisma.client.signal.findMany({ where: { companyId: co.id, ...(type ? { type } : {}) }, orderBy: { detectedAt: 'asc' } });
  const approveService = async (owner: ServiceContext) => {
    const k = await createKnowledge(prisma.client, owner, { type: 'SERVICE', content: { name: 'Local SEO and lead generation', description: 'We help local service businesses rank in local search and turn visits into new customers with lead capture.', capabilities: ['Local SEO', 'Lead capture forms', 'Google Business Profile'] } });
    await approveKnowledge(prisma.client, owner, k.item.id, { canApproveCommercial: false });
  };

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    storage = await mkdtemp(join(tmpdir(), 'rhl-phase16-'));
    runtime = createProviderRuntime(prisma.client, { appEnv: 'test', storagePath: storage });
    deps = { db: prisma.client, providers: runtime.gateway };
  });
  after(async () => {
    // (i) No signal path ever creates an external action — in any workspace this suite touched.
    assert.equal(await prisma.client.externalAction.count({ where: { workspaceId: { in: workspaces } } }), 0);
    await close();
    await rm(storage, { recursive: true, force: true });
  });

  test('DoD (a)(d): a website rerun with a new service → ONE signal with evidence; repeats and a second source merge; why-now only with an approved service', async () => {
    const owner = await workspace();
    const a = await company(owner);
    const r1 = await researched(owner, a, new Date(Date.now() - 10 * DAY));
    // First research: a baseline, never a signal.
    const first = await detectResearch(owner, a, r1.id);
    assert.equal(first.created, 0);
    assert.equal((await prisma.client.signalObservation.findFirstOrThrow({ where: { companyId: a.id } })).detail, 'Baseline — first research of this company');

    const r2 = await researched(owner, a, new Date(Date.now() - HOUR), { text: `${BASE} New: Commercial Irrigation Installation for offices and HOAs.` });
    const second = await detectResearch(owner, a, r2.id);
    assert.equal(second.created, 1);
    let [sig] = await signalsOf(a, 'NEW_SERVICE');
    assert.ok(sig);
    assert.equal(sig.subject, 'Commercial Irrigation Installation');
    assert.equal(sig.evidenceCount, 2, 'latest + previous snapshot');
    assert.equal(sig.sourceCount, 1);
    assert.match(sig.fact, /official website/);
    assert.deepEqual((sig.change as { label: string }).label, 'New service');
    // (d) Nothing approved to sell → no "why now", not actionable.
    assert.equal(sig.whyNow, null);
    assert.notEqual(sig.status, 'ACTIONABLE');
    assert.equal(sig.strength, 'WEAK');

    // The same job again (retry) is a no-op.
    const again = await detectResearch(owner, a, r2.id);
    assert.equal(again.created + again.merged, 0);
    assert.equal((await signalsOf(a, 'NEW_SERVICE')).length, 1);

    // A second, independent source about the same event merges: one signal, more evidence, more sources.
    const listing = await prisma.client.evidence.create({ data: { workspaceId: owner.workspaceId, entityType: 'COMPANY', entityId: a.id, evidenceType: 'LISTING', sourceType: 'LEAD_SOURCE', sourceName: 'fake_places', observedAt: new Date(), contentExcerpt: 'Evergreen Lawn Care — Commercial Irrigation Installation', confidence: 'MEDIUM' } });
    const merged = await prisma.client.$transaction((tx) => recordSignal(tx, { workspaceId: owner.workspaceId, actor: { type: 'SYSTEM', id: null } }, { companyId: a.id, type: 'NEW_SERVICE', subject: 'commercial irrigation installation', title: 'New service', fact: 'Listed with a new service', sourceKind: 'DISCOVERY', evidence: [{ evidenceId: listing.id, source: 'fake_places', observedAt: new Date() }], now: new Date() }));
    assert.equal(merged.outcome, 'MERGED');
    [sig] = await signalsOf(a, 'NEW_SERVICE');
    assert.equal((await signalsOf(a, 'NEW_SERVICE')).length, 1);
    assert.equal(sig!.evidenceCount, 3);
    assert.equal(sig!.sourceCount, 2);
    assert.ok(await prisma.client.outboxEvent.findFirst({ where: { workspaceId: owner.workspaceId, eventType: 'SignalEvidenceAdded', aggregateId: sig!.id } }));

    // The Signal Agent may not invent a reason to contact: whyNow stays null.
    const analysis = await analyzeSignal(deps, { workspaceId: owner.workspaceId, signalId: sig!.id });
    assert.equal(analysis.outcome, 'AI');
    sig = (await signalsOf(a, 'NEW_SERVICE'))[0]!;
    assert.equal(sig.whyNow, null);
    assert.match(sig.interpretation ?? '', /\bmay\b/);
    assert.equal(sig.hypothesisId, null, 'no approved service fits → no opportunity hypothesis');

    // (d) With an approved service that fits, the same kind of change has an evidence-backed why-now.
    await approveService(owner);
    const b = await company(owner, 'Bluebonnet Landscaping');
    const b1 = await researched(owner, b, new Date(Date.now() - 12 * DAY));
    await detectResearch(owner, b, b1.id);
    const b2 = await researched(owner, b, new Date(Date.now() - HOUR), { text: `${BASE} New: Commercial Snow Removal for businesses.` });
    await detectResearch(owner, b, b2.id);
    let [sb] = await signalsOf(b, 'NEW_SERVICE');
    assert.ok(sb?.whyNow, 'why-now present');
    assert.match(sb!.whyNow!, /Local SEO and lead generation/);
    assert.equal(sb!.status, 'ACTIONABLE');
    assert.equal(sb!.relationship, 'COLD');
    assert.equal(sb!.recommendedAction, 'RESEARCH');
    const ai = await analyzeSignal(deps, { workspaceId: owner.workspaceId, signalId: sb!.id });
    assert.equal(ai.outcome, 'AI');
    sb = (await signalsOf(b, 'NEW_SERVICE'))[0]!;
    assert.equal(sb.interpretationSource, 'AI');
    assert.ok(sb.whyNow);
    const hyp = await prisma.client.opportunityHypothesis.findUniqueOrThrow({ where: { id: sb.hypothesisId! } });
    assert.equal(hyp.key, 'SIGNAL_NEW_SERVICE');
    assert.equal(hyp.status, 'CANDIDATE', 'a hypothesis, never a fact');
    assert.ok((await prisma.client.hypothesisEvidence.count({ where: { hypothesisId: hyp.id } })) >= 1);

    // Read models answer in the shared shapes.
    const overview = await signalOverview(prisma.client, owner.workspaceId);
    assert.ok(overview.funnel.observations >= 4);
    assert.ok(overview.priority.some((r) => r.id === sb!.id));
    assert.equal(overview.sources.find((s) => s.kind === 'HIRING')!.connected, false);
    const detail = await signalDetail(prisma.client, owner.workspaceId, sb.id);
    assert.equal(detail.evidence.length, 2);
    assert.equal(detail.evidence[0]!.trust, 'OFFICIAL_WEBSITE');
    assert.ok(detail.hypothesis);
    assert.ok(detail.history.some((h) => h.action === 'signal.detected'));
    assert.equal((await listSignals(prisma.client, owner.workspaceId, { type: 'NEW_SERVICE', status: 'ALL' })).length, 2);
    assert.equal((await listSignals(prisma.client, owner.workspaceId, { q: 'bluebonnet' })).length, 1);
    const found = await searchSignals(prisma.client, owner.workspaceId, 'new services this week');
    assert.equal(found.filters.type, 'NEW_SERVICE');
    assert.ok(found.items.some((r) => r.id === sb!.id));
    assert.equal((await companySignals(prisma.client, owner.workspaceId, b.id)).open.length, 1);
    assert.equal((await listWatchlists(prisma.client, owner.workspaceId)).length, 3, 'default watchlists');
    assert.equal((await listSignalRules(prisma.client, owner.workspaceId)).length, 3, 'default rules');
  });

  test('DoD (b): a copyright-year-only change creates no signal — only a counted observation', async () => {
    const owner = await workspace();
    const c = await company(owner);
    const r1 = await researched(owner, c, new Date(Date.now() - 9 * DAY), { copyright: 2025 });
    await detectResearch(owner, c, r1.id);
    const r2 = await researched(owner, c, new Date(Date.now() - HOUR), { copyright: 2026 });
    const result = await detectResearch(owner, c, r2.id);
    assert.equal(result.created, 0);
    assert.equal((await signalsOf(c)).length, 0);
    const obs = await prisma.client.signalObservation.findFirstOrThrow({ where: { companyId: c.id, changeLevel: 'LOW' } });
    assert.match(obs.detail ?? '', /copyright/i);
    const overview = await signalOverview(prisma.client, owner.workspaceId);
    assert.equal(overview.funnel.signals, 0);
    assert.equal(overview.funnel.observations, 2);
    assert.equal(overview.funnel.meaningful, 0);
  });

  test('DoD (c): an open deal → attach to the deal; a cold campaign is refused (existing relationship protection)', async () => {
    const owner = await workspace();
    await approveService(owner);
    const d = await company(owner, 'Deal Co Lawns');
    const pipeline = await prisma.client.pipeline.findFirstOrThrow({ where: { workspaceId: owner.workspaceId } });
    const stage = await prisma.client.pipelineStage.findFirstOrThrow({ where: { pipelineId: pipeline.id, semantic: 'DISCOVERY' } });
    const opp = await prisma.client.opportunity.create({ data: { workspaceId: owner.workspaceId, companyId: d.id, name: 'Deal Co — local SEO', pipelineId: pipeline.id, stageId: stage.id, createdByType: 'HUMAN', createdById: owner.actor.id } });
    const r1 = await researched(owner, d, new Date(Date.now() - 8 * DAY));
    await detectResearch(owner, d, r1.id);
    const r2 = await researched(owner, d, new Date(Date.now() - HOUR), { text: `${BASE} New: Commercial Irrigation Installation.` });
    await detectResearch(owner, d, r2.id);
    const [sig] = await signalsOf(d, 'NEW_SERVICE');
    assert.equal(sig!.relationship, 'OPEN_DEAL');
    assert.equal(sig!.recommendedAction, 'ATTACH_TO_DEAL');
    assert.equal(sig!.opportunityId, opp.id);
    await assert.rejects(actOnSignal(prisma.client, owner, sig!.id, { action: 'CAMPAIGN_CANDIDATE' }), (e: unknown) => e instanceof BusinessRuleError && /protection/i.test((e as Error).message));
    const acted = await actOnSignal(prisma.client, owner, sig!.id, { action: 'ATTACH_TO_DEAL', note: 'Mention it in the proposal' });
    assert.equal(acted.status, 'ACTED_ON');
    assert.equal(acted.actedAction, 'ATTACH_TO_DEAL');
    assert.equal(acted.campaignCandidate, false);
    assert.ok(await prisma.client.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'opportunity.signal_attached', entityId: opp.id } }));
  });

  test('DoD (e): a due "contact me later" promise → CONTACT_LATER_DUE with a 7-day window, at the top of the queue', async () => {
    const owner = await workspace();
    const e = await company(owner, 'Later Lawns');
    const dueAt = new Date(Date.now() - 2 * HOUR);
    const c = await prisma.client.commitment.create({ data: { workspaceId: owner.workspaceId, companyId: e.id, direction: 'PROSPECT_PROMISED', title: 'Contact them again after the busy season', quote: 'Please contact us again in October once the busy season is over.', dueAt, status: 'DUE', origin: 'EXTRACTED', sourceType: 'MESSAGE', sourceId: randomUUID(), createdByType: 'SYSTEM', createdAt: new Date(Date.now() - 60 * DAY) } });
    const r = await detectSignals(deps, { workspaceId: owner.workspaceId, companyId: e.id, source: 'COMMITMENT', refId: c.id });
    assert.equal(r.created, 1);
    const [sig] = await signalsOf(e, 'CONTACT_LATER_DUE');
    assert.equal(sig!.commitmentId, c.id);
    assert.equal(sig!.effectiveAt.getTime(), dueAt.getTime());
    assert.equal(sig!.windowEndsAt!.getTime(), dueAt.getTime() + 7 * DAY);
    assert.ok(sig!.whyNow?.startsWith('They asked us to come back now'));
    assert.equal(sig!.recommendedAction, 'RE_ENGAGE');
    // Default rule: follow-ups go to the top and the owner is told.
    assert.equal(sig!.priority, true);
    assert.ok(sig!.autoActions.includes('NOTIFY_OWNER'));
    // Retried job: nothing new.
    const again = await detectSignals(deps, { workspaceId: owner.workspaceId, companyId: e.id, source: 'COMMITMENT', refId: c.id });
    assert.equal(again.created + again.merged, 0);
    const row = (await signalOverview(prisma.client, owner.workspaceId)).priority[0]!;
    assert.equal(row.id, sig!.id);
    assert.equal(row.windowState, 'ACTIVE');
    // An ordinary promise is not a follow-up request.
    const task = await prisma.client.commitment.create({ data: { workspaceId: owner.workspaceId, companyId: e.id, direction: 'PROSPECT_PROMISED', title: 'Send the signed form', dueAt, status: 'DUE', origin: 'EXTRACTED', sourceType: 'HUMAN', createdByType: 'SYSTEM' } });
    assert.equal((await detectSignals(deps, { workspaceId: owner.workspaceId, companyId: e.id, source: 'COMMITMENT', refId: task.id })).created, 0);
  });

  test('DoD (f): rule IGNORE dismisses (kept, not shown); rule PRIORITY prioritises', async () => {
    const owner = await workspace();
    const ignore = await createSignalRule(prisma.client, owner, { name: 'Ignore outages', conditions: { types: ['WEBSITE_DOWN'] }, actions: ['IGNORE'] });
    await createSignalRule(prisma.client, owner, { name: 'Booking changes first', conditions: { types: ['TECH_CHANGE'] }, actions: ['PRIORITY'] });

    const f = await company(owner, 'Flaky Lawns');
    const f1 = await researched(owner, f, new Date(Date.now() - 7 * DAY));
    await detectResearch(owner, f, f1.id);
    const f2 = await researched(owner, f, new Date(Date.now() - HOUR), { loads: false });
    await detectResearch(owner, f, f2.id);
    const [down] = await signalsOf(f, 'WEBSITE_DOWN');
    assert.equal(down!.status, 'DISMISSED');
    assert.equal(down!.statusReason, 'Ignored by rule "Ignore outages"');
    assert.equal(down!.feedback, null);
    assert.equal(down!.whyNow, null, 'a negative signal is never a reason to contact');
    assert.equal((await prisma.client.signalRule.findUniqueOrThrow({ where: { id: ignore.id } })).matches, 1);
    assert.ok(!(await listSignals(prisma.client, owner.workspaceId, {})).some((r) => r.id === down!.id), 'ignored signals are not in the open queue');

    const g = await company(owner, 'Booking Lawns');
    const g1 = await researched(owner, g, new Date(Date.now() - 7 * DAY), { booking: false });
    await detectResearch(owner, g, g1.id);
    const g2 = await researched(owner, g, new Date(Date.now() - HOUR), { booking: true });
    await detectResearch(owner, g, g2.id);
    const [tech] = await signalsOf(g, 'TECH_CHANGE');
    assert.equal(tech!.subject, 'booking');
    assert.equal(tech!.priority, true);
    assert.ok(tech!.autoActions.includes('PRIORITY'));
  });

  test('DoD (g)(h): the sweep expires old signals and flags missed windows; dismissal keeps the feedback', async () => {
    const owner = await workspace();
    const sctx: ServiceContext = { workspaceId: owner.workspaceId, actor: { type: 'SYSTEM', id: null } };
    const h = await company(owner, 'Old News Lawns');
    const ev = await prisma.client.evidence.create({ data: { workspaceId: owner.workspaceId, entityType: 'COMPANY', entityId: h.id, evidenceType: 'CONVERSATION_MESSAGE', sourceType: 'CONVERSATION', sourceName: 'Conversation', observedAt: new Date(Date.now() - 40 * DAY), contentExcerpt: 'Can we have a call next week?' } });
    const old = await prisma.client.$transaction((tx) => recordSignal(tx, sctx, { companyId: h.id, type: 'MEETING_ASKED', subject: 'conversation:x', title: 'Asked for a meeting', fact: 'They asked for a call', sourceKind: 'CONVERSATION', evidence: [{ evidenceId: ev.id, source: 'conversation', observedAt: new Date(Date.now() - 40 * DAY) }], now: new Date(Date.now() - 40 * DAY) }));
    const dueAt = new Date(Date.now() - 10 * DAY);
    const c = await prisma.client.commitment.create({ data: { workspaceId: owner.workspaceId, companyId: h.id, direction: 'PROSPECT_PROMISED', title: 'Follow up after their trade show', dueAt, status: 'DUE', origin: 'HUMAN', sourceType: 'HUMAN', createdByType: 'HUMAN', createdAt: new Date(Date.now() - 50 * DAY) } });
    await detectSignals(deps, { workspaceId: owner.workspaceId, companyId: h.id, source: 'COMMITMENT', refId: c.id });
    const [later] = await signalsOf(h, 'CONTACT_LATER_DUE');

    const swept = await signalSweep(deps, { workspaceId: owner.workspaceId });
    assert.equal(swept.expired, 1);
    const expired = await prisma.client.signal.findUniqueOrThrow({ where: { id: old.signal.id } });
    assert.equal(expired.status, 'EXPIRED');
    assert.ok(await prisma.client.outboxEvent.findFirst({ where: { eventType: 'SignalExpired', aggregateId: old.signal.id } }));
    const missed = await prisma.client.signal.findUniqueOrThrow({ where: { id: later!.id } });
    assert.equal(missed.statusReason, WINDOW_MISSED_REASON);
    assert.ok(['ACTIONABLE', 'MONITOR', 'DETECTED'].includes(missed.status), 'status kept');
    assert.equal((await signalSweep(deps, { workspaceId: owner.workspaceId })).windowsMissed, 0, 'flagged once');
    assert.ok((await prisma.client.signalWatchlist.findFirstOrThrow({ where: { workspaceId: owner.workspaceId } })).lastSweepAt);

    // (h) Dismiss with a reason: kept for learning, counted in analytics.
    const dismissed = await dismissSignal(prisma.client, owner, later!.id, { feedback: 'NOT_RELEVANT', note: 'They hired someone in-house' });
    assert.equal(dismissed.status, 'DISMISSED');
    assert.equal(dismissed.feedback, 'NOT_RELEVANT');
    assert.equal(dismissed.feedbackNote, 'They hired someone in-house');
    assert.equal(dismissed.dismissedById, owner.actor.id);
    const analytics = await signalAnalytics(prisma.client, owner.workspaceId, 90);
    assert.equal(analytics.feedback.find((f) => f.feedback === 'NOT_RELEVANT')!.count, 1);
    await assert.rejects(actOnSignal(prisma.client, owner, later!.id, { action: 'RESEARCH' }), BusinessRuleError);
  });
});
