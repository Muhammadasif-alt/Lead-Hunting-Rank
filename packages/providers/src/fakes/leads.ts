import { ProviderCallError } from '../core/errors.js';
import type { CallOptions, CapabilityCheck, CompanyObservation, CompanySearchInput, CompanySearchPage, LeadDiscoveryProvider } from '../core/interfaces.js';
import { FailureQueue, seededRandom, type FakeFailure } from './failures.js';

const PREFIXES = ['Lone Star', 'Hill Country', 'Capitol', 'Riverside', 'Bluebonnet', 'Oak Hollow', 'Summit', 'Cedar Park', 'Pecan Street', 'Evergreen', 'Brightline', 'Northside', 'Golden Gate', 'Prairie', 'Harbor'];
const SUFFIXES = ['Co.', 'Group', 'Pros', 'Services', 'Experts', 'Works', 'Partners', '& Sons', 'Studio', 'Solutions'];
const STREETS = ['Main St', 'Oak Ave', 'Congress Ave', 'Lamar Blvd', 'Elm St', 'Market St', 'Park Rd', '2nd St'];

/**
 * A lead source with fictional but repeatable businesses for any location + industry (same query → same results).
 * It mimics what real sources do so later phases can be tested honestly: a finite result set (`size` per market),
 * pagination, roughly 1 in 4 businesses without a website, and some records repeated with slightly different names
 * (what entity resolution has to merge). Fields use this vendor's own naming in `raw`; observations are canonical.
 */
export class FakeLeadProvider implements LeadDiscoveryProvider {
  readonly key = 'fake_leads';
  readonly searchMetadata = { countries: ['US', 'GB', 'CA', 'AU', 'PK'], maxPageSize: 50, geoPrecision: 'CITY' as const };
  private readonly failures = new FailureQueue();

  constructor(private readonly marketSize = (input: CompanySearchInput) => 40 + Math.floor(seededRandom(marketKey(input))() * 80)) {}

  failNext(...failures: FakeFailure[]): this {
    this.failures.push(...failures);
    return this;
  }

  async healthCheck(): Promise<CapabilityCheck[]> {
    return [{ capability: 'COMPANY_SEARCH', ok: true, detail: 'Search reachable (test lead source)' }];
  }

  async searchCompanies(input: CompanySearchInput, { signal }: CallOptions): Promise<CompanySearchPage> {
    await this.failures.before(signal);
    if (!this.searchMetadata.countries.includes(input.location.country)) {
      throw new ProviderCallError('INVALID_REQUEST', `Fake lead source: country ${input.location.country} not covered`);
    }
    if (!input.industry.trim()) throw new ProviderCallError('INVALID_REQUEST', 'Fake lead source: industry is required');
    const pageSize = Math.min(input.pageSize ?? 20, this.searchMetadata.maxPageSize);
    const offset = input.cursor ? Number(input.cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new ProviderCallError('INVALID_REQUEST', 'Fake lead source: bad cursor');

    const total = this.marketSize(input);
    const observedAt = new Date().toISOString();
    const observations: CompanyObservation[] = [];
    for (let i = offset; i < Math.min(offset + pageSize, total); i++) observations.push(this.record(input, i, observedAt));
    const next = offset + pageSize;
    return { observations, nextCursor: next < total ? String(next) : null, units: observations.length };
  }

  private record(input: CompanySearchInput, index: number, observedAt: string): CompanyObservation {
    // Every 7th record re-lists an earlier business under a variant name — a duplicate to resolve.
    const base = index % 7 === 6 ? index - 3 : index;
    const rand = seededRandom(`${marketKey(input)}:${base}`);
    const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!;
    const industry = titleCase(input.industry.trim());
    const prefix = pick(PREFIXES);
    const suffix = pick(SUFFIXES);
    const name = index === base ? `${prefix} ${industry} ${suffix}` : `${prefix} ${industry}`;
    const slug = `${prefix} ${industry}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const hasWebsite = rand() > 0.25;
    const phone = `+1 512 555 ${String(1000 + Math.floor(rand() * 8999)).padStart(4, '0')}`;
    const street = `${100 + Math.floor(rand() * 9800)} ${pick(STREETS)}`;
    const city = input.location.city ?? 'Unknown';
    const raw = {
      business_title: name,
      web: hasWebsite ? `https://www.${slug}.example` : null,
      tel: phone,
      addr: { street, town: city, state: input.location.region ?? null, country: input.location.country },
      vertical: input.industry,
      listing_id: `fl-${base}-${index}`,
    };
    return {
      sourceRecordId: raw.listing_id,
      name,
      domain: hasWebsite ? `${slug}.example` : null,
      phone,
      address: { line1: street, city, region: input.location.region, country: input.location.country },
      category: industry,
      observedAt,
      raw,
    };
  }
}

function marketKey(input: CompanySearchInput): string {
  const l = input.location;
  return [l.country, l.region ?? '', l.city ?? '', input.industry, input.query ?? ''].map((s) => s.trim().toLowerCase()).join('|');
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
