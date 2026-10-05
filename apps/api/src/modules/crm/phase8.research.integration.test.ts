import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { EVENTS } from '@revenue-os/events';
import { recordEvidenceTx, requestResearchTx, runResearchJob } from '@revenue-os/domain';
import { FakeWebsiteProvider } from '@revenue-os/providers';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { analyzePage, normalizeCompanyName } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';

const o = () => ({ signal: AbortSignal.timeout(5000) });

/** Finds a fictional domain whose test website has the traits a test needs (the fake derives every site from its domain). */
async function findDomain(want: (home: Awaited<ReturnType<FakeWebsiteProvider['fetchPage']>>, about: ReturnType<typeof analyzePage> | null) => boolean) {
  const web = new FakeWebsiteProvider();
  for (let i = 0; i < 400; i++) {
    const domain = `researchsite${i}.example`;
    const home = await web.fetchPage(`https://${domain}/`, o());
    const aboutUrl = home.failure ? null : analyzePage(home.body, home.finalUrl).links.about;
    const about = aboutUrl ? await web.fetchPage(aboutUrl, o()) : null;
    if (want(home, about && !about.failure ? analyzePage(about.body, about.finalUrl) : null)) return domain;
  }
  throw new Error('no matching test domain');
}

/**
 * Phase 8 (docs/17 §52-57): a discovered company develops a company intelligence profile — website snapshots and
 * deterministic checks as evidence-backed facts, technology and social profiles, published contacts, named people
 * with employment evidence, verification, and opportunity hypotheses that cite evidence and never claim certainty.
 */
describe('Phase 8 — company research', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let storage: string;
  let runtime: ProviderRuntime;

  const newWorkspace = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, {
      name: 'Research Test',
      slug: uniqueSlug('research'),
      owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner' },
    });
    return { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } } satisfies ServiceContext;
  };
  const connect = (ctx: ServiceContext, provider: 'fake_websites' | 'fake_verification') =>
    prisma.client.integration.create({
      data: {
        workspaceId: ctx.workspaceId,
        provider,
        category: provider === 'fake_websites' ? 'WEB' : 'VERIFICATION',
        name: provider,
        capabilities: [provider === 'fake_websites' ? 'WEBSITE_FETCH' : 'EMAIL_VERIFY'],
        status: 'ACTIVE',
        priority: 100,
        connectedAt: new Date(),
      },
    });
  const company = (ctx: ServiceContext, name: string, websiteDomain: string | null) =>
    prisma.client.company.create({ data: { workspaceId: ctx.workspaceId, displayName: name, normalizedName: normalizeCompanyName(name), websiteDomain, city: 'Austin', region: 'TX', country: 'US' } });
  const deps = () => ({ db: prisma.client, gateway: runtime.gateway, workerId: 'test-worker' });
  /** What the API does (QUEUED run + event) and then what the worker does with the job. */
  const research = async (ctx: ServiceContext, companyId: string) => {
    const { run } = await prisma.client.$transaction((tx) => requestResearchTx(tx, ctx, companyId));
    const result = await runResearchJob(deps(), { workspaceId: ctx.workspaceId, companyId, runId: run.id, trigger: 'MANUAL' });
    return { result, run: await prisma.client.researchRun.findUniqueOrThrow({ where: { id: run.id } }) };
  };

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    storage = await mkdtemp(join(tmpdir(), 'rhl-phase8-'));
    runtime = createProviderRuntime(prisma.client, { appEnv: 'test', storagePath: storage });
  });

  after(async () => {
    await close();
    await rm(storage, { recursive: true, force: true });
  });

  test('a company with a website develops an evidence-backed profile; nothing guessed; re-running duplicates nothing', async () => {
    const ctx = await newWorkspace();
    await connect(ctx, 'fake_websites');
    await connect(ctx, 'fake_verification');
    const domain = await findDomain((home, about) => !home.failure && !!about?.people.some((p) => p.email));
    const c = await company(ctx, 'Research Target Co', domain);

    const { result, run } = await research(ctx, c.id);
    assert.equal(result.outcome, 'RAN');
    assert.ok(run.status === 'COMPLETED' || run.status === 'PARTIAL', run.status);
    assert.equal(run.leaseOwner, null);
    assert.ok((run.steps as { key: string }[]).some((s) => s.key === 'audit'));

    const website = await prisma.client.website.findFirstOrThrow({ where: { companyId: c.id }, include: { snapshots: true, audits: true } });
    assert.equal(website.status, 'LIVE');
    assert.ok(website.snapshots.length >= 2, 'home + contact/about pages snapshotted');
    for (const sn of website.snapshots) {
      assert.ok(sn.evidenceId, 'every snapshot is evidence');
      assert.match(sn.contentHash, /^[0-9a-f]{64}$/);
    }
    assert.equal(website.audits.length, 1);

    // Deterministic checks are facts with evidence from the website.
    const facts = await prisma.client.fact.findMany({ where: { entityType: 'COMPANY', entityId: c.id, field: { startsWith: 'website.' } }, include: { evidence: { include: { evidence: true } } } });
    for (const field of ['website.loads', 'website.https', 'website.contact_form', 'website.online_booking']) {
      const f = facts.find((x) => x.field === field && x.status === 'ACTIVE');
      assert.ok(f, `${field} recorded`);
      assert.ok(f.evidence.length > 0 && f.evidence.every((e) => e.evidence.sourceType === 'WEBSITE'), `${field} cites the website`);
    }

    // People named on the site: unverified employment (LOW, no verifiedAt) with the page as evidence.
    const employments = await prisma.client.employment.findMany({ where: { companyId: c.id }, include: { person: true } });
    assert.ok(employments.length >= 1);
    for (const e of employments) {
      assert.equal(e.confidence, 'LOW');
      assert.equal(e.verifiedAt, null);
      assert.ok(await prisma.client.evidence.count({ where: { entityType: 'PERSON', entityId: e.personId, evidenceType: 'WEBSITE_MENTION' } }));
    }

    // Every email we hold was published on a page we stored — none guessed. A personal address verifies VALID.
    const people = employments.map((e) => e.personId);
    const emails = await prisma.client.contactPoint.findMany({ where: { workspaceId: ctx.workspaceId, type: 'EMAIL', OR: [{ entityId: c.id }, { entityId: { in: people } }] }, include: { verifications: true } });
    assert.ok(emails.length >= 1);
    const pageText = website.snapshots.map((s) => s.textExcerpt ?? '').join('\n');
    for (const e of emails) assert.ok(pageText.includes(e.normalizedValue), `${e.normalizedValue} appears on the website`);
    const personal = emails.find((e) => e.entityType === 'PERSON')!;
    assert.equal(personal.status, 'VERIFIED');
    assert.equal(personal.verifications[0]?.status, 'VALID');
    const shared = emails.find((e) => e.normalizedValue.startsWith('info@'));
    if (shared) {
      assert.equal(shared.status, 'UNVERIFIED', 'a RISKY role address is not marked verified');
      assert.equal(shared.verifications[0]?.status, 'RISKY');
    }

    // Hypotheses: hedged, cite evidence, kept apart from facts.
    const hyps = await prisma.client.opportunityHypothesis.findMany({ where: { companyId: c.id }, include: { evidence: true } });
    for (const h of hyps) {
      assert.match(h.hypothesis, /\bmay\b/);
      assert.ok(h.evidence.length > 0, `${h.key} cites evidence`);
      assert.equal(h.status, 'ACTIVE');
    }
    const events = (await prisma.client.domainEvent.findMany({ where: { workspaceId: ctx.workspaceId } })).map((e) => e.eventType);
    for (const type of ['ResearchRequested', 'WebsiteAudited', 'ContactPointVerified', 'ResearchRunCompleted']) assert.ok(events.includes(type), type);

    // Re-run: facts confirmed (not conflicted), no duplicate people, contacts or hypotheses.
    const counts = async () => ({
      people: await prisma.client.employment.count({ where: { companyId: c.id } }),
      contacts: await prisma.client.contactPoint.count({ where: { workspaceId: ctx.workspaceId } }),
      hypotheses: await prisma.client.opportunityHypothesis.count({ where: { companyId: c.id } }),
      social: await prisma.client.socialProfile.count({ where: { companyId: c.id } }),
      tech: await prisma.client.companyTechnology.count({ where: { companyId: c.id } }),
    });
    const before = await counts();
    const again = await research(ctx, c.id);
    assert.equal(again.result.outcome, 'RAN');
    assert.deepEqual(await counts(), before);
    assert.equal(await prisma.client.fact.count({ where: { entityId: c.id, status: 'CONFLICTED' } }), 0);
  });

  test('no website: "may benefit from a website" rests on the listings; a stale reason is invalidated, not deleted', async () => {
    const ctx = await newWorkspace();
    await connect(ctx, 'fake_websites');
    const c = await company(ctx, 'No Site Plumbing', null);
    await prisma.client.$transaction((tx) =>
      recordEvidenceTx(tx, ctx, { entityType: 'COMPANY', entityId: c.id, evidenceType: 'LISTING', sourceType: 'LEAD_SOURCE', provider: 'fake_leads', observedAt: new Date(), contentExcerpt: 'Listing without a website' }),
    );
    const stale = await prisma.client.opportunityHypothesis.create({
      data: { workspaceId: ctx.workspaceId, companyId: c.id, key: 'NO_SSL', hypothesis: 'old', reasonSummary: 'old', confidence: 'HIGH', generatedAt: new Date(), lastSupportedAt: new Date() },
    });

    const { run } = await research(ctx, c.id);
    assert.ok(run.status === 'COMPLETED' || run.status === 'PARTIAL');
    const hyps = await prisma.client.opportunityHypothesis.findMany({ where: { companyId: c.id }, include: { evidence: { include: { evidence: true } } } });
    const noSite = hyps.find((h) => h.key === 'NO_WEBSITE');
    assert.ok(noSite);
    assert.equal(noSite.evidence[0]?.evidence.evidenceType, 'LISTING');
    assert.equal(hyps.find((h) => h.id === stale.id)?.status, 'INVALIDATED');
  });

  test('a website that does not load: one LOW hypothesis, nothing concluded about booking or forms', async () => {
    const ctx = await newWorkspace();
    await connect(ctx, 'fake_websites');
    const domain = await findDomain((home) => home.failure === 'TIMEOUT');
    const c = await company(ctx, 'Down Site Co', domain);
    const { run } = await research(ctx, c.id);
    assert.equal(run.status, 'PARTIAL');
    const site = await prisma.client.website.findFirstOrThrow({ where: { companyId: c.id } });
    assert.equal(site.status, 'UNREACHABLE');
    const hyps = await prisma.client.opportunityHypothesis.findMany({ where: { companyId: c.id } });
    assert.deepEqual(hyps.map((h) => [h.key, h.confidence]), [['WEBSITE_UNREACHABLE', 'LOW']]);
  });

  test('without a website reader the run is PARTIAL and names the gap; no website hypothesis is invented', async () => {
    const ctx = await newWorkspace();
    const c = await company(ctx, 'Unread Site Co', 'researchsite1.example');
    const { run } = await research(ctx, c.id);
    assert.equal(run.status, 'PARTIAL');
    assert.ok(run.gaps.some((g) => /website reader/.test(g)));
    assert.equal(await prisma.client.opportunityHypothesis.count({ where: { companyId: c.id } }), 0);
  });

  test('discovery triggers research once per company; a second request while one waits returns the same run', async () => {
    assert.equal(EVENTS.CompanyDiscovered.routes[0]?.job, 'research.company.run');
    assert.equal(EVENTS.ResearchRequested.routes.length, 1);
    const ctx = await newWorkspace();
    await connect(ctx, 'fake_websites');
    const c = await company(ctx, 'Found Twice Co', null);
    const job = { workspaceId: ctx.workspaceId, companyId: c.id, trigger: 'DISCOVERY' as const };
    const first = await runResearchJob(deps(), job);
    const second = await runResearchJob(deps(), job);
    assert.equal(first.outcome, 'RAN');
    assert.deepEqual([second.outcome, second.reason], ['SKIPPED', 'FRESH']);

    const a = await prisma.client.$transaction((tx) => requestResearchTx(tx, ctx, c.id));
    const b = await prisma.client.$transaction((tx) => requestResearchTx(tx, ctx, c.id));
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.run.id, b.run.id);
  });
});
