import { createHash } from 'node:crypto';
import type { Company, ConfidenceLevel, Evidence, Prisma, PrismaClient, ResearchRun, ResearchRunStatus } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import type { Capability, FetchedPage, ProviderErrorKind, ProviderGateway } from '@revenue-os/providers';
import {
  analyzePage,
  AUDIT_VERSION,
  auditWebsite,
  deriveHypotheses,
  describeError,
  normalizeEmail,
  normalizePhone,
  RateLimitedError,
  RESEARCH_FRESH_DAYS,
  type AnalyzedPage,
  type AuditCheck,
  type HypothesisDraft,
  type PageType,
  type PersonMention,
  type ResearchStep,
  type WebsiteAuditResult,
} from '@revenue-os/shared';
import { writeAudit, type ServiceContext, type Tx } from '../context.js';
import { recordEvidenceTx, recordFactTx } from '../evidence/evidence.js';

export interface ResearchDeps {
  db: PrismaClient;
  gateway: ProviderGateway;
  /** Lease owner identity, e.g. `${hostname}:${pid}`. */
  workerId: string;
  now?: () => Date;
}

export interface ResearchJob {
  workspaceId: string;
  companyId: string;
  runId?: string;
  trigger: 'DISCOVERY' | 'MANUAL';
  missionId?: string;
}

export interface ResearchResult {
  runId: string | null;
  outcome: 'RAN' | 'SKIPPED';
  reason?: 'NOT_FOUND' | 'INACTIVE' | 'ALREADY_RUNNING' | 'FRESH' | 'NOT_RUNNABLE';
  status?: ResearchRunStatus;
}

export const RESEARCH_LEASE_MS = 5 * 60_000;
/** Most emails verified per run — verification can cost money (docs/12 §42-44). */
const MAX_VERIFICATIONS = 5;
/** A verification younger than this is not repeated. */
const VERIFICATION_FRESH_DAYS = 30;
const VERIFICATION_VALID_DAYS = 90;
const HYPOTHESIS_TTL_DAYS = 180;
const TX = { timeout: 30_000, maxWait: 10_000 } as const;
const WAIT_KINDS: ReadonlySet<ProviderErrorKind> = new Set(['RATE_LIMITED', 'QUOTA_EXCEEDED', 'UNAVAILABLE', 'TRANSIENT', 'UNKNOWN_OUTCOME']);
export const ACTIVE_RESEARCH_STATES: ResearchRunStatus[] = ['QUEUED', 'RUNNING', 'WAITING'];

const research = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'SYSTEM', id: null } });
const days = (n: number) => n * 86_400_000;
const kindOf = (err: unknown) => (err as { providerErrorKind?: ProviderErrorKind }).providerErrorKind;

/**
 * Researches one company (docs/17 §52-57): reads its official website (home, contact, about), stores snapshots as
 * evidence, runs deterministic checks, records technology, social profiles, published contacts and named people,
 * verifies published emails, and proposes opportunity hypotheses that cite the evidence. Never guesses an email,
 * never turns a hypothesis into a fact, never lets page text instruct anything.
 *
 * Idempotent: re-running confirms facts instead of duplicating them; contact points, people, technologies and social
 * profiles are matched to what exists. One run per company at a time (lease); automatic research skips companies
 * researched in the last RESEARCH_FRESH_DAYS.
 */
export async function runResearchJob(deps: ResearchDeps, job: ResearchJob): Promise<ResearchResult> {
  const run = await claimRun(deps, job);
  if ('reason' in run) return { runId: run.runId ?? null, outcome: 'SKIPPED', reason: run.reason };
  try {
    const status = await new Researcher(deps, run.run).execute();
    return { runId: run.run.id, outcome: 'RAN', status };
  } catch (err) {
    // Deferred (rate limit / outage): hand the run back so the retried job can claim it again.
    await deps.db.researchRun.updateMany({
      where: { id: run.run.id, leaseOwner: deps.workerId, status: 'RUNNING' },
      data: { status: 'QUEUED', error: describeError(err).slice(0, 500), leaseOwner: null, leaseUntil: null },
    });
    throw err;
  }
}

/** Settles the company's unfinished run as FAILED after the job's final attempt. */
export async function failResearch(db: PrismaClient, job: Pick<ResearchJob, 'workspaceId' | 'companyId' | 'runId'>, reason: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const run = await tx.researchRun.findFirst({
      where: { workspaceId: job.workspaceId, companyId: job.companyId, ...(job.runId ? { id: job.runId } : {}), status: { in: ACTIVE_RESEARCH_STATES } },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) return false;
    const error = reason.slice(0, 500);
    await tx.researchRun.update({ where: { id: run.id }, data: { status: 'FAILED', error, completedAt: new Date(), leaseOwner: null, leaseUntil: null, version: { increment: 1 } } });
    const ctx = research(run.workspaceId);
    await writeAudit(tx, ctx, { action: 'research_run.failed', entityType: 'RESEARCH_RUN', entityId: run.id, before: { status: run.status }, after: { status: 'FAILED' }, reason: error });
    await recordEvent(tx, ctx, 'ResearchRunFailed', run.id, { runId: run.id, companyId: run.companyId, reason: error });
    return true;
  });
}

type Claim = { run: ResearchRun } | { reason: NonNullable<ResearchResult['reason']>; runId?: string };

async function claimRun(deps: ResearchDeps, job: ResearchJob): Promise<Claim> {
  const now = deps.now?.() ?? new Date();
  const lease = { leaseOwner: deps.workerId, leaseUntil: new Date(now.getTime() + RESEARCH_LEASE_MS) };
  const claimable = (id: string) => ({
    id,
    workspaceId: job.workspaceId,
    OR: [
      { status: 'QUEUED' as const, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      { status: 'RUNNING' as const, OR: [{ leaseUntil: { lt: now } }, { leaseOwner: deps.workerId }] },
    ],
  });
  const start = async (run: ResearchRun) => {
    const { count } = await deps.db.researchRun.updateMany({ where: claimable(run.id), data: { status: 'RUNNING', ...lease, startedAt: run.startedAt ?? now, error: null } });
    if (count === 0) return null;
    return deps.db.researchRun.findUniqueOrThrow({ where: { id: run.id } });
  };

  if (job.runId) {
    const run = await deps.db.researchRun.findFirst({ where: { id: job.runId, workspaceId: job.workspaceId } });
    if (!run) return { reason: 'NOT_FOUND' };
    const claimed = await start(run);
    return claimed ? { run: claimed } : { reason: 'NOT_RUNNABLE', runId: run.id };
  }

  // Automatic research: decide under a per-company lock so many listings of one business start one run.
  return deps.db.$transaction(async (tx): Promise<Claim> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`research:${job.companyId}`}))`;
    const company = await tx.company.findFirst({ where: { id: job.companyId, workspaceId: job.workspaceId }, select: { id: true, status: true, mergedIntoId: true } });
    if (!company) return { reason: 'NOT_FOUND' };
    if (company.mergedIntoId || company.status === 'ARCHIVED' || company.status === 'DISQUALIFIED') return { reason: 'INACTIVE' };
    const active = await tx.researchRun.findFirst({ where: { workspaceId: job.workspaceId, companyId: job.companyId, status: { in: ACTIVE_RESEARCH_STATES } }, orderBy: { createdAt: 'desc' } });
    if (active) {
      // A run this job created earlier and handed back after a provider said "not now" — continue it.
      const { count } = await tx.researchRun.updateMany({ where: claimable(active.id), data: { status: 'RUNNING', ...lease, error: null } });
      return count ? { run: await tx.researchRun.findUniqueOrThrow({ where: { id: active.id } }) } : { reason: 'ALREADY_RUNNING', runId: active.id };
    }
    const recent = await tx.researchRun.findFirst({
      where: { workspaceId: job.workspaceId, companyId: job.companyId, status: { in: ['COMPLETED', 'PARTIAL'] }, completedAt: { gte: new Date(now.getTime() - days(RESEARCH_FRESH_DAYS)) } },
      select: { id: true },
    });
    if (recent) return { reason: 'FRESH', runId: recent.id };
    const run = await tx.researchRun.create({
      data: { workspaceId: job.workspaceId, companyId: job.companyId, trigger: job.trigger, missionId: job.missionId ?? null, status: 'RUNNING', ...lease, startedAt: now },
    });
    const ctx = research(job.workspaceId);
    await writeAudit(tx, ctx, { action: 'research_run.started', entityType: 'RESEARCH_RUN', entityId: run.id, after: { companyId: run.companyId, trigger: run.trigger, missionId: run.missionId } });
    await recordEvent(tx, ctx, 'ResearchRunStarted', run.id, { runId: run.id, companyId: run.companyId, trigger: run.trigger });
    return { run };
  });
}

interface Page extends AnalyzedPage {
  fetched: FetchedPage;
  evidence: Evidence;
}

class Researcher {
  private readonly ctx: ServiceContext;
  private readonly steps: ResearchStep[] = [];
  private readonly gaps: string[] = [];
  private provider: string | null = null;

  constructor(
    private readonly deps: ResearchDeps,
    private readonly run: ResearchRun,
  ) {
    this.ctx = research(run.workspaceId);
  }

  private get db() {
    return this.deps.db;
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private step(key: ResearchStep['key'], status: ResearchStep['status'], detail: string) {
    this.steps.push({ key, status, detail });
  }

  private hasIntegration(capability: Capability) {
    return this.db.integration
      .count({ where: { workspaceId: this.run.workspaceId, capabilities: { has: capability }, status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] } } })
      .then((n) => n > 0);
  }

  async execute(): Promise<ResearchRunStatus> {
    const company = await this.db.company.findUniqueOrThrow({ where: { id: this.run.companyId } });
    let pages: Page[] = [];
    let audit: WebsiteAuditResult | null = null;
    let unreachable: { reason: string; evidence: Evidence } | null = null;
    let websiteId: string | null = null;

    if (!company.websiteDomain) {
      this.step('website', 'SKIPPED', 'No website on record for this business');
    } else if (!(await this.hasIntegration('WEBSITE_FETCH'))) {
      this.step('website', 'SKIPPED', 'No website reader connected');
      this.gaps.push('No website reader connected — connect one in Integrations to check the website');
    } else {
      const read = await this.readWebsite(company);
      websiteId = read.websiteId;
      pages = read.pages;
      unreachable = read.unreachable;
      if (pages.length) audit = await this.recordAudit(company, websiteId, pages);
    }

    if (audit && pages.length) {
      await this.recordTechnology(company, pages);
      await this.recordSocial(company, pages, audit);
      await this.recordContacts(company, audit);
      await this.recordPeople(company, pages);
    }
    // Every unverified email of the company and its people — new from the website or recorded earlier.
    await this.verify(await this.unverifiedEmails(company.id));

    const hypotheses = await this.recordHypotheses(company, { pages, audit, unreachable });
    return this.finish(hypotheses);
  }

  // ───────────────────────────── website ─────────────────────────────

  private async fetch(url: string): Promise<FetchedPage> {
    try {
      const { value, provider } = await this.deps.gateway.call(
        { workspaceId: this.run.workspaceId, capability: 'WEBSITE_FETCH', operation: 'fetch_page', entity: { type: 'COMPANY', id: this.run.companyId } },
        (adapter, options) => adapter.fetchPage(url, options),
      );
      this.provider = provider;
      return value;
    } catch (err) {
      const kind = kindOf(err);
      // "Not now": the job retries with backoff; the run goes back to QUEUED and nothing is lost.
      if (kind && WAIT_KINDS.has(kind)) throw new RateLimitedError(`Website reader: ${describeError(err)}`, (err as { retryAfterMs?: number }).retryAfterMs);
      if (!kind) throw err;
      // The reader refused this URL (e.g. it points into a private network): a fact about the URL, not a crash.
      const at = new Date().toISOString();
      return { requestedUrl: url, finalUrl: url, status: 0, contentType: null, body: '', bytes: 0, truncated: false, fetchedAt: at, redirects: [], failure: 'BLOCKED', failureDetail: describeError(err) };
    }
  }

  private async readWebsite(company: Company): Promise<{ websiteId: string; pages: Page[]; unreachable: { reason: string; evidence: Evidence } | null }> {
    const domain = company.websiteDomain!;
    let home = await this.fetch(`https://${domain}/`);
    if (home.failure === 'UNREACHABLE' || home.failure === 'TIMEOUT') {
      const plain = await this.fetch(`http://${domain}/`);
      if (!plain.failure) home = plain;
    }
    const website = await this.db.website.upsert({
      where: { workspaceId_companyId_domain: { workspaceId: this.run.workspaceId, companyId: company.id, domain } },
      create: { workspaceId: this.run.workspaceId, companyId: company.id, domain, url: `https://${domain}/` },
      update: {},
    });

    if (home.failure) {
      const reason = home.failureDetail ?? home.failure.toLowerCase();
      const evidence = await this.db.$transaction(async (tx) => {
        await tx.website.update({ where: { id: website.id }, data: { status: 'UNREACHABLE', statusReason: reason, lastCheckedAt: new Date(home.fetchedAt) } });
        const ev = await recordEvidenceTx(tx, this.ctx, {
          entityType: 'COMPANY',
          entityId: company.id,
          evidenceType: 'WEBSITE_CHECK',
          sourceType: 'WEBSITE',
          sourceName: domain,
          sourceUrl: home.requestedUrl,
          provider: this.provider ?? undefined,
          observedAt: new Date(home.fetchedAt),
          contentExcerpt: `Could not load ${home.requestedUrl}: ${reason}`,
          confidence: 'LOW',
        });
        await recordFactTx(tx, this.ctx, { entityType: 'COMPANY', entityId: company.id, factType: 'WEBSITE', field: 'website.loads', value: false, evidenceIds: [ev.id], confidence: 'LOW', supersede: true }, { verifiedEvidence: [ev] });
        return ev;
      }, TX);
      this.step('website', 'FAILED', `The website did not load: ${reason}`);
      this.gaps.push('The website could not be loaded — checks, contacts and people from the website are missing');
      return { websiteId: website.id, pages: [], unreachable: { reason, evidence } };
    }

    const pages: Page[] = [await this.storePage(company, website.id, 'HOME', home)];
    const links = pages[0]!.analysis.links;
    for (const [pageType, link] of [
      ['CONTACT', links.contact],
      ['ABOUT', links.about],
    ] as const) {
      if (!link) continue;
      const page = await this.fetch(link);
      if (!page.failure) pages.push(await this.storePage(company, website.id, pageType, page));
    }
    await this.db.website.update({
      where: { id: website.id },
      data: { status: 'LIVE', statusReason: null, finalUrl: home.finalUrl, lastCheckedAt: new Date(home.fetchedAt) },
    });
    this.step('website', 'DONE', `Read ${pages.length} page(s): ${pages.map((p) => p.pageType.toLowerCase()).join(', ')}`);
    return { websiteId: website.id, pages, unreachable: null };
  }

  /** Snapshot + evidence for one page (docs/12 §52): URL, time, content hash and the relevant text — not the page. */
  private async storePage(company: Company, websiteId: string, pageType: PageType, fetched: FetchedPage): Promise<Page> {
    const analysis = analyzePage(fetched.body, fetched.finalUrl);
    const fetchedAt = new Date(fetched.fetchedAt);
    const excerpt = [analysis.title, analysis.description, analysis.text.slice(0, 600)].filter(Boolean).join(' — ').slice(0, 900);
    const evidence = await this.db.$transaction(async (tx) => {
      const ev = await recordEvidenceTx(tx, this.ctx, {
        entityType: 'COMPANY',
        entityId: company.id,
        evidenceType: 'WEBSITE_PAGE',
        sourceType: 'WEBSITE',
        sourceName: company.websiteDomain ?? undefined,
        sourceUrl: fetched.finalUrl,
        provider: this.provider ?? undefined,
        observedAt: fetchedAt,
        contentExcerpt: excerpt,
        confidence: 'HIGH',
      });
      await tx.websiteSnapshot.create({
        data: {
          workspaceId: this.run.workspaceId,
          websiteId,
          researchRunId: this.run.id,
          evidenceId: ev.id,
          pageType,
          url: fetched.requestedUrl,
          finalUrl: fetched.finalUrl,
          httpStatus: fetched.status,
          contentType: fetched.contentType,
          contentHash: createHash('sha256').update(fetched.body).digest('hex'),
          byteSize: fetched.bytes,
          truncated: fetched.truncated,
          title: analysis.title,
          metadata: {
            description: analysis.description,
            language: analysis.language,
            generator: analysis.generator,
            redirects: fetched.redirects,
            untrustedInstructions: analysis.untrustedInstructions,
          },
          textExcerpt: analysis.text.slice(0, 2000),
          auditVersion: AUDIT_VERSION,
          fetchedAt,
        },
      });
      return ev;
    }, TX);
    return { pageType, url: fetched.requestedUrl, finalUrl: fetched.finalUrl, analysis, fetched, evidence };
  }

  private evidenceFor(pages: Page[], url: string | null): Evidence {
    return (url && pages.find((p) => p.finalUrl === url)?.evidence) || pages[0]!.evidence;
  }

  /** Deterministic checks → WebsiteAudit + facts with the page that shows each one (docs/08 §25-27). */
  private async recordAudit(company: Company, websiteId: string, pages: Page[]): Promise<WebsiteAuditResult> {
    const audit = auditWebsite(pages, this.now());
    const facts: [AuditCheck, string, boolean | number | null][] = [
      ['ssl', 'website.https', audit.hasSsl],
      ['mobile', 'website.mobile_viewport', audit.mobileReady],
      ['contact_form', 'website.contact_form', audit.hasContactForm],
      ['booking', 'website.online_booking', audit.hasBooking],
      ['chat', 'website.live_chat', audit.hasChat],
      ['cta', 'website.call_to_action', audit.hasClearCta],
      ['freshness', 'website.copyright_year', audit.copyrightYear],
    ];
    await this.db.$transaction(async (tx) => {
      const row = await tx.websiteAudit.create({
        data: {
          workspaceId: this.run.workspaceId,
          websiteId,
          companyId: company.id,
          researchRunId: this.run.id,
          auditVersion: AUDIT_VERSION,
          status: pages.length >= 2 ? 'COMPLETE' : 'PARTIAL',
          performedAt: this.now(),
          hasSsl: audit.hasSsl,
          mobileReady: audit.mobileReady,
          hasContactForm: audit.hasContactForm,
          hasBooking: audit.hasBooking,
          hasChat: audit.hasChat,
          hasClearCta: audit.hasClearCta,
          copyrightYear: audit.copyrightYear,
          technologySummary: audit.technologies.map((t) => t.name),
          findings: audit.findings as unknown as Prisma.InputJsonValue,
          overallConfidence: audit.confidence,
        },
      });
      const all = pages.map((p) => p.evidence);
      await recordFactTx(tx, this.ctx, { entityType: 'COMPANY', entityId: company.id, factType: 'WEBSITE', field: 'website.loads', value: true, evidenceIds: [pages[0]!.evidence.id], confidence: 'HIGH', supersede: true }, { verifiedEvidence: all });
      for (const [check, field, value] of facts) {
        if (value === null) continue;
        const finding = audit.findings.find((f) => f.key === check)!;
        // "Not found" is backed by every page we read; "found" by the page that shows it.
        const evidence = finding.observed ? [this.evidenceFor(pages, finding.url)] : all;
        // A later scan of the official site is a newer observation of the same source: it supersedes, history stays.
        await recordFactTx(
          tx,
          this.ctx,
          { entityType: 'COMPANY', entityId: company.id, factType: 'WEBSITE', field, value, evidenceIds: evidence.map((e) => e.id), confidence: audit.confidence, supersede: true },
          { verifiedEvidence: all },
        );
      }
      await writeAudit(tx, this.ctx, { action: 'website.audited', entityType: 'WEBSITE', entityId: websiteId, after: { auditId: row.id, auditVersion: AUDIT_VERSION, findings: audit.findings.map((f) => [f.key, f.observed]) } });
      await recordEvent(tx, this.ctx, 'WebsiteAudited', websiteId, { websiteId, companyId: company.id, auditId: row.id, auditVersion: AUDIT_VERSION, status: row.status });
    }, TX);
    const seen = audit.findings.filter((f) => f.observed !== null).length;
    this.step('audit', 'DONE', `${seen} checks recorded from ${pages.length} page(s)`);
    if (audit.untrustedInstructions) this.step('audit', 'DONE', 'A page contains text addressed to bots — kept as untrusted data, nothing followed');
    return audit;
  }

  private async recordTechnology(company: Company, pages: Page[]) {
    const now = this.now();
    const detected = new Map<string, { name: string; category: string; evidence: Evidence }>();
    for (const p of pages) for (const t of p.analysis.technologies) if (!detected.has(t.key)) detected.set(t.key, { name: t.name, category: t.category, evidence: p.evidence });
    await this.db.$transaction(async (tx) => {
      const seenIds: string[] = [];
      for (const [key, t] of detected) {
        const tech = await tx.technology.upsert({ where: { key }, create: { key, name: t.name, category: t.category }, update: {} });
        seenIds.push(tech.id);
        await tx.companyTechnology.upsert({
          where: { workspaceId_companyId_technologyId: { workspaceId: this.run.workspaceId, companyId: company.id, technologyId: tech.id } },
          create: { workspaceId: this.run.workspaceId, companyId: company.id, technologyId: tech.id, evidenceId: t.evidence.id, confidence: 'HIGH', firstDetectedAt: now, lastDetectedAt: now },
          update: { evidenceId: t.evidence.id, lastDetectedAt: now, goneAt: null },
        });
      }
      // No longer on the site (e.g. moved off a platform): kept with goneAt, not deleted.
      await tx.companyTechnology.updateMany({ where: { workspaceId: this.run.workspaceId, companyId: company.id, technologyId: { notIn: seenIds }, goneAt: null }, data: { goneAt: now } });
    }, TX);
    this.step('technology', 'DONE', detected.size ? [...detected.values()].map((t) => t.name).join(', ') : 'No known technology detected');
  }

  private async recordSocial(company: Company, pages: Page[], audit: WebsiteAuditResult) {
    const now = this.now();
    await this.db.$transaction(async (tx) => {
      const seen: string[] = [];
      for (const s of audit.socialLinks) {
        const page = pages.find((p) => p.analysis.socialLinks.some((x) => x.url === s.url)) ?? pages[0]!;
        const row = await tx.socialProfile.upsert({
          where: { workspaceId_companyId_platform_profileUrl: { workspaceId: this.run.workspaceId, companyId: company.id, platform: s.platform, profileUrl: s.url } },
          // Linked from the official website: a strong but not certain match (docs/12 §53).
          create: { workspaceId: this.run.workspaceId, companyId: company.id, platform: s.platform, profileUrl: s.url, handle: s.handle, matchConfidence: 'HIGH', evidenceId: page.evidence.id, firstSeenAt: now, lastCheckedAt: now },
          update: { status: 'ACTIVE', handle: s.handle, evidenceId: page.evidence.id, lastCheckedAt: now },
        });
        seen.push(row.id);
      }
      await tx.socialProfile.updateMany({ where: { workspaceId: this.run.workspaceId, companyId: company.id, id: { notIn: seen }, status: 'ACTIVE' }, data: { status: 'GONE', lastCheckedAt: now } });
    }, TX);
    this.step('social', 'DONE', audit.socialLinks.length ? audit.socialLinks.map((s) => s.platform).join(', ') : 'No social profiles linked from the website');
  }

  /**
   * Company emails and phones the website publishes → UNVERIFIED contact points. Nothing is guessed; a contact point
   * a person removed earlier is not brought back.
   */
  private async recordContacts(company: Company, audit: WebsiteAuditResult): Promise<void> {
    const personal = new Set(audit.people.map((p) => p.email).filter(Boolean));
    const emails = audit.emails.filter((e) => !personal.has(e));
    let added = 0;
    for (const raw of emails) {
      const cp = await this.ensureContactPoint('COMPANY', company.id, 'EMAIL', raw, 'From website');
      if (cp?.created) added++;
    }
    const companyPhone = normalizePhone(company.phone ?? '');
    for (const raw of audit.phones) {
      if (normalizePhone(raw) === companyPhone) continue;
      const id = await this.ensureContactPoint('COMPANY', company.id, 'BUSINESS_PHONE', raw, 'From website');
      if (id?.created) added++;
    }
    const total = emails.length + audit.phones.length;
    this.step('contacts', 'DONE', total ? `${total} published on the website (${added} new)` : 'The website publishes no email or phone link');
    if (emails.length === 0 && audit.people.every((p) => !p.email)) this.gaps.push('No email address published on the website');
  }

  private async ensureContactPoint(entityType: 'COMPANY' | 'PERSON', entityId: string, type: 'EMAIL' | 'BUSINESS_PHONE', value: string, label: string): Promise<{ id: string; created: boolean } | null> {
    const normalizedValue = type === 'EMAIL' ? normalizeEmail(value) : normalizePhone(value);
    if (!normalizedValue) return null;
    return this.db.$transaction(async (tx) => {
      const existing = await tx.contactPoint.findFirst({ where: { workspaceId: this.run.workspaceId, entityType, entityId, type, normalizedValue } });
      if (existing) return existing.archivedAt ? null : { id: existing.id, created: false };
      const cp = await tx.contactPoint.create({
        data: { workspaceId: this.run.workspaceId, entityType, entityId, type, value: value.trim(), normalizedValue, label, confidence: 'MEDIUM' },
      });
      await writeAudit(tx, this.ctx, { action: 'contact_point.added', entityType: 'CONTACT_POINT', entityId: cp.id, after: cp, reason: 'Published on the company website' });
      await recordEvent(tx, this.ctx, 'ContactPointAdded', cp.id, { contactPointId: cp.id, entityType, entityId, type });
      return { id: cp.id, created: true };
    }, TX);
  }

  /**
   * People the website names with a role → Person + Employment (LOW confidence, unverified) with the page as evidence
   * (docs/17 §52-57 "Person candidate → Employment evidence → Role relevance → Contact candidate → Verification").
   */
  private async recordPeople(company: Company, pages: Page[]): Promise<void> {
    const mentions: { mention: PersonMention; page: Page }[] = [];
    for (const page of pages) for (const mention of page.analysis.people) if (!mentions.some((m) => m.mention.name.toLowerCase() === mention.name.toLowerCase())) mentions.push({ mention, page });
    let created = 0;
    for (const { mention, page } of mentions) {
      const personId = await this.db.$transaction(async (tx) => {
        const existing = await tx.employment.findFirst({
          where: { workspaceId: this.run.workspaceId, companyId: company.id, person: { fullName: { equals: mention.name, mode: 'insensitive' } } },
          select: { personId: true },
        });
        let id = existing?.personId;
        if (!id) {
          const [firstName, ...rest] = mention.name.split(' ');
          const person = await tx.person.create({ data: { workspaceId: this.run.workspaceId, firstName: firstName ?? null, lastName: rest.join(' ') || null, fullName: mention.name } });
          await writeAudit(tx, this.ctx, { action: 'person.created', entityType: 'PERSON', entityId: person.id, after: person, reason: `Named on ${page.finalUrl}` });
          await recordEvent(tx, this.ctx, 'PersonCreated', person.id, { personId: person.id });
          // What the page claims, not a verified role: LOW confidence, no verifiedAt.
          const employment = await tx.employment.create({
            data: { workspaceId: this.run.workspaceId, personId: person.id, companyId: company.id, title: mention.title, isCurrent: true, confidence: 'LOW' },
          });
          await writeAudit(tx, this.ctx, { action: 'employment.attached', entityType: 'EMPLOYMENT', entityId: employment.id, after: employment, reason: `Named on ${page.finalUrl}` });
          await recordEvent(tx, this.ctx, 'EmploymentAttached', employment.id, { employmentId: employment.id, personId: person.id, companyId: company.id });
          id = person.id;
          created++;
        }
        const ev = await recordEvidenceTx(tx, this.ctx, {
          entityType: 'PERSON',
          entityId: id,
          evidenceType: 'WEBSITE_MENTION',
          sourceType: 'WEBSITE',
          sourceName: company.websiteDomain ?? undefined,
          sourceUrl: page.finalUrl,
          provider: this.provider ?? undefined,
          observedAt: new Date(page.fetched.fetchedAt),
          contentExcerpt: mention.excerpt,
          confidence: 'LOW',
        });
        await recordFactTx(
          tx,
          this.ctx,
          { entityType: 'PERSON', entityId: id, factType: 'EMPLOYMENT', field: 'role', value: { companyId: company.id, title: mention.title }, evidenceIds: [ev.id], confidence: 'LOW' },
          { verifiedEvidence: [ev] },
        );
        return id;
      }, TX);
      if (mention.email) await this.ensureContactPoint('PERSON', personId, 'EMAIL', mention.email, 'From website');
    }
    this.step('people', mentions.length ? 'DONE' : 'SKIPPED', mentions.length ? `${mentions.map((m) => `${m.mention.name} (${m.mention.title})`).join(', ')} — ${created} new` : 'The website names no owner or manager');
    if (!mentions.length) this.gaps.push('No decision maker named on the website');
  }

  private async unverifiedEmails(companyId: string): Promise<string[]> {
    const people = await this.db.employment.findMany({ where: { workspaceId: this.run.workspaceId, companyId, isCurrent: true }, select: { personId: true } });
    const rows = await this.db.contactPoint.findMany({
      where: {
        workspaceId: this.run.workspaceId,
        type: 'EMAIL',
        archivedAt: null,
        status: 'UNVERIFIED',
        OR: [{ entityType: 'COMPANY', entityId: companyId }, { entityType: 'PERSON', entityId: { in: people.map((p) => p.personId) } }],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Published emails → verification provider → ContactVerification (docs/12 §45-47). VALID ≠ allowed to contact. */
  private async verify(contactPointIds: string[]) {
    const since = new Date(this.now().getTime() - days(VERIFICATION_FRESH_DAYS));
    const due = await this.db.contactPoint.findMany({
      where: { id: { in: contactPointIds }, archivedAt: null, type: 'EMAIL', verifications: { none: { verifiedAt: { gte: since } } } },
      orderBy: { createdAt: 'asc' },
      take: MAX_VERIFICATIONS,
    });
    if (due.length === 0) {
      this.step('verification', 'SKIPPED', contactPointIds.length ? 'Emails were verified recently' : 'No email to verify');
      return;
    }
    if (!(await this.hasIntegration('EMAIL_VERIFY'))) {
      this.step('verification', 'SKIPPED', 'No email verifier connected');
      this.gaps.push(`${due.length} email(s) not verified — connect an email verifier in Integrations`);
      return;
    }
    const counts = new Map<string, number>();
    for (const cp of due) {
      let result;
      let provider = '';
      try {
        const r = await this.deps.gateway.call(
          { workspaceId: this.run.workspaceId, capability: 'EMAIL_VERIFY', operation: 'verify_email', entity: { type: 'CONTACT_POINT', id: cp.id } },
          (adapter, options) => adapter.verifyEmail(cp.normalizedValue, options),
        );
        result = r.value;
        provider = r.provider;
      } catch (err) {
        const kind = kindOf(err);
        if (kind && WAIT_KINDS.has(kind)) {
          this.gaps.push(`Email verifier is not answering right now (${describeError(err)}) — some emails stay unverified`);
          break;
        }
        if (!kind) throw err;
        continue; // this address can't be checked (e.g. rejected as malformed); the others still can
      }
      const verifiedAt = new Date(result.checkedAt);
      await this.db.$transaction(async (tx) => {
        await tx.contactVerification.create({
          data: {
            workspaceId: this.run.workspaceId,
            contactPointId: cp.id,
            provider,
            status: result.status,
            verifiedAt,
            expiresAt: new Date(verifiedAt.getTime() + days(VERIFICATION_VALID_DAYS)),
            providerResult: { rawStatus: result.rawStatus },
          },
        });
        const status = result.status === 'VALID' ? 'VERIFIED' : result.status === 'INVALID' ? 'INVALID' : cp.status;
        const confidence: ConfidenceLevel = result.status === 'VALID' ? 'HIGH' : result.status === 'INVALID' ? 'LOW' : cp.confidence;
        await tx.contactPoint.update({ where: { id: cp.id }, data: { status, confidence, lastVerifiedAt: verifiedAt, version: { increment: 1 } } });
        await writeAudit(tx, this.ctx, { action: 'contact_point.verified', entityType: 'CONTACT_POINT', entityId: cp.id, before: { status: cp.status }, after: { status, verification: result.status, provider } });
        await recordEvent(tx, this.ctx, 'ContactPointVerified', cp.id, { contactPointId: cp.id, entityType: cp.entityType, entityId: cp.entityId, status: result.status, provider });
      }, TX);
      counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
    }
    this.step('verification', counts.size ? 'DONE' : 'FAILED', counts.size ? [...counts].map(([s, n]) => `${n} ${s.toLowerCase().replace('_', '-')}`).join(', ') : 'No email could be checked');
  }

  // ───────────────────────────── hypotheses ─────────────────────────────

  /**
   * Rule-based opportunity hypotheses (docs/17 §52-57). Each cites the evidence it rests on; one row per company + kind.
   * A reason that a fresh, complete check no longer sees is invalidated (kept, not deleted). Nothing is concluded from
   * checks that could not run.
   */
  private async recordHypotheses(company: Company, input: { pages: Page[]; audit: WebsiteAuditResult | null; unreachable: { reason: string; evidence: Evidence } | null }): Promise<number> {
    const hasWebsite = !!company.websiteDomain;
    const evaluated = !hasWebsite || input.unreachable !== null || input.audit !== null;
    if (!evaluated) {
      this.step('hypotheses', 'SKIPPED', 'The website was not checked, so no website-based hypothesis');
      return 0;
    }
    const drafts = deriveHypotheses({ hasWebsite, unreachable: input.unreachable, audit: input.audit, now: this.now() });

    let listingEvidence: Evidence[] = [];
    if (!hasWebsite) {
      // "No website" rests on the sources that listed the business without one.
      listingEvidence = await this.db.evidence.findMany({ where: { workspaceId: this.run.workspaceId, entityType: 'COMPANY', entityId: company.id, evidenceType: 'LISTING' }, orderBy: { observedAt: 'desc' }, take: 5 });
    }
    const evidenceFor = (d: HypothesisDraft): Evidence[] => {
      if (d.check === 'website') return input.unreachable ? [input.unreachable.evidence] : listingEvidence;
      const finding = input.audit!.findings.find((f) => f.key === d.check);
      return finding?.observed ? [this.evidenceFor(input.pages, finding.url)] : input.pages.map((p) => p.evidence);
    };

    const now = this.now();
    const keys = new Set<string>();
    let proposed = 0;
    await this.db.$transaction(async (tx) => {
      for (const d of drafts) {
        const evidence = evidenceFor(d);
        if (evidence.length === 0) {
          this.gaps.push(`"${d.hypothesis}" was not proposed: no stored evidence supports it`);
          continue;
        }
        keys.add(d.key);
        const existing = await tx.opportunityHypothesis.findUnique({ where: { workspaceId_companyId_key: { workspaceId: this.run.workspaceId, companyId: company.id, key: d.key } } });
        const fields = { hypothesis: d.hypothesis, reasonSummary: d.reasonSummary, confidence: d.confidence, researchRunId: this.run.id, lastSupportedAt: now, expiresAt: new Date(now.getTime() + days(HYPOTHESIS_TTL_DAYS)) };
        const reopened = !existing || !['ACTIVE', 'SUPPORTED'].includes(existing.status);
        const row = existing
          ? await tx.opportunityHypothesis.update({ where: { id: existing.id }, data: { ...fields, ...(reopened ? { status: 'ACTIVE' as const, generatedAt: now } : {}), version: { increment: 1 } } })
          : await tx.opportunityHypothesis.create({ data: { workspaceId: this.run.workspaceId, companyId: company.id, key: d.key, source: 'RULE', status: 'ACTIVE', generatedAt: now, ...fields } });
        await tx.hypothesisEvidence.createMany({ data: evidence.map((e) => ({ workspaceId: this.run.workspaceId, hypothesisId: row.id, evidenceId: e.id })), skipDuplicates: true });
        if (reopened) {
          proposed++;
          await writeAudit(tx, this.ctx, { action: existing ? 'hypothesis.reactivated' : 'hypothesis.proposed', entityType: 'OPPORTUNITY_HYPOTHESIS', entityId: row.id, after: { key: d.key, hypothesis: d.hypothesis, confidence: d.confidence, evidenceIds: evidence.map((e) => e.id) } });
          await recordEvent(tx, this.ctx, 'OpportunityHypothesisProposed', row.id, { hypothesisId: row.id, companyId: company.id, key: d.key, confidence: d.confidence });
        }
      }
      // Only what this run could judge: an unreachable site says nothing about its booking flow.
      const judged = input.unreachable ? ['WEBSITE_UNREACHABLE', 'NO_WEBSITE'] : null;
      const stale = await tx.opportunityHypothesis.findMany({
        where: { workspaceId: this.run.workspaceId, companyId: company.id, source: 'RULE', status: { in: ['ACTIVE', 'SUPPORTED', 'CANDIDATE'] }, key: { notIn: [...keys], ...(judged ? { in: judged } : {}) } },
      });
      for (const h of stale) {
        const reason = h.key === 'NO_WEBSITE' ? 'A website is now on record' : 'The latest website check no longer shows this';
        await tx.opportunityHypothesis.update({ where: { id: h.id }, data: { status: 'INVALIDATED', researchRunId: this.run.id, version: { increment: 1 } } });
        await writeAudit(tx, this.ctx, { action: 'hypothesis.invalidated', entityType: 'OPPORTUNITY_HYPOTHESIS', entityId: h.id, before: { status: h.status }, after: { status: 'INVALIDATED' }, reason });
        await recordEvent(tx, this.ctx, 'OpportunityHypothesisInvalidated', h.id, { hypothesisId: h.id, companyId: company.id, key: h.key, reason });
      }
    }, TX);
    this.step('hypotheses', 'DONE', keys.size ? `${keys.size} hypothesis(es), ${proposed} new` : 'Nothing observed that suggests a need');
    return keys.size;
  }

  private async finish(hypotheses: number): Promise<ResearchRunStatus> {
    const status: 'COMPLETED' | 'PARTIAL' = this.gaps.length ? 'PARTIAL' : 'COMPLETED';
    const done = this.steps.filter((s) => s.status === 'DONE').length;
    const summary = `${done} of ${new Set(this.steps.map((s) => s.key)).size} steps done · ${hypotheses} hypothesis(es)${this.gaps.length ? ` · ${this.gaps.length} gap(s)` : ''}`;
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.researchRun.updateMany({
        where: { id: this.run.id, leaseOwner: this.deps.workerId, status: 'RUNNING' },
        data: { status, steps: this.steps as unknown as Prisma.InputJsonValue, gaps: this.gaps, summary, error: null, completedAt: this.now(), leaseOwner: null, leaseUntil: null, version: { increment: 1 } },
      });
      if (count === 0) return;
      await writeAudit(tx, this.ctx, { action: 'research_run.completed', entityType: 'RESEARCH_RUN', entityId: this.run.id, after: { status, summary, gaps: this.gaps } });
      await recordEvent(tx, this.ctx, 'ResearchRunCompleted', this.run.id, { runId: this.run.id, companyId: this.run.companyId, status, hypotheses, gaps: this.gaps.length });
    }, TX);
    return status;
  }
}

/** A person asks for research now: one QUEUED run per company; the event schedules the worker (docs/07 outbox). */
export async function requestResearchTx(tx: Tx, ctx: ServiceContext, companyId: string): Promise<{ run: ResearchRun; created: boolean }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`research:${companyId}`}))`;
  const active = await tx.researchRun.findFirst({ where: { workspaceId: ctx.workspaceId, companyId, status: { in: ACTIVE_RESEARCH_STATES } }, orderBy: { createdAt: 'desc' } });
  if (active) return { run: active, created: false };
  const run = await tx.researchRun.create({
    data: { workspaceId: ctx.workspaceId, companyId, trigger: 'MANUAL', status: 'QUEUED', requestedBy: ctx.actor.type === 'HUMAN' ? ctx.actor.id : null },
  });
  await writeAudit(tx, ctx, { action: 'research_run.requested', entityType: 'RESEARCH_RUN', entityId: run.id, after: { companyId, trigger: 'MANUAL' } });
  await recordEvent(tx, ctx, 'ResearchRequested', run.id, { runId: run.id, companyId });
  return { run, created: true };
}
