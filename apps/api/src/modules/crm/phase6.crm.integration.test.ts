import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BusinessRuleError, ConflictError, PERMISSION_KEYS } from '@revenue-os/shared';
import { hashPassword } from '@revenue-os/shared/server';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../../app-setup.js';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { WorkspaceService } from '../identity/workspace.service.js';
import { CompanyQueryService } from './company.query.js';
import { CompanyService } from './company.service.js';
import { ContactPointService } from './contact-point.service.js';
import { EntityResolutionService } from './entity-resolution.service.js';
import { PersonService } from './person.service.js';

const ALL = new Set(PERMISSION_KEYS);
const GREENSCAPE = { displayName: 'GreenScape Landscaping LLC', website: 'https://www.greenscape-atx.com', phone: '(512) 555-0100', city: 'Austin', region: 'TX', country: 'US' };

/**
 * Phase 6 (docs/17 §40-45): Company 360 V1 + entity resolution. Duplicates become candidates (never blind merges),
 * only safe system-created matches auto-merge, and a merge moves everything while preserving source history.
 */
describe('Phase 6 — CRM core, entity resolution, merge', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let resolution: EntityResolutionService, companies: CompanyService, people: PersonService, contacts: ContactPointService;
  let evidence: EvidenceService, query: CompanyQueryService;

  const newWorkspace = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, {
      name: 'CRM Test',
      slug: uniqueSlug('crm'),
      owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner' },
    });
    return { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } } satisfies ServiceContext;
  };
  const candidates = (workspaceId: string) => prisma.client.entityMatchCandidate.findMany({ where: { workspaceId }, orderBy: { detectedAt: 'asc' } });
  const observe = (ctx: ServiceContext, companyId: string, field: string, value: string, sourceName: string, daysAgo = 1) =>
    evidence.recordObservation(ctx, {
      entityType: 'COMPANY',
      entityId: companyId,
      field,
      value,
      source: { sourceType: 'WEBSITE', sourceName, observedAt: new Date(Date.now() - daysAgo * 86_400_000) },
    });

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    resolution = new EntityResolutionService(prisma);
    companies = new CompanyService(prisma, resolution);
    people = new PersonService(prisma);
    contacts = new ContactPointService(prisma);
    evidence = new EvidenceService(prisma);
    query = new CompanyQueryService(prisma);
  });

  after(async () => close());

  test('a likely duplicate typed in by a person becomes a review candidate — never merged automatically', async () => {
    const ctx = await newWorkspace();
    const a = await companies.create(ctx, GREENSCAPE);
    const b = await companies.create(ctx, { displayName: 'Greenscape Landscaping', website: 'greenscape-atx.com', phone: '+1 512 555 0100', city: 'Austin' });
    assert.equal(b.status, 'DISCOVERED');
    assert.equal(b.mergedIntoId, null);

    const [c] = await candidates(ctx.workspaceId);
    assert.ok(c);
    assert.equal(c.status, 'NEEDS_REVIEW');
    assert.equal(c.confidence, 'HIGH');
    assert.deepEqual([c.leftId, c.rightId], [a.id, b.id].sort());
    const kinds = (c.matchingSignals as { kind: string }[]).map((s) => s.kind).sort();
    assert.deepEqual(kinds, ['CITY', 'DOMAIN', 'NAME_EXACT', 'PHONE']);
    const events = await prisma.client.domainEvent.findMany({ where: { aggregateId: c.id } });
    assert.deepEqual(events.map((e) => e.eventType), ['DuplicateCandidateDetected']);

    // Unrelated business → no candidate.
    await companies.create(ctx, { displayName: 'Hill Country Roofing', website: 'hcroofing.com', city: 'Dallas' });
    assert.equal((await candidates(ctx.workspaceId)).length, 1);
  });

  test('a safe HIGH match on a system-created record auto-merges into the existing company', async () => {
    const ctx = await newWorkspace();
    const existing = await companies.create(ctx, GREENSCAPE);
    const system: ServiceContext = { workspaceId: ctx.workspaceId, actor: { type: 'SYSTEM', id: null } };
    const imported = await companies.create(system, { displayName: 'GreenScape Landscaping', website: 'greenscape-atx.com', phone: '5125550100', city: 'Austin', postalCode: '78703' });

    assert.equal(imported.mergedIntoId, existing.id);
    assert.equal(imported.status, 'ARCHIVED');
    const merge = await prisma.client.entityMerge.findFirstOrThrow({ where: { sourceId: imported.id } });
    assert.equal(merge.mode, 'AUTO');
    assert.deepEqual(merge.filledFields, ['postalCode'], 'empty target fields are filled, nothing overwritten');
    const target = await companies.get(ctx, existing.id);
    assert.equal(target.postalCode, '78703');
    assert.equal(target.displayName, 'GreenScape Landscaping LLC');
    const [c] = await candidates(ctx.workspaceId);
    assert.equal(c?.status, 'MERGED');

    // A medium match from the system still waits for a human.
    const other = await companies.create(system, { displayName: 'GreenScape Landscaping', phone: '5125550100', city: 'Austin' });
    assert.equal(other.mergedIntoId, null);
    assert.equal((await candidates(ctx.workspaceId)).filter((x) => x.status === 'NEEDS_REVIEW').length, 1);
  });

  test('manual merge moves people, contacts, evidence and facts; preserves history; conflicts are flagged, not overwritten', async () => {
    const ctx = await newWorkspace();
    const target = await companies.create(ctx, GREENSCAPE);
    const source = await companies.create(ctx, { displayName: 'Greenscape Landscaping', website: 'greenscape-atx.com', phone: '512-555-0100', industry: 'Landscaping', addressLine: '120 N Lamar Blvd' });

    const { person } = await people.addToCompany(ctx, source.id, { fullName: 'Maria Lopez', title: 'Owner' });
    await contacts.add(ctx, { entityType: 'COMPANY', entityId: target.id, type: 'EMAIL', value: 'hello@greenscape-atx.com', isPrimary: true });
    const dup = await contacts.add(ctx, { entityType: 'COMPANY', entityId: source.id, type: 'EMAIL', value: 'HELLO@greenscape-atx.com', isPrimary: true });
    const moved = await contacts.add(ctx, { entityType: 'COMPANY', entityId: source.id, type: 'EMAIL', value: 'quotes@greenscape-atx.com', isPrimary: false });
    const same1 = await observe(ctx, target.id, 'employee_range', '11-50', 'About page');
    const same2 = await observe(ctx, source.id, 'employee_range', '11-50', 'Directory', 10);
    const diff1 = await observe(ctx, target.id, 'founded_year', '2009', 'About page');
    const diff2 = await observe(ctx, source.id, 'founded_year', '2011', 'Directory');

    const [candidate] = await candidates(ctx.workspaceId);
    assert.ok(candidate);
    const result = await resolution.mergeCandidate(ctx, candidate.id, { targetId: target.id, version: candidate.version, reason: 'Same business' });
    assert.deepEqual(result.merge.filledFields.sort(), ['addressLine', 'industry']);

    const after = await query.overview(ctx.workspaceId, target.id, ALL);
    assert.deepEqual(after.people.map((p) => p.person.id), [person.id], 'people moved');
    assert.deepEqual(after.contactPoints.map((c) => c.normalizedValue).sort(), ['hello@greenscape-atx.com', 'quotes@greenscape-atx.com']);
    assert.equal(after.contactPoints.filter((c) => c.isPrimary).length, 1, 'one primary per type');
    assert.equal(after.evidence.length, 4, 'all evidence now about the survivor, sources intact');
    assert.deepEqual(after.sources.map((s) => s.source).sort(), ['About page', 'Directory']);

    const employees = after.facts.filter((f) => f.field === 'employee_range');
    assert.equal(employees.length, 1, 'same value → one fact');
    assert.equal(employees[0]!.status, 'ACTIVE');
    assert.equal(employees[0]!.evidence.length, 2, 'both sources back the kept fact');
    assert.equal((await prisma.client.fact.findUniqueOrThrow({ where: { id: same2.fact.id } })).status, 'SUPERSEDED');
    assert.equal(same1.fact.id, employees[0]!.id);
    const founded = after.facts.filter((f) => f.field === 'founded_year');
    assert.deepEqual(founded.map((f) => f.status), ['CONFLICTED', 'CONFLICTED'], 'different values → conflict for a human');
    assert.equal(after.quality.conflictedFacts, 2);

    const src = await prisma.client.company.findUniqueOrThrow({ where: { id: source.id } });
    assert.equal(src.mergedIntoId, target.id);
    assert.equal(src.status, 'ARCHIVED');
    assert.ok((await prisma.client.contactPoint.findUniqueOrThrow({ where: { id: dup.id } })).archivedAt, 'duplicate contact archived, not deleted');
    assert.equal((await prisma.client.contactPoint.findUniqueOrThrow({ where: { id: moved.id } })).entityId, target.id);
    assert.deepEqual(after.mergedFrom.map((m) => m.id), [source.id]);
    const snapshot = result.merge.sourceSnapshot as { company: { displayName: string } };
    assert.equal(snapshot.company.displayName, 'Greenscape Landscaping');
    await assert.rejects(prisma.client.entityMerge.update({ where: { id: result.merge.id }, data: { reason: 'x' } }), /append-only/);

    // The merged-away record is read-only history.
    const merged = await query.overview(ctx.workspaceId, source.id, ALL);
    assert.equal(merged.mergedInto?.id, target.id);
    assert.equal(merged.allowedActions.edit, false);
    await assert.rejects(companies.update(ctx, source.id, src.version, { industry: 'x' }), BusinessRuleError);
    await assert.rejects(companies.restore(ctx, source.id, src.version), BusinessRuleError);
    await assert.rejects(resolution.mergeCandidate(ctx, candidate.id, { targetId: target.id, version: candidate.version + 1 }), BusinessRuleError);

    // A human picks the right founded year.
    await evidence.resolveConflict(ctx, diff1.fact.id);
    assert.equal((await prisma.client.fact.findUniqueOrThrow({ where: { id: diff2.fact.id } })).status, 'SUPERSEDED');
    assert.equal((await prisma.client.fact.findUniqueOrThrow({ where: { id: diff1.fact.id } })).status, 'ACTIVE');

    const activity = await query.activity(ctx.workspaceId, target.id, { limit: 100 });
    const actions = activity.items.map((i) => i.action);
    for (const a of ['company.created', 'company.merged', 'company.merged_away', 'duplicate.detected', 'person.created', 'employment.attached', 'evidence.recorded', 'fact.conflict_resolved']) {
      assert.ok(actions.includes(a), `activity includes ${a}`);
    }
    assert.equal(activity.items[0]!.actor.name, 'Owner');
    const events = await prisma.client.domainEvent.findMany({ where: { aggregateId: target.id, eventType: 'CompaniesMerged' } });
    assert.equal(events.length, 1);
  });

  test('"not the same business" is final; edits that remove the similarity close a candidate', async () => {
    const ctx = await newWorkspace();
    const a = await companies.create(ctx, { displayName: 'Capitol Turf', city: 'Austin', phone: '512 555 0177' });
    const b = await companies.create(ctx, { displayName: 'Capitol Turf', city: 'Austin', phone: '512 555 0177' });
    let [c] = await candidates(ctx.workspaceId);
    assert.equal(c?.status, 'NEEDS_REVIEW');
    await resolution.rejectCandidate(ctx, c!.id, { version: c!.version, reason: 'Two locations' });
    await companies.detectDuplicates(ctx, a.id);
    await companies.update(ctx, b.id, b.version, { industry: 'Landscaping', displayName: 'Capitol Turf' });
    [c] = await candidates(ctx.workspaceId);
    assert.equal(c?.status, 'REJECTED', 'rejected pairs are never proposed again');
    await assert.rejects(resolution.rejectCandidate(ctx, c!.id, { version: c!.version }), BusinessRuleError);

    const x = await companies.create(ctx, { displayName: 'Barton Creek Pools', city: 'Austin' });
    const y = await companies.create(ctx, { displayName: 'Barton Creek Pools', city: 'Austin' });
    const open = (await candidates(ctx.workspaceId)).find((k) => [k.leftId, k.rightId].includes(x.id));
    assert.equal(open?.status, 'PENDING', 'name + city only → low confidence');
    await companies.update(ctx, y.id, y.version, { displayName: 'Lakeway Pool Service', city: 'Lakeway' });
    assert.equal((await prisma.client.entityMatchCandidate.findUniqueOrThrow({ where: { id: open!.id } })).status, 'AUTO_RESOLVED');
  });

  test('concurrent creates of the same business → no pair is missed (advisory lock)', async () => {
    const ctx = await newWorkspace();
    await Promise.all([1, 2, 3].map((i) => companies.create(ctx, { displayName: `Lone Star Fence ${i === 1 ? '' : 'Co'}`.trim(), website: 'lonestarfence.com' })));
    const rows = await candidates(ctx.workspaceId);
    assert.equal(rows.length, 3, 'every pair among the three records is a candidate — none missed');
  });

  test('archive / restore are explicit commands; archived companies leave lists and matching', async () => {
    const ctx = await newWorkspace();
    const a = await companies.create(ctx, { displayName: 'Zilker Tree Care', website: 'zilkertree.com' });
    const archived = await companies.archive(ctx, a.id, a.version, 'Out of business');
    assert.equal(archived.status, 'ARCHIVED');
    await assert.rejects(companies.archive(ctx, a.id, archived.version), BusinessRuleError);
    assert.equal((await query.list(ctx.workspaceId, { limit: 25 })).items.length, 0);
    assert.equal((await query.list(ctx.workspaceId, { limit: 25, status: 'ARCHIVED' })).items.length, 1);

    await companies.create(ctx, { displayName: 'Zilker Tree Care', website: 'zilkertree.com' });
    assert.equal((await candidates(ctx.workspaceId)).length, 0, 'archived records are not matched');
    await assert.rejects(companies.restore(ctx, a.id, a.version), ConflictError);
    const restored = await companies.restore(ctx, a.id, archived.version);
    assert.equal(restored.status, 'ACTIVE');
    assert.equal((await candidates(ctx.workspaceId)).length, 1, 'restoring re-checks for duplicates');
  });

  test('contact points: archive keeps history, re-adding restores the same row; people: no duplicate at one company', async () => {
    const ctx = await newWorkspace();
    const co = await companies.create(ctx, { displayName: 'Mueller Masonry' });
    const { person, employment } = await people.addToCompany(ctx, co.id, { firstName: 'Sam', lastName: 'Ortiz', title: 'Founder' });
    await assert.rejects(people.addToCompany(ctx, co.id, { fullName: 'sam ortiz' }), (e) => e instanceof ConflictError && e.code === 'ALREADY_EXISTS');

    const email = await contacts.add(ctx, { entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: 'sam@muellermasonry.com', isPrimary: true });
    const second = await contacts.add(ctx, { entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: 'sam.ortiz@gmail.com' });
    await contacts.makePrimary(ctx, second.id);
    assert.equal((await prisma.client.contactPoint.findUniqueOrThrow({ where: { id: email.id } })).isPrimary, false);
    await contacts.archive(ctx, email.id);
    const again = await contacts.add(ctx, { entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: 'Sam@MuellerMasonry.com' });
    assert.equal(again.id, email.id, 'same row restored');
    assert.equal(again.status, 'UNVERIFIED', 'never shown as verified without a verification');

    await people.endEmployment(ctx, employment.id);
    await assert.rejects(people.endEmployment(ctx, employment.id), BusinessRuleError);
    const updated = await people.update(ctx, person.id, person.version, { lastName: 'Ortiz-Reyes' });
    assert.equal(updated.fullName, 'Sam Ortiz-Reyes');
    await assert.rejects(people.update(ctx, person.id, person.version, { timezone: 'America/Chicago' }), ConflictError);

    const view = await query.overview(ctx.workspaceId, co.id, ALL);
    assert.equal(view.people[0]?.isCurrent, false, 'employment history kept after it ends');
    assert.equal(view.quality.currentPeople, 0);
  });

  test('Company 360 overview answers: who, where from, who works there, how to reach, what we know, how fresh', async () => {
    const ctx = await newWorkspace();
    const co = await companies.create(ctx, { ...GREENSCAPE, industry: 'Landscaping' });
    const { person } = await people.addToCompany(ctx, co.id, { fullName: 'Maria Lopez', title: 'Owner', seniority: 'OWNER' });
    await contacts.add(ctx, { entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: 'maria@greenscape-atx.com', isPrimary: true });
    await observe(ctx, co.id, 'employee_range', '11-50', 'About page', 200);

    const v = await query.overview(ctx.workspaceId, co.id, new Set(['company.read']));
    assert.equal(v.company.displayName, 'GreenScape Landscaping LLC'); // who
    assert.equal(v.company.createdBy?.name, 'Owner'); // where from (record origin)
    assert.equal(v.sources[0]?.source, 'About page'); // where from (evidence)
    assert.equal(v.people[0]?.person.fullName, 'Maria Lopez'); // who works there
    assert.equal(v.people[0]?.contactPoints[0]?.status, 'UNVERIFIED'); // how to reach (honestly)
    assert.equal(v.facts[0]?.evidence[0]?.sourceName, 'About page'); // what we know + evidence
    assert.equal(v.facts[0]?.freshness, 'STALE'); // how fresh
    assert.deepEqual(Object.values(v.allowedActions).filter(Boolean), [], 'read-only users get no actions');
  });

  describe('HTTP + permissions', () => {
    let app: INestApplication;
    let base: string;
    let workspaceId: string;
    const PASSWORD = 'green lawns in austin';
    const emails: Record<string, string> = {};
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
      fetch(`${base}/api/v1${path}`, { ...init, headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...(init.cookie ? { cookie: init.cookie } : {}) } });
    const login = async (role: string) => {
      const res = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: emails[role], password: PASSWORD }) });
      assert.equal(res.status, 200);
      return res.headers.get('set-cookie')!.split(';')[0]!;
    };
    const json = async (res: Response) => ((await res.json()) as { data: any }).data;

    before(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
      app = moduleRef.createNestApplication({ logger: false });
      configureApp(app);
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');

      const workspaces = new WorkspaceService(prisma);
      for (const r of ['owner', 'viewer', 'sales', 'researcher']) emails[r] = `${uniqueSlug(r)}@example.com`;
      const ws = await workspaces.createWorkspace(SYSTEM_ACTOR, { name: 'CRM HTTP', slug: uniqueSlug('crmhttp'), owner: { email: emails.owner!, name: 'Owner' } });
      workspaceId = ws.workspace.id;
      for (const [r, role] of [['viewer', 'VIEWER'], ['sales', 'SALES'], ['researcher', 'RESEARCHER']] as const) {
        await workspaces.addMember({ workspaceId, actor: SYSTEM_ACTOR }, { email: emails[r]!, name: r, role });
      }
      await prisma.client.user.updateMany({ where: { email: { in: Object.values(emails) } }, data: { passwordHash: await hashPassword(PASSWORD), status: 'ACTIVE' } });
      await prisma.client.workspaceMember.updateMany({ where: { workspaceId }, data: { status: 'ACTIVE' } });
    });

    after(async () => app.close());

    test('create → preview duplicates → review → merge, with role checks at every step', async () => {
      const viewer = await login('viewer');
      const sales = await login('sales');
      const researcher = await login('researcher');
      const body = JSON.stringify({ displayName: 'Barton Springs Pools', website: 'bartonpools.com', phone: '512 555 0144', city: 'Austin' });

      assert.equal((await call('/companies', { method: 'POST', cookie: viewer, body })).status, 403);
      const created = await call('/companies', { method: 'POST', cookie: sales, body });
      assert.equal(created.status, 201);
      const first = (await json(created)).company;
      assert.equal((await call('/companies', { method: 'POST', cookie: sales, body: JSON.stringify({ displayName: 'X', status: 'CUSTOMER' }) })).status, 400, 'no mass-assignment of status');

      const preview = await json(await call('/companies/check-duplicates', { method: 'POST', cookie: viewer, body: JSON.stringify({ displayName: 'Barton Springs Pools Inc', website: 'www.bartonpools.com' }) }));
      assert.equal(preview[0].company.id, first.id);
      assert.equal(await prisma.client.company.count({ where: { workspaceId } }), 1, 'preview writes nothing');

      const second = await json(await call('/companies', { method: 'POST', cookie: sales, body: JSON.stringify({ displayName: 'Barton Springs Pools', website: 'bartonpools.com' }) }));
      assert.equal(second.openDuplicates, 1);

      const list = await json(await call('/companies?limit=1', { cookie: viewer }));
      assert.equal(list.items.length, 1);
      assert.equal(list.hasMore, true);
      const page2 = await json(await call(`/companies?limit=1&cursor=${list.nextCursor}`, { cookie: viewer }));
      assert.notEqual(page2.items[0].id, list.items[0].id);
      assert.equal(list.items[0].openDuplicates, 1);

      const queue = await json(await call('/duplicates', { cookie: viewer }));
      assert.equal(queue.openCount, 1);
      const cand = queue.items[0];
      const mergeBody = JSON.stringify({ targetId: first.id, version: cand.version });
      assert.equal((await call(`/duplicates/${cand.id}/merge`, { method: 'POST', cookie: sales, body: mergeBody })).status, 403, 'sales cannot merge');
      const merged = await call(`/duplicates/${cand.id}/merge`, { method: 'POST', cookie: researcher, body: mergeBody });
      assert.equal(merged.status, 201);
      assert.equal((await call(`/duplicates/${cand.id}/merge`, { method: 'POST', cookie: researcher, body: mergeBody })).status, 422);

      const view = await json(await call(`/companies/${second.company.id}`, { cookie: viewer }));
      assert.equal(view.mergedInto.id, first.id);
      const stale = await call(`/companies/${first.id}`, { method: 'PATCH', cookie: sales, body: JSON.stringify({ version: first.version, industry: 'Pools' }) });
      assert.equal(stale.status, 409, 'merge bumped the version — stale edit refused');

      const obs = await call(`/companies/${first.id}/observations`, {
        method: 'POST',
        cookie: sales,
        body: JSON.stringify({ field: 'employee_range', value: '1-10', source: { sourceType: 'WEBSITE', observedAt: new Date().toISOString() } }),
      });
      assert.equal(obs.status, 403, 'sales cannot record evidence');
      const ok = await call(`/companies/${first.id}/observations`, {
        method: 'POST',
        cookie: researcher,
        body: JSON.stringify({ field: 'employee_range', value: '1-10', source: { sourceType: 'WEBSITE', sourceUrl: 'https://bartonpools.com/about', observedAt: new Date().toISOString() } }),
      });
      assert.equal(ok.status, 201);
      assert.equal((await json(ok)).outcome, 'CREATED');
      const activity = await json(await call(`/companies/${first.id}/activity`, { cookie: viewer }));
      assert.ok(activity.items.some((i: { action: string }) => i.action === 'company.merged'));
    });
  });
});
