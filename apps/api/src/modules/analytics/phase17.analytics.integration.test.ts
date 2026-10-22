import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import {
  ask,
  attributeOpportunity,
  attributionReport,
  costs,
  deleteView,
  drill,
  freshness,
  lineage,
  listViews,
  markets,
  overview,
  recordRevenue,
  rollupDailyMetrics,
  saveView,
} from '@revenue-os/analytics';
import { createOpportunityTx, markWon, meetingTypes } from '@revenue-os/outreach';
import { BusinessRuleError, normalizeCompanyName } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';

const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);

/**
 * Phase 17 (docs/17 §111-113): lifecycle attribution Source → Company → Signal → Campaign → Message → Conversation →
 * Meeting → Opportunity → Revenue from the operational records; revenue events WON / PAYMENT / EXPANSION / REFUND; an
 * idempotent daily projection; and no fake metrics — empty stays empty, unknown cost stays unknown.
 */
describe('Phase 17 — Analytics + Attribution', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  const workspaces: string[] = [];

  const workspace = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, { name: 'Analytics Test', slug: uniqueSlug('analytics'), owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Olivia Owner' } });
    const owner: ServiceContext = { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } };
    workspaces.push(owner.workspaceId);
    return owner;
  };

  /** The whole chain, recorded as each phase records it; the deal is created and won through the sales service. */
  const chain = async (owner: ServiceContext) => {
    const ws = owner.workspaceId;
    const db = prisma.client;
    const company = await db.company.create({ data: { workspaceId: ws, displayName: 'Evergreen Lawn Care', normalizedName: normalizeCompanyName('Evergreen Lawn Care'), websiteDomain: `${uniqueSlug('evergreen')}.example`, industry: 'Landscaping', city: 'Austin', region: 'TX', country: 'US', createdAt: ago(20) } });
    const market = await db.market.create({ data: { workspaceId: ws, marketKey: uniqueSlug('us-tx-austin-landscaping'), name: 'Austin landscapers', country: 'US', region: 'TX', city: 'Austin', industry: 'landscaping' } });
    const mission = await db.discoveryMission.create({ data: { workspaceId: ws, marketId: market.id, mode: 'QUICK', status: 'COMPLETED', maxRounds: 1, maxQueries: 4, maxProviderCalls: 8, startedAt: ago(20) } });
    const query = await db.discoveryQuery.create({ data: { workspaceId: ws, missionId: mission.id, round: 1, queryType: 'PRIMARY_CATEGORY', strategyKey: 'primary', queryText: 'landscaping in Austin', category: 'landscaping', provider: 'fake_leads', pageLimit: 1, status: 'COMPLETED' } });
    await db.discoveryObservation.create({ data: { workspaceId: ws, missionId: mission.id, queryId: query.id, round: 1, provider: 'fake_leads', sourceRecordId: uniqueSlug('rec'), name: company.displayName, rawPayload: {}, observedAt: ago(20), status: 'RESOLVED', outcome: 'CREATED', companyId: company.id, resolvedAt: ago(20) } });
    const signal = await db.signal.create({ data: { workspaceId: ws, companyId: company.id, type: 'NEW_SERVICE', category: 'BUSINESS_CHANGE', subject: 'irrigation', title: 'New service: irrigation', fact: 'The website lists a new service', dedupeKey: uniqueSlug('sig'), status: 'ACTIONABLE', strength: 'STRONG', relevance: {}, confidence: 'HIGH', sourceKind: 'WEBSITE', relationship: 'COLD', recommendedAction: 'CAMPAIGN_CANDIDATE', detectedAt: ago(18), effectiveAt: ago(18), lastSeenAt: ago(18), expiresAt: new Date(Date.now() + 30 * DAY) } });
    const person = await db.person.create({ data: { workspaceId: ws, fullName: 'Sam Rivera', firstName: 'Sam' } });
    await db.employment.create({ data: { workspaceId: ws, personId: person.id, companyId: company.id, title: 'Owner' } });
    const campaign = await db.campaign.create({ data: { workspaceId: ws, name: 'Austin spring lawn offer', status: 'ACTIVE', launchedAt: ago(16) } });
    const step = await db.campaignStep.create({ data: { workspaceId: ws, campaignId: campaign.id, position: 1, kind: 'FIRST_TOUCH', delayDays: 0 } });
    const enrollment = await db.campaignEnrollment.create({ data: { workspaceId: ws, campaignId: campaign.id, companyId: company.id, personId: person.id, email: 'sam@evergreen.example', status: 'REPLIED', unsubscribeToken: uniqueSlug('tok').padEnd(24, 'x'), enrolledAt: ago(15) } });
    const message = await db.campaignMessage.create({ data: { workspaceId: ws, campaignId: campaign.id, enrollmentId: enrollment.id, stepId: step.id, position: 1, subject: 'Spring lawns in Austin', body: 'Hi Sam…', status: 'SENT', sentAt: ago(15, -1) } });
    const conv = await db.conversation.create({ data: { workspaceId: ws, companyId: company.id, personId: person.id, email: 'sam@evergreen.example', contactName: 'Sam Rivera', mailboxIntegrationId: randomUUID(), threadRef: uniqueSlug('thr'), subject: 'Re: Spring lawns in Austin', campaignId: campaign.id, enrollmentId: enrollment.id, primaryIntent: 'POSITIVE', createdAt: ago(12), lastInboundAt: ago(12) } });
    const inbound = await db.conversationMessage.create({ data: { workspaceId: ws, conversationId: conv.id, direction: 'INBOUND', author: 'PROSPECT', text: 'Sounds good, tell me more', occurredAt: ago(12) } });
    await db.messageClassification.create({ data: { workspaceId: ws, conversationId: conv.id, messageId: inbound.id, primaryIntent: 'POSITIVE', sentiment: 'POSITIVE', confidence: 'HIGH', method: 'RULES' } });
    const opp = await db.$transaction((tx) => createOpportunityTx(tx, owner, { companyId: company.id, name: 'Evergreen — lawn program', conversationId: conv.id, amountMinor: 400_000 }));
    const [type] = await meetingTypes(db, ws);
    const meeting = await db.meeting.create({ data: { workspaceId: ws, companyId: company.id, opportunityId: opp.id, conversationId: conv.id, meetingTypeId: type!.id, title: 'Discovery call — Evergreen', status: 'COMPLETED', startAt: ago(1), endAt: ago(1, -1), bookedAt: ago(2), bookedVia: 'MANUAL', timezone: 'America/Chicago', timezoneSource: 'COMPANY', timezoneConfidence: 'MEDIUM', ownerTimezone: 'America/Chicago', createdByType: 'HUMAN', createdById: owner.actor.id } });
    await markWon(db, owner, opp.id, { amountMinor: 500_000, note: 'Signed proposal' });
    return { company, market, mission, signal, campaign, message, conv, opp, meeting };
  };

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
  });
  after(async () => {
    // Analytics never creates an external action.
    assert.equal(await prisma.client.externalAction.count({ where: { workspaceId: { in: workspaces } } }), 0);
    await close();
  });

  test('DoD: one won deal → ordered chain MARKET…MEETING + one WON revenue event; re-running is idempotent', async () => {
    const owner = await workspace();
    const c = await chain(owner);
    const deps = { db: prisma.client };
    const r1 = await attributeOpportunity(deps, { workspaceId: owner.workspaceId, opportunityId: c.opp.id });
    assert.equal(r1.changed, true);
    assert.equal(r1.revenueRecorded, true);
    const touches = await prisma.client.attributionTouch.findMany({ where: { opportunityId: c.opp.id }, orderBy: { position: 'asc' } });
    assert.deepEqual(touches.map((t) => t.touchType), ['MARKET', 'DISCOVERY', 'SIGNAL', 'CAMPAIGN', 'MESSAGE', 'CONVERSATION', 'MEETING']);
    assert.deepEqual(touches.map((t) => t.position), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal((touches[1]!.detail as { provider: string }).provider, 'fake_leads');
    assert.equal((touches[2]!.detail as { signalType: string }).signalType, 'NEW_SERVICE');
    assert.equal((touches[3]!.detail as { persona: string }).persona, 'Owner / decision maker');
    const won = await prisma.client.revenueEvent.findMany({ where: { opportunityId: c.opp.id } });
    assert.equal(won.length, 1);
    assert.equal(won[0]!.type, 'WON');
    assert.equal(won[0]!.amountMinor, 500_000);
    assert.equal(won[0]!.dedupeKey, `won:${c.opp.id}`);

    // Again (a retried job, or the "created" and "won" routes both firing): nothing changes.
    const r2 = await attributeOpportunity(deps, { workspaceId: owner.workspaceId, opportunityId: c.opp.id });
    assert.equal(r2.changed, false);
    assert.equal(r2.revenueRecorded, false);
    assert.equal(await prisma.client.attributionTouch.count({ where: { opportunityId: c.opp.id } }), 7);
    assert.equal(await prisma.client.revenueEvent.count({ where: { opportunityId: c.opp.id } }), 1);
    assert.equal(await prisma.client.domainEvent.count({ where: { aggregateId: c.opp.id, eventType: 'AttributionUpdated' } }), 1);
    assert.equal(await prisma.client.domainEvent.count({ where: { workspaceId: owner.workspaceId, eventType: 'RevenueRecorded' } }), 1);

    // The lineage links every record and names no gaps for a full chain.
    const l = await lineage(prisma.client, owner.workspaceId, c.opp.id);
    assert.equal(l.steps.length, 7);
    assert.equal(l.steps[0]!.href, `/analytics?tab=markets&marketId=${c.market.id}`);
    assert.equal(l.steps[1]!.href, `/lead-hunter/${c.mission.id}`);
    assert.equal(l.steps[2]!.href, `/signals/${c.signal.id}`);
    assert.equal(l.steps[3]!.href, `/campaigns/${c.campaign.id}`);
    assert.equal(l.steps[5]!.href, `/inbox?c=${c.conv.id}`);
    assert.equal(l.steps[6]!.href, `/meetings/${c.meeting.id}`);
    assert.equal(l.owner, 'Olivia Owner');
    assert.deepEqual(l.gaps, []);

    // Attribution report credits the market, the campaign and the signal type.
    const rep = await attributionReport(prisma.client, owner.workspaceId, { range: '30d' }, 'FULL');
    assert.equal(rep.totalRevenueMinor, 500_000);
    assert.equal(rep.unattributed, 0);
    assert.equal(rep.byDimension.market[0]!.label, 'Austin landscapers');
    assert.equal(rep.byDimension.market[0]!.revenueMinor, 500_000);
    assert.equal(rep.byDimension.campaign[0]!.key, c.campaign.id);
    assert.equal(rep.byDimension.signalType[0]!.key, 'NEW_SERVICE');
    assert.equal(rep.byDimension.source[0]!.key, 'fake_leads');
    assert.equal(rep.byDimension.persona[0]!.key, 'Owner / decision maker');
    assert.equal(rep.byDimension.industry[0]!.label, 'Landscaping');
    assert.equal(rep.deals[0]!.opportunityId, c.opp.id);
    // Split models never hand out more than the deal is worth.
    const linear = await attributionReport(prisma.client, owner.workspaceId, { range: '30d' }, 'LINEAR');
    const credited = (['market', 'source', 'signalType', 'campaign'] as const).reduce((a, d) => a + linear.byDimension[d].reduce((x, r) => x + r.revenueMinor, 0), 0);
    assert.ok(credited <= 500_000 && credited > 0);
    const first = await attributionReport(prisma.client, owner.workspaceId, { range: '30d' }, 'FIRST_TOUCH');
    assert.equal(first.byDimension.market[0]!.revenueMinor, 500_000);
    assert.equal(first.byDimension.campaign[0]!.revenueMinor, 0);

    // Payments and refunds adjust revenue; refunds never exceed what was recorded; open deals take no revenue.
    await recordRevenue(prisma.client, owner, { opportunityId: c.opp.id, type: 'PAYMENT', amountMinor: 100_000 });
    await recordRevenue(prisma.client, owner, { opportunityId: c.opp.id, type: 'EXPANSION', amountMinor: 20_000 });
    await recordRevenue(prisma.client, owner, { opportunityId: c.opp.id, type: 'REFUND', amountMinor: 70_000, note: 'Partial refund' });
    await assert.rejects(() => recordRevenue(prisma.client, owner, { opportunityId: c.opp.id, type: 'REFUND', amountMinor: 10_000_000 }), (e: unknown) => e instanceof BusinessRuleError && /can not exceed/.test(e.message));
    const open = await prisma.client.$transaction((tx) => createOpportunityTx(tx, owner, { companyId: c.company.id, name: 'Evergreen — second site' }));
    await assert.rejects(() => recordRevenue(prisma.client, owner, { opportunityId: open.id, type: 'REFUND', amountMinor: 1_000 }), (e: unknown) => e instanceof BusinessRuleError && /won deal/.test(e.message));
    await assert.rejects(() => recordRevenue(prisma.client, owner, { opportunityId: open.id, type: 'PAYMENT', amountMinor: 1_000 }), BusinessRuleError);
    const l2 = await lineage(prisma.client, owner.workspaceId, c.opp.id);
    assert.deepEqual(l2.revenue.map((r) => r.type).sort(), ['EXPANSION', 'PAYMENT', 'REFUND', 'WON']);

    // Overview: outcomes from the records, funnel, freshness.
    const o = await overview(prisma.client, owner.workspaceId, { range: '30d' });
    const v = (key: string) => [...o.outcomes, ...o.sales, ...o.outreach, ...o.operations].find((k) => k.key === key)!;
    assert.equal(o.empty, false);
    assert.equal(v('wonRevenue').value, 550_000);
    assert.equal(v('wonDeals').value, 1);
    assert.equal(v('winRate').value, 100);
    assert.equal(v('winRate').lowSample, true);
    assert.equal(v('meetingsBooked').value, 1);
    assert.equal(v('contacted').value, 1);
    assert.equal(v('replies').value, 1);
    assert.equal(v('positiveReplies').value, 1);
    assert.equal(v('replyRate').value, 100);
    assert.equal(o.openPipelineUnvalued, 1, 'the second deal has no estimate — counted, not valued');
    assert.equal(o.funnel.find((f) => f.key === 'won')!.count, 1);
    assert.equal(o.funnel.find((f) => f.key === 'discovered')!.count, 1);
    assert.ok(o.funnel.every((f) => f.conversion === null || f.conversion <= 100));
    assert.equal(o.freshness.length, 7);
    assert.equal(o.timeline.reduce((a, w) => a + w.revenueMinor, 0), 550_000);

    // No dead-end numbers: drill to the records.
    const d = await drill(prisma.client, owner.workspaceId, 'wonDeals', { range: '30d' });
    assert.equal(d.total, 1);
    assert.equal(d.records[0]!.id, c.opp.id);
    assert.equal(d.records[0]!.href, `/opportunities/${c.opp.id}`);
    const df = await drill(prisma.client, owner.workspaceId, 'funnel.won', { range: '30d' });
    assert.equal(df.records[0]!.id, c.company.id);
    const dp = await drill(prisma.client, owner.workspaceId, 'openPipeline', { range: '30d' }, { stage: 'NEW' });
    assert.equal(dp.records[0]!.id, open.id);
    const dm = await drill(prisma.client, owner.workspaceId, 'positiveReplies', { range: '30d', campaignId: c.campaign.id });
    assert.equal(dm.records[0]!.href, `/inbox?c=${c.conv.id}`);

    // Ask, deterministic: "where is revenue coming from?" in Roman Urdu.
    const a = await ask(prisma.client, owner.workspaceId, 'revenue kahan se aa raha hai?', { range: '30d' });
    assert.equal(a.intent, 'REVENUE_SOURCES');
    assert.ok(a.records.some((r) => r.id === c.opp.id));
    assert.ok(a.observed.some((x) => x.label === 'Top market' && x.value.startsWith('Austin landscapers')));
    assert.ok(a.recommendation?.startsWith('Investigate'));
    const unknown = await ask(prisma.client, owner.workspaceId, 'what is the weather like', { range: '30d' });
    assert.equal(unknown.intent, 'UNKNOWN');
    assert.ok(unknown.suggestions.length > 0);
  });

  test('costs: unknown-cost provider calls are counted as unknown, never zero; per-meeting cost only when fully known', async () => {
    const owner = await workspace();
    const c = await chain(owner);
    await attributeOpportunity({ db: prisma.client }, { workspaceId: owner.workspaceId, opportunityId: c.opp.id });
    const call = { workspaceId: owner.workspaceId, provider: 'fake_leads', capability: 'COMPANY_SEARCH', operation: 'search', status: 'SUCCEEDED' as const, durationMs: 120, entityType: 'COMPANY', entityId: c.company.id, startedAt: ago(5) };
    await prisma.client.providerCallRecord.create({ data: { ...call, costMinor: 120 } });
    await prisma.client.providerCallRecord.create({ data: { ...call, costMinor: null } });
    await prisma.client.providerCallRecord.create({ data: { ...call, entityType: 'DISCOVERY_MISSION', entityId: c.mission.id, costMinor: 30 } });
    const k = await costs(prisma.client, owner.workspaceId, { range: '30d' });
    assert.equal(k.providerMinor, 150);
    assert.equal(k.unknownCostCalls, 1);
    assert.equal(k.perMeetingMinor, null, 'part of the cost is unknown');
    assert.equal(k.byProvider[0]!.unknown, 1);
    assert.equal(k.byMarket[0]!.costMinor, 150);
    const o = await overview(prisma.client, owner.workspaceId, { range: '30d' });
    const pc = o.operations.find((x) => x.key === 'providerCost')!;
    assert.equal(pc.value, 150);
    assert.equal(pc.partial, true);
    assert.ok(o.insights.some((i) => i.kind === 'COST'));
    const [m] = await markets(prisma.client, owner.workspaceId, { range: '30d' });
    assert.equal(m!.companies, 1);
    assert.equal(m!.meetings, 1);
    assert.equal(m!.won, 1);
    assert.equal(m!.costMinor, 150);
    assert.equal(m!.costUnknownCalls, 1);
    assert.equal(m!.costPerMeetingMinor, null);
    assert.equal((await freshness(prisma.client, owner.workspaceId)).find((f) => f.source === 'PROVIDER_COST')!.state, 'DELAYED');
  });

  test('projection: the rollup is idempotent and backfills deals without touches', async () => {
    const owner = await workspace();
    const c = await chain(owner);
    // No attribution has run (no worker in tests) — the rollup backfills it.
    assert.equal(await prisma.client.attributionTouch.count({ where: { opportunityId: c.opp.id } }), 0);
    const deps = { db: prisma.client };
    const r1 = await rollupDailyMetrics(deps, { workspaceId: owner.workspaceId });
    assert.equal(r1.attributed, 1);
    assert.equal(await prisma.client.attributionTouch.count({ where: { opportunityId: c.opp.id } }), 7);
    const snap = async () => (await prisma.client.dailyMetric.findMany({ where: { workspaceId: owner.workspaceId }, select: { day: true, metric: true, dimension: true, dimensionId: true, value: true } })).map((r) => `${r.day.toISOString().slice(0, 10)}|${r.metric}|${r.dimension}|${r.dimensionId}|${r.value}`).sort();
    const first = await snap();
    const r2 = await rollupDailyMetrics(deps, { workspaceId: owner.workspaceId });
    assert.equal(r2.attributed, 0);
    assert.equal(r2.rows, r1.rows);
    assert.deepEqual(await snap(), first);
    assert.ok(first.some((r) => r.includes('|wonRevenue|ALL||500000')));
    assert.ok(first.some((r) => r.includes(`|contacted|CAMPAIGN|${c.campaign.id}|1`)));
    assert.ok(first.some((r) => r.includes(`|companiesDiscovered|MARKET|${c.market.id}|1`)));
    assert.equal(await prisma.client.analyticsRun.count({ where: { workspaceId: owner.workspaceId, kind: 'ROLLUP', status: 'SUCCEEDED' } }), 2);
    assert.equal((await freshness(prisma.client, owner.workspaceId)).find((f) => f.source === 'PROJECTIONS')!.state, 'CURRENT');
  });

  test('no fake metrics: an empty workspace is empty — zero counts, unknown rates, no invented insights', async () => {
    const owner = await workspace();
    const o = await overview(prisma.client, owner.workspaceId, { range: '30d' });
    const all = [...o.outcomes, ...o.sales, ...o.outreach, ...o.operations];
    const v = (key: string) => all.find((k) => k.key === key)!;
    assert.equal(o.empty, true);
    assert.equal(v('wonRevenue').value, 0);
    assert.equal(v('wonDeals').value, 0);
    assert.equal(v('winRate').value, null);
    assert.equal(v('salesCycleDays').value, null);
    assert.equal(v('replyRate').value, null);
    assert.equal(v('costPerMeeting').value, null);
    assert.ok(all.every((k) => k.lowSample || k.value === null));
    assert.ok(o.funnel.every((f) => f.count === 0 && !f.leak));
    assert.deepEqual(o.insights, []);
    assert.equal(o.freshness.find((f) => f.source === 'REVENUE')!.state, 'NOT_CONNECTED');
    const rep = await attributionReport(prisma.client, owner.workspaceId, { range: '30d' }, 'FULL');
    assert.equal(rep.totalRevenueMinor, 0);
    assert.equal(rep.deals.length, 0);
    const k = await costs(prisma.client, owner.workspaceId, { range: '30d' });
    assert.equal(k.totalMinor, 0);
    assert.equal(k.perMeetingMinor, null);
  });

  test('saved views are private unless shared, and only the owner changes them', async () => {
    const owner = await workspace();
    const v = await saveView(prisma.client, owner, { name: 'Austin 90d', tab: 'attribution', filters: { range: '90d' } });
    assert.equal(v.mine, true);
    await assert.rejects(() => saveView(prisma.client, owner, { name: 'Austin 90d', tab: 'overview', filters: { range: '30d' } }), /already have a view/);
    const other = randomUUID();
    assert.equal((await listViews(prisma.client, owner.workspaceId, other)).length, 0, 'private by default');
    await deleteView(prisma.client, owner, v.id);
    assert.equal((await listViews(prisma.client, owner.workspaceId, owner.actor.id!)).length, 0);
    assert.equal(await prisma.client.domainEvent.count({ where: { aggregateId: v.id, eventType: 'AnalyticsViewSaved' } }), 2);
  });
});
