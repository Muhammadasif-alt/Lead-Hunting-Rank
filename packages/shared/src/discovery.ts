/**
 * Lead Hunter discovery logic (docs/17 §46-51, docs/03, docs/screens/03). Pure and deterministic — shared by the API
 * (preview), the worker (query planning + coverage assessment) and the browser (interpreting a typed request).
 *
 * Nothing here talks to a provider or claims completeness: coverage is an estimate with its reasons, never
 * "100% of the market".
 */

export type DiscoveryMode = 'QUICK' | 'DEEP' | 'MARKET_EXHAUST';
export type QueryStrategyType = 'PRIMARY_CATEGORY' | 'RELATED_CATEGORY' | 'KEYWORD_VARIANT' | 'GEO_VARIANT';
export type CoverageLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type WebsiteFilter = 'ANY' | 'WITH' | 'WITHOUT';

export interface ModeProfile {
  label: string;
  description: string;
  /** Rounds of search → resolve → measure before the hunt must stop. */
  maxRounds: number;
  /** New queries per connected source in one round. */
  queriesPerRound: number;
  /** Result pages fetched per query before moving on. */
  pageLimit: number;
  maxQueries: number;
  maxProviderCalls: number;
  /** QUICK asks the preferred source only; the deeper modes ask every connected source. */
  sources: 'PRIMARY' | 'ALL';
  strategies: QueryStrategyType[];
}

export const DISCOVERY_MODES: Record<DiscoveryMode, ModeProfile> = {
  QUICK: {
    label: 'Quick Hunt',
    description: 'One round on your preferred source with the main business category — a first look at the market.',
    maxRounds: 1,
    queriesPerRound: 1,
    pageLimit: 2,
    maxQueries: 1,
    maxProviderCalls: 4,
    sources: 'PRIMARY',
    strategies: ['PRIMARY_CATEGORY'],
  },
  DEEP: {
    label: 'Deep Hunt',
    description: 'Up to 3 rounds across every connected source, adding related categories.',
    maxRounds: 3,
    queriesPerRound: 3,
    pageLimit: 4,
    maxQueries: 24,
    maxProviderCalls: 100,
    sources: 'ALL',
    strategies: ['PRIMARY_CATEGORY', 'RELATED_CATEGORY'],
  },
  MARKET_EXHAUST: {
    label: 'Market Exhaust',
    description: 'Keeps trying new categories and query variations on every source until new unique businesses dry up.',
    maxRounds: 8,
    queriesPerRound: 4,
    pageLimit: 10,
    maxQueries: 80,
    maxProviderCalls: 500,
    sources: 'ALL',
    strategies: ['PRIMARY_CATEGORY', 'RELATED_CATEGORY', 'KEYWORD_VARIANT', 'GEO_VARIANT'],
  },
};

// ───────────────────────────── industry taxonomy ─────────────────────────────

export interface IndustryDefinition {
  key: string;
  label: string;
  /** Words people type for it (used to understand a request). */
  synonyms: string[];
  /** Related categories a broader hunt also searches (docs/screens/03 §3). */
  related: string[];
}

export const INDUSTRIES: IndustryDefinition[] = [
  { key: 'landscaping', label: 'Landscaping', synonyms: ['landscaper', 'landscapers', 'landscaping', 'landscape company', 'landscape companies'], related: ['lawn care', 'landscape design', 'irrigation', 'tree service', 'hardscaping', 'outdoor lighting', 'turf installation', 'garden maintenance'] },
  { key: 'roofing', label: 'Roofing', synonyms: ['roofer', 'roofers', 'roofing', 'roofing company', 'roofing companies'], related: ['roof repair', 'roof replacement', 'gutters', 'commercial roofing', 'storm damage restoration'] },
  { key: 'plumbing', label: 'Plumbing', synonyms: ['plumber', 'plumbers', 'plumbing'], related: ['drain cleaning', 'water heater repair', 'leak detection', 'sewer repair', 'emergency plumber'] },
  { key: 'hvac', label: 'HVAC', synonyms: ['hvac', 'air conditioning', 'heating and cooling'], related: ['ac repair', 'heating repair', 'furnace installation', 'duct cleaning', 'heat pump installation'] },
  { key: 'dentists', label: 'Dentists', synonyms: ['dentist', 'dentists', 'dental clinic', 'dental clinics', 'dental office', 'dental offices'], related: ['family dentistry', 'cosmetic dentistry', 'orthodontist', 'pediatric dentist', 'dental implants'] },
  { key: 'electricians', label: 'Electricians', synonyms: ['electrician', 'electricians', 'electrical contractor', 'electrical contractors'], related: ['electrical repair', 'panel upgrade', 'lighting installation', 'ev charger installation', 'generator installation'] },
  { key: 'cleaning', label: 'Cleaning services', synonyms: ['cleaning company', 'cleaning companies', 'cleaning service', 'cleaning services', 'cleaners', 'maid service', 'janitorial'], related: ['house cleaning', 'commercial cleaning', 'carpet cleaning', 'window cleaning', 'move out cleaning'] },
  { key: 'pest control', label: 'Pest control', synonyms: ['pest control', 'exterminator', 'exterminators'], related: ['termite control', 'rodent control', 'mosquito control', 'wildlife removal'] },
  { key: 'salons', label: 'Hair salons', synonyms: ['salon', 'salons', 'hair salon', 'hair salons', 'barber', 'barbers'], related: ['barber shop', 'nail salon', 'hair color', 'day spa'] },
  { key: 'law firms', label: 'Law firms', synonyms: ['lawyer', 'lawyers', 'attorney', 'attorneys', 'law firm', 'law firms'], related: ['personal injury lawyer', 'family lawyer', 'criminal defense lawyer', 'estate planning attorney', 'immigration lawyer'] },
  { key: 'real estate', label: 'Real estate agents', synonyms: ['realtor', 'realtors', 'real estate agent', 'real estate agents', 'real estate'], related: ['real estate broker', 'property management', 'commercial real estate', 'home buyers'] },
  { key: 'contractors', label: 'General contractors', synonyms: ['contractor', 'contractors', 'general contractor', 'general contractors', 'remodeler', 'remodelers'], related: ['home remodeling', 'kitchen remodeling', 'bathroom remodeling', 'home builders', 'handyman'] },
  { key: 'restaurants', label: 'Restaurants', synonyms: ['restaurant', 'restaurants'], related: ['cafe', 'catering', 'food truck', 'bakery'] },
  { key: 'auto repair', label: 'Auto repair', synonyms: ['auto repair', 'mechanic', 'mechanics', 'auto shop', 'auto shops', 'car repair'], related: ['brake repair', 'oil change', 'transmission repair', 'auto body shop', 'tire shop'] },
  { key: 'painting', label: 'Painters', synonyms: ['painter', 'painters', 'painting company', 'painting contractor', 'house painter', 'house painters'], related: ['interior painting', 'exterior painting', 'commercial painting', 'cabinet painting'] },
  { key: 'flooring', label: 'Flooring', synonyms: ['flooring', 'flooring company', 'flooring contractor', 'floor installer', 'floor installers'], related: ['hardwood flooring', 'tile installation', 'carpet installation', 'vinyl flooring', 'floor refinishing'] },
  { key: 'pool service', label: 'Pool services', synonyms: ['pool service', 'pool services', 'pool cleaning', 'pool company', 'pool builder', 'pool builders'], related: ['pool repair', 'pool installation', 'hot tub service', 'pool maintenance'] },
  { key: 'solar', label: 'Solar installers', synonyms: ['solar', 'solar installer', 'solar installers', 'solar company', 'solar companies'], related: ['solar panel installation', 'battery storage', 'solar repair', 'commercial solar'] },
  { key: 'locksmiths', label: 'Locksmiths', synonyms: ['locksmith', 'locksmiths'], related: ['emergency locksmith', 'car locksmith', 'commercial locksmith', 'safe services'] },
  { key: 'garage doors', label: 'Garage door services', synonyms: ['garage door', 'garage doors', 'garage door repair', 'garage door company'], related: ['garage door installation', 'garage door opener repair', 'commercial doors'] },
  { key: 'moving', label: 'Moving companies', synonyms: ['mover', 'movers', 'moving company', 'moving companies', 'removalists', 'removals'], related: ['local movers', 'long distance movers', 'packing services', 'storage'] },
  { key: 'chiropractors', label: 'Chiropractors', synonyms: ['chiropractor', 'chiropractors', 'chiropractic'], related: ['sports chiropractor', 'massage therapy', 'physical therapy'] },
  { key: 'physiotherapy', label: 'Physiotherapists', synonyms: ['physiotherapist', 'physiotherapists', 'physiotherapy', 'physical therapist', 'physical therapists'], related: ['sports physiotherapy', 'rehabilitation clinic', 'massage therapy'] },
  { key: 'med spas', label: 'Med spas', synonyms: ['med spa', 'med spas', 'medical spa', 'aesthetic clinic', 'aesthetic clinics'], related: ['botox', 'laser hair removal', 'skin care clinic', 'cosmetic clinic'] },
  { key: 'veterinarians', label: 'Veterinarians', synonyms: ['vet', 'vets', 'veterinarian', 'veterinarians', 'animal hospital', 'vet clinic'], related: ['emergency vet', 'pet grooming', 'pet boarding', 'dog trainer'] },
  { key: 'gyms', label: 'Gyms & fitness', synonyms: ['gym', 'gyms', 'fitness center', 'fitness centre', 'fitness studio'], related: ['personal trainer', 'yoga studio', 'pilates studio', 'crossfit', 'martial arts'] },
  { key: 'accountants', label: 'Accountants', synonyms: ['accountant', 'accountants', 'accounting firm', 'cpa', 'bookkeeper', 'bookkeepers'], related: ['tax preparation', 'bookkeeping', 'payroll services', 'financial advisor'] },
  { key: 'insurance', label: 'Insurance agents', synonyms: ['insurance agent', 'insurance agents', 'insurance agency', 'insurance broker', 'insurance brokers'], related: ['auto insurance', 'home insurance', 'life insurance', 'business insurance'] },
  { key: 'marketing agencies', label: 'Marketing agencies', synonyms: ['marketing agency', 'marketing agencies', 'digital agency', 'seo agency', 'advertising agency'], related: ['web design', 'seo services', 'social media marketing', 'branding agency'] },
  { key: 'photographers', label: 'Photographers', synonyms: ['photographer', 'photographers', 'photography studio'], related: ['wedding photographer', 'portrait photographer', 'videographer', 'event photographer'] },
  { key: 'florists', label: 'Florists', synonyms: ['florist', 'florists', 'flower shop', 'flower shops'], related: ['wedding flowers', 'flower delivery', 'event decor'] },
  { key: 'hotels', label: 'Hotels', synonyms: ['hotel', 'hotels', 'motel', 'motels', 'guest house', 'bed and breakfast'], related: ['boutique hotel', 'vacation rental', 'hostel', 'resort'] },
  { key: 'car dealers', label: 'Car dealerships', synonyms: ['car dealer', 'car dealers', 'car dealership', 'car dealerships', 'auto dealer'], related: ['used car dealer', 'motorcycle dealer', 'rv dealer', 'car rental'] },
  { key: 'schools', label: 'Schools & tutoring', synonyms: ['school', 'schools', 'tutor', 'tutors', 'tutoring', 'academy'], related: ['driving school', 'music lessons', 'language school', 'daycare'] },
];

const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The taxonomy entry a category belongs to ("irrigation" → landscaping), or null for an unknown category. */
export function findIndustry(term: string): IndustryDefinition | null {
  const t = clean(term);
  if (!t) return null;
  const singular = t.endsWith('s') ? t.slice(0, -1) : t;
  return (
    INDUSTRIES.find((i) => i.key === t || i.label.toLowerCase() === t || i.synonyms.includes(t) || i.synonyms.includes(singular)) ??
    INDUSTRIES.find((i) => i.related.includes(t) || i.related.includes(singular)) ??
    null
  );
}

/** Stable root used to group categories of one market ("lawn care" and "irrigation" both → "landscaping"). */
export function industryRoot(term: string): string {
  return findIndustry(term)?.key ?? clean(term);
}

/** Display label for an industry the user typed: the taxonomy label, else the text in title case. */
export function industryLabel(term: string): string {
  const def = findIndustry(term);
  if (def && (def.key === clean(term) || def.synonyms.includes(clean(term)))) return def.label;
  return clean(term).replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Related categories offered for a market (empty for an industry we don't know yet). */
export function relatedCategories(industry: string): string[] {
  const def = findIndustry(industry);
  if (!def) return [];
  const t = clean(industry);
  return def.key === t || def.synonyms.includes(t) ? def.related : [def.key, ...def.related.filter((r) => r !== t)];
}

// ───────────────────────────── locations ─────────────────────────────

export const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};
const US_CODES = new Set(Object.values(US_STATES));

export const COUNTRIES: { code: string; name: string; aliases: string[] }[] = [
  { code: 'US', name: 'United States', aliases: ['united states', 'usa', 'u.s.', 'america'] },
  { code: 'GB', name: 'United Kingdom', aliases: ['united kingdom', 'uk', 'england', 'britain', 'great britain'] },
  { code: 'CA', name: 'Canada', aliases: ['canada'] },
  { code: 'AU', name: 'Australia', aliases: ['australia'] },
  { code: 'PK', name: 'Pakistan', aliases: ['pakistan'] },
];

/** Well-known cities, so "Austin landscapers" is understood without spelling out the state. */
const CITIES: [string, string, string][] = [
  ['Austin', 'TX', 'US'], ['Dallas', 'TX', 'US'], ['Houston', 'TX', 'US'], ['San Antonio', 'TX', 'US'], ['Fort Worth', 'TX', 'US'],
  ['El Paso', 'TX', 'US'], ['Round Rock', 'TX', 'US'], ['Plano', 'TX', 'US'], ['Frisco', 'TX', 'US'], ['Phoenix', 'AZ', 'US'],
  ['Tucson', 'AZ', 'US'], ['Denver', 'CO', 'US'], ['Los Angeles', 'CA', 'US'], ['San Diego', 'CA', 'US'], ['San Francisco', 'CA', 'US'],
  ['San Jose', 'CA', 'US'], ['Sacramento', 'CA', 'US'], ['Seattle', 'WA', 'US'], ['Portland', 'OR', 'US'], ['Chicago', 'IL', 'US'],
  ['New York', 'NY', 'US'], ['Brooklyn', 'NY', 'US'], ['Boston', 'MA', 'US'], ['Miami', 'FL', 'US'], ['Orlando', 'FL', 'US'],
  ['Tampa', 'FL', 'US'], ['Jacksonville', 'FL', 'US'], ['Atlanta', 'GA', 'US'], ['Charlotte', 'NC', 'US'], ['Raleigh', 'NC', 'US'],
  ['Nashville', 'TN', 'US'], ['Memphis', 'TN', 'US'], ['Las Vegas', 'NV', 'US'], ['Salt Lake City', 'UT', 'US'],
  ['Minneapolis', 'MN', 'US'], ['Detroit', 'MI', 'US'], ['Columbus', 'OH', 'US'], ['Cleveland', 'OH', 'US'], ['Philadelphia', 'PA', 'US'],
  ['Pittsburgh', 'PA', 'US'], ['Baltimore', 'MD', 'US'], ['Kansas City', 'MO', 'US'], ['St. Louis', 'MO', 'US'], ['Indianapolis', 'IN', 'US'],
  ['Oklahoma City', 'OK', 'US'], ['Albuquerque', 'NM', 'US'], ['Boise', 'ID', 'US'], ['Omaha', 'NE', 'US'], ['New Orleans', 'LA', 'US'],
  ['Louisville', 'KY', 'US'], ['London', 'England', 'GB'], ['Manchester', 'England', 'GB'], ['Birmingham', 'England', 'GB'],
  ['Leeds', 'England', 'GB'], ['Glasgow', 'Scotland', 'GB'], ['Toronto', 'ON', 'CA'], ['Vancouver', 'BC', 'CA'], ['Calgary', 'AB', 'CA'],
  ['Montreal', 'QC', 'CA'], ['Sydney', 'NSW', 'AU'], ['Melbourne', 'VIC', 'AU'], ['Brisbane', 'QLD', 'AU'], ['Lahore', 'Punjab', 'PK'],
  ['Karachi', 'Sindh', 'PK'], ['Islamabad', 'Islamabad Capital Territory', 'PK'],
];

export interface MarketLocation {
  country: string;
  region?: string;
  city?: string;
}

/** "Austin, TX" / "Texas" / "United States". */
export function formatLocation(l: Partial<MarketLocation>): string {
  const parts = [l.city, l.region].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return COUNTRIES.find((c) => c.code === l.country)?.name ?? l.country ?? '';
}

/** Identity of a market inside a workspace: same place + same industry = same market, however it was typed. */
export function marketKey(location: MarketLocation, industry: string): string {
  return [location.country, location.region ?? '', location.city ?? '', industryRoot(industry)].map(clean).join('|');
}

export function marketName(location: MarketLocation, industry: string): string {
  return `${industryLabel(industry)} · ${formatLocation(location)}`;
}

// ───────────────────────────── natural-language interpretation ─────────────────────────────

export interface MarketInterpretation {
  industry: string | null;
  location: Partial<MarketLocation>;
  mode: DiscoveryMode | null;
  websiteFilter: WebsiteFilter;
  /** What was understood, in words, so the user can check it before starting. */
  understood: string[];
  missing: ('industry' | 'location')[];
}

const STOP_WORDS = new Set(['find', 'all', 'every', 'the', 'in', 'of', 'mode', 'market', 'exhaust', 'deep', 'quick', 'hunt', 'search', 'karo', 'ke', 'ki', 'mein', 'me', 'aur']);

/**
 * Deterministic reading of a typed request ("Austin, Texas ke landscapers Market Exhaust mode mein find karo"). It
 * fills the structured form; the person confirms or corrects it before anything runs. An AI interpreter can replace
 * this later (Phase 9) — it must produce the same structured shape and still be confirmed.
 */
export function interpretMarketRequest(text: string): MarketInterpretation {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9.,'&\s-]/g, ' ').replace(/\s+/g, ' ')} `;
  const understood: string[] = [];
  const has = (phrase: string) => new RegExp(`[\\s,]${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s,.]`).test(lower);

  // Mode — an explicit mode wins over generic "all / maximum" wording.
  let mode: DiscoveryMode | null = null;
  if (/exhaust/.test(lower)) mode = 'MARKET_EXHAUST';
  else if (has('deep')) mode = 'DEEP';
  else if (has('quick') || has('fast') || has('jaldi')) mode = 'QUICK';
  else if (['every', 'all', 'maximum', 'max', 'tamam', 'saare', 'sare', 'sab', 'poore', 'complete'].some(has)) mode = 'MARKET_EXHAUST';
  if (mode) understood.push(`Depth: ${DISCOVERY_MODES[mode].label}`);

  // Website filter (a result filter — the hunt still finds every business).
  let websiteFilter: WebsiteFilter = 'ANY';
  if (/ho ya na ho|with or without/.test(lower)) websiteFilter = 'ANY';
  else if (/(without|no|bina|baghair|baghair kisi) (a )?website|website (nahi|nahin|na ho|ke bagair)/.test(lower)) websiteFilter = 'WITHOUT';
  else if (/with (a )?website|website (wale|walay|hai|ho)/.test(lower)) websiteFilter = 'WITH';
  if (websiteFilter !== 'ANY') understood.push(websiteFilter === 'WITHOUT' ? 'Show: businesses without a website' : 'Show: businesses with a website');

  // Industry — the longest matching phrase wins ("lawn care" over "lawn").
  let industry: string | null = null;
  const phrases = INDUSTRIES.flatMap((i) => [...i.synonyms.map((s) => ({ s, value: i.key })), ...i.related.map((s) => ({ s, value: s }))]).sort((a, b) => b.s.length - a.s.length);
  for (const { s, value } of phrases) {
    if (has(s) || has(`${s}s`)) {
      industry = value;
      break;
    }
  }
  if (industry) understood.push(`Business type: ${industryLabel(industry)}`);

  // Location: known city → its state and country; a state name or ", TX" code; a country name.
  const location: Partial<MarketLocation> = {};
  for (const [city, region, country] of [...CITIES].sort((a, b) => b[0].length - a[0].length)) {
    if (has(city.toLowerCase())) {
      Object.assign(location, { city, region, country });
      break;
    }
  }
  const stateName = Object.keys(US_STATES).sort((a, b) => b.length - a.length).find((s) => has(s) && !(s === 'new york' && location.city === 'New York') && !(s === 'washington' && /washington,? dc/.test(lower)));
  const stateCode = /,\s*([A-Z]{2})\b/.exec(text)?.[1];
  const region = stateName ? US_STATES[stateName] : stateCode && US_CODES.has(stateCode) ? stateCode : undefined;
  if (region && (!location.city || location.country !== 'US' || location.region !== region)) {
    if (location.city && location.region !== region) delete location.city; // "Austin" in another state isn't our Austin
    Object.assign(location, { region, country: 'US' });
  }
  for (const c of COUNTRIES) if (c.aliases.some(has)) location.country ??= c.code;

  // An unknown city written before a state ("Pflugerville, Texas" / "Pflugerville, TX").
  if (!location.city && location.region) {
    const m = /([A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+){0,2}),?\s+(?:[A-Z]{2}\b|[A-Z][a-z]+)/.exec(text);
    const candidate = m?.[1]?.trim();
    if (candidate && !STOP_WORDS.has(candidate.toLowerCase()) && !US_STATES[candidate.toLowerCase()] && !findIndustry(candidate)) location.city = candidate;
  }
  if (location.country || location.region || location.city) understood.push(`Location: ${formatLocation({ ...location, country: location.country ?? 'US' })}`);

  const missing: MarketInterpretation['missing'] = [];
  if (!industry) missing.push('industry');
  if (!location.country) missing.push('location');
  return { industry, location, mode, websiteFilter, understood, missing };
}

// ───────────────────────────── query planning ─────────────────────────────

export interface QueryStrategy {
  type: QueryStrategyType;
  /** Category sent to the provider. */
  category: string;
  /** Extra keyword / phrasing, for variants. */
  keyword: string | null;
  /** Dedupe key: the same strategy is never run twice against one source in a mission. */
  key: string;
}

const KEYWORDS = ['residential', 'commercial', 'family owned', 'licensed', 'affordable'];

/** Every strategy a market allows, in the order a hunt tries them (broad first, then narrower variations). */
export function buildStrategies(industry: string, location: MarketLocation, opts: { categories?: string[]; mode: DiscoveryMode }): QueryStrategy[] {
  const allowed = new Set(DISCOVERY_MODES[opts.mode].strategies);
  const primary = clean(industry);
  const make = (type: QueryStrategyType, category: string, keyword: string | null = null): QueryStrategy => ({
    type,
    category,
    keyword,
    key: `${type}:${clean(category)}:${keyword ? clean(keyword) : ''}`,
  });
  const out: QueryStrategy[] = [make('PRIMARY_CATEGORY', primary)];
  if (allowed.has('RELATED_CATEGORY')) {
    for (const c of opts.categories ?? relatedCategories(industry)) if (clean(c) !== primary) out.push(make('RELATED_CATEGORY', clean(c)));
  }
  if (allowed.has('KEYWORD_VARIANT')) for (const k of KEYWORDS) out.push(make('KEYWORD_VARIANT', primary, k));
  if (allowed.has('GEO_VARIANT') && location.city) {
    for (const g of [`downtown ${location.city}`, `${location.city} area`, `near ${location.city}`]) out.push(make('GEO_VARIANT', primary, g));
  }
  return out.filter((s) => allowed.has(s.type));
}

export function describeQuery(s: Pick<QueryStrategy, 'category' | 'keyword'>, location: MarketLocation): string {
  return `${s.keyword ? `${s.keyword} ` : ''}${s.category} — ${formatLocation(location)}`;
}

export interface PlannedQuery<S> {
  strategy: QueryStrategy;
  source: S;
}

/**
 * Next round's bounded batch (docs/11 §73: never queue thousands of future queries): for each source, the next
 * strategies it hasn't run yet, within the mission's query budget.
 */
export function planRound<S extends { key: string }>(input: {
  strategies: QueryStrategy[];
  sources: S[];
  /** `${sourceKey}|${strategyKey}` already run in this mission. */
  used: Set<string>;
  mode: DiscoveryMode;
  queriesSoFar: number;
  maxQueries: number;
}): PlannedQuery<S>[] {
  const profile = DISCOVERY_MODES[input.mode];
  const sources = profile.sources === 'PRIMARY' ? input.sources.slice(0, 1) : input.sources;
  let budget = Math.max(0, input.maxQueries - input.queriesSoFar);
  const planned: PlannedQuery<S>[] = [];
  // Round-robin across sources so a small remaining budget is shared fairly.
  const queues = sources.map((source) => ({ source, next: input.strategies.filter((s) => !input.used.has(`${source.key}|${s.key}`)).slice(0, profile.queriesPerRound) }));
  for (let i = 0; i < profile.queriesPerRound && budget > 0; i++) {
    for (const q of queues) {
      const strategy = q.next[i];
      if (strategy && budget > 0) {
        planned.push({ strategy, source: q.source });
        budget--;
      }
    }
  }
  return planned;
}

export function remainingStrategies(strategies: QueryStrategy[], sources: { key: string }[], used: Set<string>, mode: DiscoveryMode): number {
  const s = DISCOVERY_MODES[mode].sources === 'PRIMARY' ? sources.slice(0, 1) : sources;
  return s.reduce((n, source) => n + strategies.filter((st) => !used.has(`${source.key}|${st.key}`)).length, 0);
}

// ───────────────────────────── coverage assessment ─────────────────────────────

export interface RoundStats {
  round: number;
  queries: number;
  observations: number;
  /** Businesses this mission had not seen in an earlier round. */
  newUnique: number;
  cumulativeUnique: number;
}

export type StopReason = 'SATURATED' | 'STRATEGIES_EXHAUSTED' | 'ROUND_LIMIT' | 'QUERY_BUDGET' | 'CALL_BUDGET' | 'STOPPED_BY_USER' | 'TARGET_REACHED';

/** "How many leads do you want?" — a hunt stops once it has found this many unique businesses (null = no limit). */
export const LEAD_TARGETS: (number | null)[] = [20, 50, 100, 200, 500, null];
export const MAX_LEAD_TARGET = 1000;

export interface CoverageAssessment {
  decision: 'CONTINUE' | 'COMPLETE';
  stopReason: StopReason | null;
  confidence: CoverageLevel;
  /** New unique businesses in the last round as a share of everything found so far (0…1). */
  marginalYield: number;
  /** Share of all observations that were a business already seen (0…1). */
  duplicateRate: number;
  reasons: string[];
}

/** Saturation: the last round added ≤ 2% new, or the last two rounds each added ≤ 5% (docs/08 §14-17). */
export const SATURATION = { singleRound: 0.02, twoRounds: 0.05 } as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const yieldOf = (r: RoundStats) => (r.cumulativeUnique ? r.newUnique / r.cumulativeUnique : 0);

/**
 * Decides whether another round is worth it and how confident we are about coverage (docs/04 §20, docs/09 §16).
 * HIGH needs measured saturation over several rounds, more than one source and more than one query family —
 * a single source can never prove a market is covered.
 */
export function assessCoverage(input: {
  mode: DiscoveryMode;
  rounds: RoundStats[];
  totalObservations: number;
  strategiesRemaining: number;
  queriesUsed: number;
  maxQueries: number;
  callsUsed: number;
  maxProviderCalls: number;
  sourcesSearched: number;
  strategyTypesSearched: number;
  stoppedByUser?: boolean;
  /** The person's lead target; reaching it ends the hunt early (it says nothing about the rest of the market). */
  targetCount?: number | null;
}): CoverageAssessment {
  const profile = DISCOVERY_MODES[input.mode];
  const last = input.rounds.at(-1);
  const prev = input.rounds.at(-2);
  const unique = last?.cumulativeUnique ?? 0;
  const marginalYield = last ? yieldOf(last) : 0;
  const duplicateRate = input.totalObservations ? Math.max(0, 1 - unique / input.totalObservations) : 0;
  const reasons: string[] = [];

  const saturated =
    !!last && input.rounds.length >= 2 && (yieldOf(last) <= SATURATION.singleRound || (!!prev && yieldOf(prev) <= SATURATION.twoRounds && yieldOf(last) <= SATURATION.twoRounds));
  if (last) reasons.push(`Round ${last.round} added ${last.newUnique} new ${last.newUnique === 1 ? 'business' : 'businesses'} (${pct(marginalYield)} of ${unique} found)`);

  let stopReason: StopReason | null = null;
  const targetReached = !!input.targetCount && unique >= input.targetCount;
  if (input.stoppedByUser) stopReason = 'STOPPED_BY_USER';
  else if (targetReached) stopReason = 'TARGET_REACHED';
  else if (saturated) stopReason = 'SATURATED';
  else if (input.strategiesRemaining === 0) stopReason = 'STRATEGIES_EXHAUSTED';
  else if (input.rounds.length >= profile.maxRounds) stopReason = 'ROUND_LIMIT';
  else if (input.queriesUsed >= input.maxQueries) stopReason = 'QUERY_BUDGET';
  else if (input.callsUsed >= input.maxProviderCalls) stopReason = 'CALL_BUDGET';

  // Confidence describes the coverage measurement, not the quality of each record.
  let confidence: CoverageLevel = 'MEDIUM';
  if (unique === 0) {
    confidence = 'LOW';
    reasons.push('No businesses found yet');
  } else if (input.rounds.length < 2) {
    confidence = 'LOW';
    reasons.push('Only one round — saturation not measured');
  } else if (!saturated && marginalYield > 0.1) {
    confidence = 'LOW';
    reasons.push(`Still finding many new businesses (${pct(marginalYield)} in the last round)`);
  } else if (saturated && input.rounds.length >= 3 && input.sourcesSearched >= 2 && input.strategyTypesSearched >= 2) {
    confidence = 'HIGH';
    reasons.push(`New results dried up across ${input.sourcesSearched} sources and ${input.strategyTypesSearched} query families`);
  } else {
    if (input.sourcesSearched < 2) reasons.push('Only one source searched — a second source is needed for high confidence');
    if (input.strategyTypesSearched < 2) reasons.push('Only one kind of query was tried');
    if (saturated && input.rounds.length < 3) reasons.push('Saturation seen over few rounds');
    if (!saturated) reasons.push('Stopped before new results dried up');
  }
  reasons.push(`${pct(duplicateRate)} of listings were businesses already found`);
  if (targetReached && !saturated) reasons.unshift(`Reached your target of ${input.targetCount} leads — the rest of the market was not searched`);

  return { decision: stopReason ? 'COMPLETE' : 'CONTINUE', stopReason, confidence, marginalYield, duplicateRate, reasons };
}

export const STOP_REASON_LABEL: Record<StopReason, string> = {
  SATURATED: 'New results dried up',
  STRATEGIES_EXHAUSTED: 'Every planned query was tried',
  ROUND_LIMIT: 'Round limit for this depth reached',
  QUERY_BUDGET: 'Query budget reached',
  CALL_BUDGET: 'Provider call budget reached',
  STOPPED_BY_USER: 'Stopped by a person',
  TARGET_REACHED: 'Your lead target was reached',
};
