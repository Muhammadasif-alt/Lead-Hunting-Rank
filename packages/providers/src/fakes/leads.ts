import { industryLabel, industryRoot, relatedCategories } from '@revenue-os/shared';
import { ProviderCallError } from '../core/errors.js';
import type { CallOptions, CapabilityCheck, CompanyObservation, CompanySearchInput, CompanySearchPage, LeadDiscoveryProvider } from '../core/interfaces.js';
import { FailureQueue, seededRandom, type FakeFailure } from './failures.js';

const PREFIXES = [
  'Lone Star', 'Hill Country', 'Capitol', 'Riverside', 'Bluebonnet', 'Oak Hollow', 'Summit', 'Cedar Park', 'Pecan Street', 'Evergreen',
  'Brightline', 'Northside', 'Golden Gate', 'Prairie', 'Harbor', 'Red Oak', 'Silver Creek', 'Maple Leaf', 'Stonebridge', 'Willow Bend',
  'True North', 'Blue Sky', 'Heritage', 'Pioneer', 'Sunrise', 'Iron Horse', 'Granite', 'Copper Ridge', 'Live Oak', 'Mesa Verde',
];
const SUFFIXES = ['Co.', 'Group', 'Pros', 'Services', 'Experts', 'Works', 'Partners', '& Sons', 'Studio', 'Solutions'];
const STREETS: [short: string, long: string][] = [
  ['Main St', 'Main Street'], ['Oak Ave', 'Oak Avenue'], ['Congress Ave', 'Congress Avenue'], ['Lamar Blvd', 'Lamar Boulevard'],
  ['Elm St', 'Elm Street'], ['Market St', 'Market Street'], ['Park Rd', 'Park Road'], ['Cedar Dr', 'Cedar Drive'], ['Mill Ln', 'Mill Lane'],
];

/** One business in the fictional market — what every fake source lists in its own way. */
interface WorldBusiness {
  index: number;
  name: string;
  /** The name without its suffix, as a second listing might show it. */
  shortName: string;
  slug: string;
  hasWebsite: boolean;
  phone: string;
  /** An older number some listings still show — a real-world source of conflicting facts. */
  altPhone: string;
  street: [string, string];
  houseNumber: number;
  postalCode: string | null;
  /** Categories the business is listed under: the market's main category and/or related ones. */
  tags: string[];
}

const worlds = new Map<string, WorldBusiness[]>();

/** The same place + industry always yields the same businesses, so every fake source describes one consistent market. */
function marketWorld(location: CompanySearchInput['location'], root: string): WorldBusiness[] {
  const key = ['world', location.country, location.region ?? '', location.city ?? '', root].map((s) => s.trim().toLowerCase()).join('|');
  const cached = worlds.get(key);
  if (cached) return cached;

  const rand = seededRandom(key);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!;
  const noun = industryLabel(root);
  const related = relatedCategories(root);
  const area = 200 + Math.floor(rand() * 700);
  const size = 60 + Math.floor(rand() * 90);
  const names = new Set<string>();
  const businesses: WorldBusiness[] = [];
  for (let index = 0; index < size; index++) {
    let prefix = pick(PREFIXES);
    let suffix = pick(SUFFIXES);
    for (let tries = 0; names.has(`${prefix}|${suffix}`) && tries < 20; tries++) [prefix, suffix] = [pick(PREFIXES), pick(SUFFIXES)];
    names.add(`${prefix}|${suffix}`);
    const tags = [rand() < 0.75 ? root : null, ...related.map((c) => (rand() < 0.22 ? c : null))].filter((t): t is string => t !== null);
    if (tags.length === 0) tags.push(related.length ? pick(related) : root);
    const number = (n: number) => `+1 ${area} 555 ${String(n).padStart(4, '0')}`;
    businesses.push({
      index,
      name: `${prefix} ${noun} ${suffix}`,
      shortName: `${prefix} ${noun}`,
      slug: `${prefix}${noun}${suffix}`.toLowerCase().replace(/[^a-z0-9]+/g, ''),
      hasWebsite: rand() > 0.25,
      phone: number(1000 + index * 37 + Math.floor(rand() * 30)),
      altPhone: number(9000 - index * 13),
      street: pick(STREETS),
      houseNumber: 100 + Math.floor(rand() * 9800),
      postalCode: location.country === 'US' ? String(70000 + Math.floor(rand() * 9999)).padStart(5, '0') : null,
      tags,
    });
  }
  worlds.set(key, businesses);
  return businesses;
}

interface ListingSourceConfig {
  key: string;
  /** Share of the market this source knows about at all. */
  coverage: number;
  /** Most results one query can return (real search APIs cap results — why many query variations are needed). */
  resultCap: number;
  maxPageSize: number;
  toObservation(b: WorldBusiness, input: CompanySearchInput, term: string, observedAt: string, variant: boolean): CompanyObservation;
  /** Extra listing of the same business under a slightly different name (only some sources have these). */
  duplicates?: (b: WorldBusiness) => boolean;
}

/**
 * A lead source with fictional but repeatable businesses for any location + industry. Several sources share one
 * underlying market (each knows part of it), so the behaviour real discovery depends on can be tested honestly:
 * finite results per query, pagination, query-dependent ranking, about 1 in 4 businesses without a website,
 * duplicate listings, and the same business described differently by different sources. Vendor field names stay
 * in `raw`; observations are canonical.
 */
class FakeListingSource implements LeadDiscoveryProvider {
  readonly searchMetadata;
  private readonly failures = new FailureQueue();

  constructor(private readonly config: ListingSourceConfig) {
    this.searchMetadata = { countries: ['US', 'GB', 'CA', 'AU', 'PK'], maxPageSize: config.maxPageSize, geoPrecision: 'CITY' as const };
  }

  get key() {
    return this.config.key;
  }

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

    const results = this.results(input);
    const observedAt = new Date().toISOString();
    const term = input.industry.trim().toLowerCase();
    const observations = results.slice(offset, offset + pageSize).map((r) => this.config.toObservation(r.business, input, term, observedAt, r.variant));
    const next = offset + pageSize;
    return { observations, nextCursor: next < results.length ? String(next) : null, units: observations.length };
  }

  /** Everything this source returns for one query, in its ranking order. */
  private results(input: CompanySearchInput) {
    const term = input.industry.trim().toLowerCase();
    const root = industryRoot(term);
    const query = input.query?.trim().toLowerCase() ?? '';
    const score = (b: WorldBusiness, salt: string) => seededRandom(`${this.config.key}|${salt}|${b.index}`)();
    const ranked = marketWorld(input.location, root)
      .filter((b) => score(b, 'coverage') < this.config.coverage && b.tags.includes(term === root ? root : term))
      // A keyword narrows the results, and every query ranks them differently.
      .filter((b) => !query || score(b, `kw:${query}`) < 0.65)
      .sort((a, b) => score(a, `rank:${term}:${query}`) - score(b, `rank:${term}:${query}`))
      .slice(0, this.config.resultCap);
    return ranked.flatMap((business) => [{ business, variant: false }, ...(this.config.duplicates?.(business) ? [{ business, variant: true }] : [])]);
  }
}

/** Maps-style source: knows most of the market, re-lists some businesses under a shorter name. */
export class FakeLeadProvider extends FakeListingSource {
  constructor() {
    super({
      key: 'fake_leads',
      coverage: 0.85,
      resultCap: 45,
      maxPageSize: 50,
      duplicates: (b) => b.index % 11 === 5,
      toObservation(b, input, term, observedAt, variant) {
        const name = variant ? b.shortName : b.name;
        const raw = {
          business_title: name,
          web: b.hasWebsite ? `https://www.${b.slug}.example` : null,
          tel: b.phone,
          addr: { street: `${b.houseNumber} ${b.street[0]}`, town: input.location.city ?? null, state: input.location.region ?? null, zip: b.postalCode, country: input.location.country },
          vertical: term,
          listing_id: `fl-${b.index}${variant ? '-b' : ''}`,
        };
        return {
          sourceRecordId: raw.listing_id,
          name,
          domain: b.hasWebsite ? `${b.slug}.example` : null,
          phone: b.phone,
          address: { line1: raw.addr.street, city: input.location.city, region: input.location.region, postalCode: b.postalCode ?? undefined, country: input.location.country },
          category: industryLabel(term),
          observedAt,
          raw,
        };
      },
    });
  }
}

/** Directory-style source: smaller, formats names/phones/addresses its own way and sometimes shows an old number. */
export class FakeDirectoryProvider extends FakeListingSource {
  constructor() {
    super({
      key: 'fake_directory',
      coverage: 0.6,
      resultCap: 30,
      maxPageSize: 25,
      toObservation(b, input, term, observedAt) {
        const r = seededRandom(`dir|${b.index}|${b.slug}`);
        const llc = r() < 0.4;
        const oldNumber = r() < 0.08;
        const suite = r() < 0.05;
        const digits = (oldNumber ? b.altPhone : b.phone).replace(/\D/g, '').slice(1);
        const phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
        const raw = {
          name: llc ? `${b.name.replace(/ Co\.$/, '')}, LLC` : b.name,
          website_url: b.hasWebsite ? `http://${b.slug}.example/` : null,
          phone_number: phone,
          location: {
            address1: `${b.houseNumber} ${b.street[1]}${suite ? ' Suite 200' : ''}`,
            city: input.location.city ?? null,
            state_code: input.location.region ?? null,
            postal_code: b.postalCode,
            country_code: input.location.country,
          },
          categories: b.tags.map((t) => industryLabel(t)),
          directory_id: `bd-${b.index}`,
          searched_for: term,
        };
        return {
          sourceRecordId: raw.directory_id,
          name: raw.name,
          domain: b.hasWebsite ? `${b.slug}.example` : null,
          phone,
          address: { line1: raw.location.address1, city: input.location.city, region: input.location.region, postalCode: b.postalCode ?? undefined, country: input.location.country },
          category: raw.categories[0] ?? industryLabel(term),
          observedAt,
          raw,
        };
      },
    });
  }
}
