import type { Company, ConfidenceLevel, DiscoveryObservation, Market, ObservationOutcome } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import { providerDefinition } from '@revenue-os/providers';
import { industryLabel, isSharedHost, normalizeCompanyName, normalizeDomain, normalizePhone, type CompanyMatchRecord } from '@revenue-os/shared';
import { writeAudit, type ServiceContext, type Tx } from '../context.js';
import { createCompanyTx, syncCompanyAliases } from '../crm/company-records.js';
import { detectCompanyDuplicates, findCompanyMatches, lockMatchKeys } from '../crm/entity-resolution.js';
import { recordEvidenceTx, recordFactTx } from '../evidence/evidence.js';

/** Calling codes for numbers listed without one (normalizePhone's default is North America). */
const CALLING_CODE: Record<string, string> = { US: '1', CA: '1', GB: '44', AU: '61', PK: '92' };

/** Company columns a discovery observation may fill — only when empty, never overwriting (docs/06 §31-40). */
const FILLABLE = ['websiteDomain', 'phone', 'addressLine', 'city', 'region', 'postalCode', 'country', 'industry'] as const;
type Fillable = (typeof FILLABLE)[number];
const MATCH_COLUMNS = new Set<Fillable>(['websiteDomain', 'phone', 'addressLine', 'city', 'region', 'postalCode', 'country']);

export type ObservationResolution =
  | { status: 'REJECTED'; reason: string }
  | { status: 'RESOLVED'; outcome: ObservationOutcome; companyId: string; evidenceId: string; flaggedForReview: boolean };

/** What an observation says about a business, normalized the way canonical companies are. */
export function normalizeObservation(o: Pick<DiscoveryObservation, 'name' | 'domain' | 'phone' | 'addressLine' | 'city' | 'region' | 'postalCode' | 'country'>, marketCountry: string) {
  const name = o.name.trim();
  const domain = o.domain ? normalizeDomain(o.domain) : null;
  const country = (o.country ?? marketCountry).trim().toUpperCase();
  const code = CALLING_CODE[country];
  const rawPhone = o.phone?.trim() ?? '';
  const phone = !rawPhone ? null : code ? normalizePhone(rawPhone, code) : rawPhone.startsWith('+') ? normalizePhone(rawPhone) : null;
  return {
    name,
    normalizedName: normalizeCompanyName(name),
    // A Facebook page or listing site is not the business's website.
    websiteDomain: domain && !isSharedHost(domain) ? domain : null,
    phone,
    addressLine: o.addressLine?.trim() || null,
    city: o.city?.trim() || null,
    region: o.region?.trim() || null,
    postalCode: o.postalCode?.trim() || null,
    country,
  };
}

/**
 * Observation → canonical company (docs/17 §46-51, docs/07 entity resolution, contract "RESOLVING"). Runs inside the
 * caller's transaction, one observation per transaction:
 * 1. normalize, and reject what has no usable name or lies outside the market's territory;
 * 2. a known ExternalEntityMapping wins (following merges);
 * 3. else blocking + scoring: a HIGH match attaches to the existing company, anything weaker creates a new company
 *    whose likely duplicates become review candidates (never a blind merge);
 * 4. empty fields are filled (never overwritten), the listing becomes Evidence with Facts citing it;
 * 5. outcome CREATED / MATCHED_EXISTING / DUPLICATE_LISTING (another listing of a business this mission already found).
 * The observation row is claimed with a guarded update, so a concurrent resolver can't resolve it twice.
 */
export async function resolveObservationTx(tx: Tx, ctx: ServiceContext, observation: DiscoveryObservation, market: Pick<Market, 'country' | 'city' | 'industry'>): Promise<ObservationResolution> {
  const n = normalizeObservation(observation, market.country);
  const reject = async (reason: string): Promise<ObservationResolution> => {
    await claim(tx, observation.id, { status: 'REJECTED', rejectReason: reason, resolvedAt: new Date() });
    return { status: 'REJECTED', reason };
  };
  if (!n.normalizedName) return reject('No usable business name');
  if (n.country !== market.country.toUpperCase()) return reject(`Outside the market (country ${n.country})`);
  if (market.city && n.city && n.city.toLowerCase() !== market.city.trim().toLowerCase()) return reject(`Outside the market (city ${n.city})`);

  const record: CompanyMatchRecord = { normalizedName: n.normalizedName, websiteDomain: n.websiteDomain, phone: n.phone, addressLine: n.addressLine, city: n.city, region: n.region, country: n.country, postalCode: n.postalCode };
  const industry = industryLabel(market.industry);
  let company: Company | null = null;
  let created = false;
  let flaggedForReview = false;
  let matchScore: number | null = null;
  let matchConfidence: ConfidenceLevel | null = null;

  // 2. This exact listing was seen before (any mission) → the company it was resolved to, or the one that absorbed it.
  const mapping = await tx.externalEntityMapping.findUnique({
    where: { workspaceId_provider_entityType_externalId: { workspaceId: ctx.workspaceId, provider: observation.provider, entityType: 'COMPANY', externalId: observation.sourceRecordId } },
  });
  if (mapping) {
    company = await canonical(tx, ctx.workspaceId, mapping.entityId);
    // A listing id is only trusted while it still describes the same place — a source that reuses ids (or a
    // business that moved) goes through normal matching instead of being glued to a company elsewhere.
    const differs = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() !== b.trim().toLowerCase();
    if (company && (differs(company.country, n.country) || differs(company.city, n.city))) company = null;
    if (company) matchConfidence = 'HIGH';
  }

  // 3. Blocking keys + deterministic scoring. Only HIGH attaches; everything else is a new record (+ review candidates).
  if (!company) {
    await lockMatchKeys(tx, ctx.workspaceId, record);
    const [best] = await findCompanyMatches(tx, ctx.workspaceId, record);
    if (best?.match.confidence === 'HIGH') {
      company = best.company;
      matchScore = best.match.score;
      matchConfidence = 'HIGH';
    } else {
      const result = await createCompanyTx(
        tx,
        ctx,
        {
          displayName: n.name,
          website: n.websiteDomain ?? undefined,
          phone: n.phone ?? undefined,
          addressLine: n.addressLine ?? undefined,
          city: n.city ?? undefined,
          region: n.region ?? undefined,
          postalCode: n.postalCode ?? undefined,
          country: n.country,
          industry,
        },
        { aliasSource: `discovery:${observation.provider}` },
      );
      flaggedForReview = result.detection.candidates.some((c) => c.candidate.status === 'NEEDS_REVIEW');
      if (best) {
        matchScore = best.match.score;
        matchConfidence = best.match.confidence;
      }
      // A safe system auto-merge folded the new record into an existing company: that one is the business.
      company = result.company.mergedIntoId ? await canonical(tx, ctx.workspaceId, result.company.id) : result.company;
      created = !result.company.mergedIntoId;
    }
  }
  if (!company) throw new Error(`Observation ${observation.id}: company could not be resolved`);

  // 4. Fill empty fields only, remember the names/numbers this source uses, and keep the provenance.
  // (A company created just now already has this listing's name/website/phone as aliases.)
  if (!created) {
    await fillEmptyFields(tx, ctx, company, { ...n, industry }, observation.provider);
    await syncCompanyAliases(
      tx,
      ctx.workspaceId,
      company.id,
      { displayName: n.name, website: n.websiteDomain ?? undefined, phone: n.phone ?? undefined },
      { displayName: n.name, normalizedName: n.normalizedName, websiteDomain: n.websiteDomain, phone: n.phone },
      `discovery:${observation.provider}`,
    );
  }
  const mappingKey = { workspaceId: ctx.workspaceId, provider: observation.provider, entityType: 'COMPANY' as const, externalId: observation.sourceRecordId };
  await tx.externalEntityMapping.upsert({
    where: { workspaceId_provider_entityType_externalId: mappingKey },
    create: { ...mappingKey, entityId: company.id, firstSeenAt: observation.observedAt, lastSeenAt: observation.observedAt },
    update: { entityId: company.id, lastSeenAt: observation.observedAt },
  });

  const address = [n.addressLine, n.city, n.region, n.postalCode].filter(Boolean).join(', ');
  const evidence = await recordEvidenceTx(tx, ctx, {
    entityType: 'COMPANY',
    entityId: company.id,
    evidenceType: 'LISTING',
    sourceType: 'LEAD_SOURCE',
    sourceName: providerDefinition(observation.provider)?.name ?? observation.provider,
    provider: observation.provider,
    observedAt: observation.observedAt,
    contentExcerpt: [n.name, n.phone, address, n.websiteDomain].filter(Boolean).join(' · '),
    confidence: 'MEDIUM',
  });
  // Same value as a known fact → CONFIRMED; a different value → CONFLICTED (e.g. an old phone number) — intended.
  const facts: [string, string | null][] = [
    ['website', n.websiteDomain],
    ['phone', n.phone],
    ['address', address || null],
    ['category', observation.category?.trim() || null],
  ];
  for (const [field, value] of facts) {
    if (value) {
      await recordFactTx(tx, ctx, { entityType: 'COMPANY', entityId: company.id, factType: 'PROFILE', field, value, evidenceIds: [evidence.id], confidence: 'MEDIUM' }, { verifiedEvidence: [evidence] });
    }
  }

  // 5. Another listing of a business this mission already resolved (directly or via a record merged into it)?
  const seen = created
    ? []
    : await tx.$queryRaw<{ id: string }[]>`
        SELECT o.id FROM "DiscoveryObservation" o LEFT JOIN "Company" c ON c.id = o."companyId"
        WHERE o."missionId" = ${observation.missionId}::uuid AND o.status = 'RESOLVED' AND o.id <> ${observation.id}::uuid
          AND (o."companyId" = ${company.id}::uuid OR c."mergedIntoId" = ${company.id}::uuid)
        LIMIT 1`;
  const outcome: ObservationOutcome = seen.length ? 'DUPLICATE_LISTING' : created ? 'CREATED' : 'MATCHED_EXISTING';

  await claim(tx, observation.id, {
    status: 'RESOLVED',
    outcome,
    companyId: company.id,
    evidenceId: evidence.id,
    matchScore,
    matchConfidence,
    flaggedForReview,
    resolvedAt: new Date(),
  });
  if (outcome !== 'DUPLICATE_LISTING') {
    await recordEvent(tx, ctx, 'CompanyDiscovered', company.id, { companyId: company.id, missionId: observation.missionId, observationId: observation.id, provider: observation.provider, outcome });
  }
  return { status: 'RESOLVED', outcome, companyId: company.id, evidenceId: evidence.id, flaggedForReview };
}

/** Thrown (rolling the transaction back) when another resolver already settled the observation. */
export class ObservationAlreadyResolvedError extends Error {
  constructor(id: string) {
    super(`Observation ${id} was already resolved`);
    this.name = 'ObservationAlreadyResolvedError';
  }
}

async function claim(tx: Tx, id: string, data: Parameters<Tx['discoveryObservation']['updateMany']>[0]['data']) {
  const { count } = await tx.discoveryObservation.updateMany({ where: { id, status: 'PENDING' }, data });
  if (count === 0) throw new ObservationAlreadyResolvedError(id);
}

/** The surviving company for an id (merges point at the survivor; a short chain is followed). */
async function canonical(tx: Tx, workspaceId: string, id: string): Promise<Company | null> {
  let company = await tx.company.findFirst({ where: { id, workspaceId } });
  for (let hops = 0; company?.mergedIntoId && hops < 5; hops++) company = await tx.company.findFirst({ where: { id: company.mergedIntoId, workspaceId } });
  return company && !company.mergedIntoId ? company : null;
}

async function fillEmptyFields(tx: Tx, ctx: ServiceContext, company: Company, values: Record<Fillable, string | null>, provider: string) {
  const data: Partial<Record<Fillable, string>> = {};
  for (const field of FILLABLE) {
    const value = values[field];
    if (value && !company[field]?.trim()) data[field] = value;
  }
  const changed = Object.keys(data) as Fillable[];
  if (changed.length === 0) return;
  const after = await tx.company.update({ where: { id: company.id }, data: { ...data, version: { increment: 1 } } });
  await writeAudit(tx, ctx, { action: 'company.filled_from_discovery', entityType: 'COMPANY', entityId: company.id, before: pick(company, changed), after: pick(after, changed), reason: `Empty fields filled from ${provider}` });
  await recordEvent(tx, ctx, 'CompanyUpdated', company.id, { companyId: company.id, version: after.version, changedFields: changed });
  // A newly known website/phone/address can reveal a duplicate — surface it for review (never auto-merge here).
  if (changed.some((f) => MATCH_COLUMNS.has(f))) await detectCompanyDuplicates(tx, ctx, company.id, { autoMerge: false });
}

function pick(c: Company, fields: Fillable[]) {
  return Object.fromEntries(fields.map((f) => [f, c[f]]));
}
