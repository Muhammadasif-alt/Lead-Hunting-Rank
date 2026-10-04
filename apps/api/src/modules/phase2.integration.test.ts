import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ConflictError, NotFoundError, ValidationError } from '@revenue-os/shared';
import type { PrismaService } from '../infra/prisma.service.js';
import type { ServiceContext } from '../domain/service-context.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../testing/test-db.js';
import { CompanyService } from './crm/company.service.js';
import { ContactPointService } from './crm/contact-point.service.js';
import { PersonService } from './crm/person.service.js';
import { EvidenceService } from './evidence/evidence.service.js';
import { WorkspaceService } from './identity/workspace.service.js';

/** Phase 2 DoD (docs/17 §15-20): workspace → user → company → person → employment → contact → evidence → fact. */
describe('Phase 2 — database foundation through application services', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let workspaces: WorkspaceService, companies: CompanyService, people: PersonService;
  let contacts: ContactPointService, evidence: EvidenceService;
  let ctx: ServiceContext;
  let other: ServiceContext;

  before(async () => {
    ({ prisma, close } = await setupTestDatabase());
    workspaces = new WorkspaceService(prisma);
    companies = new CompanyService(prisma);
    people = new PersonService(prisma);
    contacts = new ContactPointService(prisma);
    evidence = new EvidenceService(prisma);

    const a = await workspaces.createWorkspace(SYSTEM_ACTOR, {
      name: 'Austin Test Co',
      slug: uniqueSlug('austin'),
      owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner One' },
    });
    ctx = { workspaceId: a.workspace.id, actor: { type: 'HUMAN', id: a.ownerUserId } };
    const b = await workspaces.createWorkspace(SYSTEM_ACTOR, {
      name: 'Other Workspace',
      slug: uniqueSlug('other'),
      owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner Two' },
    });
    other = { workspaceId: b.workspace.id, actor: { type: 'HUMAN', id: b.ownerUserId } };
  });

  after(async () => close());

  test('a new workspace gets roles, grants, authority limits, pipeline and hard policies', async () => {
    const db = prisma.client;
    const roles = await db.role.findMany({ where: { workspaceId: ctx.workspaceId }, include: { _count: { select: { permissions: true } } } });
    assert.deepEqual(roles.map((r) => r.key).sort(), ['ADMIN', 'OWNER', 'RESEARCHER', 'SALES', 'VIEWER']);
    const viewer = roles.find((r) => r.key === 'VIEWER')!;
    const owner = roles.find((r) => r.key === 'OWNER')!;
    assert.ok(owner._count.permissions > viewer._count.permissions);

    const sales = roles.find((r) => r.key === 'SALES')!;
    const limit = await db.authorityLimit.findFirst({ where: { roleId: sales.id, key: 'pricing.max_discount_percent' } });
    assert.equal(Number(limit?.maxValue), 5);

    const stages = await db.pipelineStage.count({ where: { workspaceId: ctx.workspaceId } });
    assert.equal(stages, 7);
    const hardRules = await db.policyRule.count({ where: { workspaceId: ctx.workspaceId, isHardRule: true } });
    assert.ok(hardRules >= 5);

    const member = await db.workspaceMember.findFirst({ where: { workspaceId: ctx.workspaceId }, include: { roles: { include: { role: true } } } });
    assert.equal(member?.roles[0]?.role.key, 'OWNER');
  });

  test('duplicate workspace slug is a 409, and members can be added once', async () => {
    const slug = uniqueSlug('dup');
    await workspaces.createWorkspace(SYSTEM_ACTOR, { name: 'Dup', slug, owner: { email: `${slug}@example.com`, name: 'X' } });
    await assert.rejects(
      workspaces.createWorkspace(SYSTEM_ACTOR, { name: 'Dup 2', slug, owner: { email: `${slug}@example.com`, name: 'X' } }),
      ConflictError,
    );
    const email = `${uniqueSlug('sales')}@example.com`;
    const added = await workspaces.addMember(ctx, { email, name: 'Sally Sales', role: 'SALES' });
    assert.ok(added.memberId);
    await assert.rejects(workspaces.addMember(ctx, { email, name: 'Sally', role: 'VIEWER' }), ConflictError);
  });

  test('end-to-end: company → person → employment → contact point → evidence → fact, all audited', async () => {
    const company = await companies.create(ctx, {
      displayName: 'GreenScape Landscaping, LLC',
      website: 'https://www.greenscape-austin.com/',
      phone: '(512) 555-0100',
      city: 'Austin',
      region: 'TX',
      country: 'us',
      industry: 'Landscaping',
    });
    assert.equal(company.normalizedName, 'greenscape landscaping');
    assert.equal(company.websiteDomain, 'greenscape-austin.com');
    assert.equal(company.phone, '+15125550100');
    assert.equal(company.country, 'US');
    assert.equal(company.status, 'DISCOVERED');
    const aliases = await prisma.client.companyAlias.findMany({ where: { companyId: company.id } });
    assert.deepEqual(aliases.map((a) => a.aliasType).sort(), ['DOMAIN', 'NAME', 'PHONE']);

    const person = await people.create(ctx, { firstName: 'John', lastName: 'Smith' });
    assert.equal(person.fullName, 'John Smith');

    const employment = await people.attachEmployment(ctx, { personId: person.id, companyId: company.id, title: 'Owner', seniority: 'OWNER' });
    assert.equal(employment.isCurrent, true);

    const email = await contacts.add(ctx, { entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: ' John@GreenScape-Austin.com ', isPrimary: true });
    assert.equal(email.normalizedValue, 'john@greenscape-austin.com');
    assert.equal(email.status, 'UNVERIFIED', 'new contact points are never verified by default');
    await assert.rejects(
      contacts.add(ctx, { entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: 'john@greenscape-austin.com' }),
      ConflictError,
    );
    const second = await contacts.add(ctx, { entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: 'j.smith@greenscape-austin.com', isPrimary: true });
    const primaries = await prisma.client.contactPoint.count({ where: { entityId: person.id, isPrimary: true } });
    assert.equal(primaries, 1);
    assert.equal(second.isPrimary, true);

    const ev = await evidence.recordEvidence(ctx, {
      entityType: 'COMPANY',
      entityId: company.id,
      evidenceType: 'WEBSITE_PAGE',
      sourceType: 'WEBSITE',
      sourceUrl: 'https://greenscape-austin.com/contact',
      observedAt: new Date('2026-09-30T10:00:00Z'),
      contentExcerpt: 'Call us to schedule — no online booking.',
    });
    assert.ok(ev.contentHash);

    const { fact, outcome } = await evidence.recordFact(ctx, {
      entityType: 'COMPANY',
      entityId: company.id,
      factType: 'WEBSITE_CAPABILITY',
      field: 'has_online_booking',
      value: false,
      evidenceIds: [ev.id],
    });
    assert.equal(outcome, 'CREATED');
    assert.equal(fact.status, 'ACTIVE');
    const links = await prisma.client.factEvidence.count({ where: { factId: fact.id } });
    assert.equal(links, 1);

    const audit = await prisma.client.auditLog.findMany({ where: { workspaceId: ctx.workspaceId }, select: { action: true } });
    const actions = new Set(audit.map((a) => a.action));
    for (const a of ['company.created', 'person.created', 'employment.attached', 'contact_point.added', 'evidence.recorded', 'fact.created']) {
      assert.ok(actions.has(a), `audit has ${a}`);
    }
  });

  test('facts: same value confirms, different value conflicts, explicit correction supersedes', async () => {
    const company = await companies.create(ctx, { displayName: 'Hill Country Yards' });
    const obs = (day: number) =>
      evidence.recordEvidence(ctx, {
        entityType: 'COMPANY',
        entityId: company.id,
        evidenceType: 'LISTING',
        sourceType: 'DIRECTORY',
        observedAt: new Date(Date.UTC(2026, 8, day)),
      });
    const base = { entityType: 'COMPANY' as const, entityId: company.id, factType: 'PROFILE', field: 'employee_range' };

    const e1 = await obs(1);
    const first = await evidence.recordFact(ctx, { ...base, value: '1-10', evidenceIds: [e1.id] });
    const e2 = await obs(5);
    const confirmed = await evidence.recordFact(ctx, { ...base, value: '1-10', evidenceIds: [e2.id] });
    assert.equal(confirmed.outcome, 'CONFIRMED');
    assert.equal(confirmed.fact.id, first.fact.id);
    assert.equal(confirmed.fact.lastConfirmedAt.toISOString(), '2026-09-05T00:00:00.000Z');

    const e3 = await obs(9);
    const conflict = await evidence.recordFact(ctx, { ...base, value: '11-50', evidenceIds: [e3.id] });
    assert.equal(conflict.outcome, 'CONFLICTED');
    const old = await prisma.client.fact.findUniqueOrThrow({ where: { id: first.fact.id } });
    assert.equal(old.status, 'CONFLICTED', 'the old value is flagged, not overwritten');

    const e4 = await obs(12);
    const corrected = await evidence.recordFact(ctx, { ...base, value: '11-50', evidenceIds: [e4.id], supersede: true });
    assert.equal(corrected.outcome, 'SUPERSEDED');
    assert.equal(corrected.fact.status, 'ACTIVE');
    const retired = await prisma.client.fact.findUniqueOrThrow({ where: { id: first.fact.id } });
    assert.equal(retired.status, 'SUPERSEDED');
    assert.equal(retired.supersededById, corrected.fact.id);
  });

  test('facts require evidence about the same entity', async () => {
    const a = await companies.create(ctx, { displayName: 'Alpha Lawns' });
    const b = await companies.create(ctx, { displayName: 'Beta Lawns' });
    const evB = await evidence.recordEvidence(ctx, { entityType: 'COMPANY', entityId: b.id, evidenceType: 'X', sourceType: 'MANUAL', observedAt: new Date() });
    await assert.rejects(
      evidence.recordFact(ctx, { entityType: 'COMPANY', entityId: a.id, factType: 'P', field: 'f', value: 1, evidenceIds: [] }),
      ValidationError,
    );
    await assert.rejects(
      evidence.recordFact(ctx, { entityType: 'COMPANY', entityId: a.id, factType: 'P', field: 'f', value: 1, evidenceIds: [evB.id] }),
      ValidationError,
    );
  });

  test('workspace isolation: another workspace cannot see or link to these records', async () => {
    const company = await companies.create(ctx, { displayName: 'Private Gardens' });
    const person = await people.create(ctx, { fullName: 'Jane Doe' });
    await assert.rejects(companies.get(other, company.id), NotFoundError);
    await assert.rejects(people.attachEmployment(other, { personId: person.id, companyId: company.id }), NotFoundError);
    await assert.rejects(contacts.add(other, { entityType: 'COMPANY', entityId: company.id, type: 'PHONE', value: '512 555 0199' }), NotFoundError);

    // Even bypassing the services, Postgres refuses a cross-workspace employment (composite foreign key).
    const foreignPerson = await people.create(other, { fullName: 'Outsider' });
    await assert.rejects(
      prisma.client.employment.create({ data: { workspaceId: ctx.workspaceId, personId: foreignPerson.id, companyId: company.id } }),
    );
  });

  test('optimistic concurrency: a stale version cannot overwrite', async () => {
    const company = await companies.create(ctx, { displayName: 'Capitol Turf' });
    const updated = await companies.update(ctx, company.id, company.version, { industry: 'Landscaping', website: 'capitolturf.com' });
    assert.equal(updated.version, 2);
    assert.equal(updated.websiteDomain, 'capitolturf.com');
    assert.equal(updated.displayName, 'Capitol Turf');
    await assert.rejects(companies.update(ctx, company.id, company.version, { industry: 'Roofing' }), ConflictError);
  });

  test('validation: bad input is rejected before touching the database', async () => {
    await assert.rejects(companies.create(ctx, { displayName: '  ' }), ValidationError);
    await assert.rejects(companies.create(ctx, { displayName: 'X', website: 'not a site' }), ValidationError);
    await assert.rejects(companies.create(ctx, { displayName: 'X', country: 'USA' }), ValidationError);
    const person = await people.create(ctx, { fullName: 'Val Idate' });
    await assert.rejects(contacts.add(ctx, { entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: 'nope' }), ValidationError);
  });

  test('the audit log is append-only at the database level', async () => {
    const row = await prisma.client.auditLog.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId } });
    await assert.rejects(prisma.client.auditLog.update({ where: { id: row.id }, data: { reason: 'tamper' } }), /append-only/);
    await assert.rejects(prisma.client.auditLog.delete({ where: { id: row.id } }), /append-only/);
  });
});
