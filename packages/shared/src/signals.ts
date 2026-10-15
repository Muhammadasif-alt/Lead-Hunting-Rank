/**
 * Buying signals + intent (screen #9, docs/04 §15 + §44, docs/06 §31-40, docs/08 §28-30, docs/09 §67-76). Browser-safe
 * rules shared by the API, the worker and the web app: the taxonomy, how long a signal stays useful, how relevance is
 * explained, when a "why now" exists, how rules match and how the same event from several sources becomes one signal.
 *
 * A signal is evidence of CHANGE, never evidence of purchase intent. FACT (what was observed, with its source) and
 * INTERPRETATION (what it may mean, hedged) stay apart. A signal authorises no outreach by itself: outreach still goes
 * Signal → Verify → Relevance → Why now → Relationship check → Campaign eligibility → Policy → External action.
 */

export const SIGNAL_CATEGORIES = ['GROWTH', 'DIGITAL', 'COMMERCIAL', 'PEOPLE', 'MARKETING', 'RELATIONSHIP', 'CONVERSATION', 'NEGATIVE'] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

export const SIGNAL_CATEGORY_INFO: Record<SignalCategory, { label: string; description: string }> = {
  GROWTH: { label: 'Business growth', description: 'New service, location, territory, team growth' },
  DIGITAL: { label: 'Digital', description: 'Website launched, redesigned, booking or chat added, technology change' },
  COMMERCIAL: { label: 'Commercial', description: 'New contracts, projects, partnerships, pricing structure' },
  PEOPLE: { label: 'People', description: 'New owner, leadership change, relevant hire, decision-maker change' },
  MARKETING: { label: 'Marketing', description: 'Review activity, advertising, content campaigns' },
  RELATIONSHIP: { label: 'Relationship', description: '"Contact me later" reached, old prospect back, lost deal revisit' },
  CONVERSATION: { label: 'Conversation', description: 'They asked for pricing, a meeting, stated a timeline, named a stakeholder' },
  NEGATIVE: { label: 'Negative', description: 'Website down, business closed — recheck before outreach, never a reason to contact' },
};

/** The sides of our offer a signal tends to make relevant — matched against approved Knowledge Base services. */
export const SERVICE_THEMES = ['WEBSITE', 'SEO', 'LEADS', 'AUTOMATION', 'CHAT', 'CRM', 'ADS', 'REVIEWS', 'BOOKING', 'GENERAL'] as const;
export type ServiceTheme = (typeof SERVICE_THEMES)[number];

export const SERVICE_THEME_LABEL: Record<ServiceTheme, string> = {
  WEBSITE: 'Website',
  SEO: 'SEO / local search',
  LEADS: 'Lead generation',
  AUTOMATION: 'Automation / follow-up',
  CHAT: 'Chat / AI assistant',
  CRM: 'CRM',
  ADS: 'Advertising',
  REVIEWS: 'Reviews / reputation',
  BOOKING: 'Online booking',
  GENERAL: 'General',
};

const THEME_PATTERNS: [ServiceTheme, RegExp][] = [
  ['SEO', /\b(seo|search engine|local search|google (maps|business|ranking)|rank(ing)?s?|citations?)\b/i],
  ['WEBSITE', /\b(web ?sites?|web design|landing pages?|redesign|web development)\b/i],
  ['LEADS', /\b(lead ?(gen|generation|capture|routing)|leads|prospecting|new customers?|appointments?)\b/i],
  ['AUTOMATION', /\b(automat(ion|ed|e)|follow[- ]?ups?|workflows?|nurtur(e|ing)|sequences?)\b/i],
  ['CHAT', /\b(chat ?bots?|live chat|ai (chat|assistant|agent)|virtual (assistant|receptionist))\b/i],
  ['CRM', /\b(crm|pipeline|hubspot|salesforce|gohighlevel)\b/i],
  ['ADS', /\b(ads?|advertising|ppc|google ads|facebook ads|paid (search|social))\b/i],
  ['REVIEWS', /\b(reviews?|reputation|ratings?)\b/i],
  ['BOOKING', /\b(booking|scheduling|calendar|appointment (booking|scheduling))\b/i],
];

/** Which themes a service description covers (approved SERVICE knowledge → what we can actually sell). */
export function serviceThemes(text: string): ServiceTheme[] {
  const out = THEME_PATTERNS.filter(([, re]) => re.test(text)).map(([t]) => t);
  return out.length ? out : ['GENERAL'];
}

export const RECOMMENDED_ACTIONS = ['RESEARCH', 'NOTIFY_OWNER', 'ATTACH_TO_DEAL', 'RE_ENGAGE', 'CAMPAIGN_CANDIDATE', 'RECHECK', 'RECORD'] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export const RECOMMENDED_ACTION_INFO: Record<RecommendedAction, { label: string; description: string }> = {
  RESEARCH: { label: 'Research first', description: 'Refresh what we know before anyone reaches out' },
  NOTIFY_OWNER: { label: 'Tell the owner', description: 'Someone already owns this relationship — no new cold outreach' },
  ATTACH_TO_DEAL: { label: 'Attach to the deal', description: 'There is an open opportunity — the signal belongs on it' },
  RE_ENGAGE: { label: 'Re-engage', description: 'They asked us to come back, or circumstances changed — refresh, then reach out' },
  CAMPAIGN_CANDIDATE: { label: 'Campaign candidate', description: 'Eligible for a signal-based campaign (every campaign check and policy still applies)' },
  RECHECK: { label: 'Recheck', description: 'Verify before any outreach — the evidence may be temporary' },
  RECORD: { label: 'Record only', description: 'Kept in the history; nothing to do now' },
};

export type Relationship = 'COLD' | 'IN_CONVERSATION' | 'OPEN_DEAL' | 'CUSTOMER' | 'FORMER_CUSTOMER' | 'LOST_DEAL' | 'DORMANT';

export const RELATIONSHIP_INFO: Record<Relationship, { label: string; description: string }> = {
  COLD: { label: 'Cold prospect', description: 'No conversation yet' },
  IN_CONVERSATION: { label: 'In conversation', description: 'A conversation is open — do not send a new cold email' },
  OPEN_DEAL: { label: 'Open deal', description: 'An opportunity is in progress — the deal owner decides' },
  CUSTOMER: { label: 'Customer', description: 'An existing customer — expansion goes to the account owner, never a cold campaign' },
  FORMER_CUSTOMER: { label: 'Former customer', description: 'A past customer' },
  LOST_DEAL: { label: 'Lost deal', description: 'A deal was lost (maybe with a revisit date)' },
  DORMANT: { label: 'Dormant', description: 'We spoke before, then nothing for months' },
};

export type SourceKind = 'WEBSITE' | 'CONVERSATION' | 'COMMITMENT' | 'PIPELINE' | 'CRM' | 'DISCOVERY' | 'HUMAN';

export interface SignalTypeInfo {
  label: string;
  category: SignalCategory;
  /** Days the signal keeps driving a "why now" (screen #9 §14) — an upper bound; detectors may shorten it, never lengthen it. */
  lifetimeDays: number;
  /** 0-3: explicit buying / relationship signals outrank speculative external ones (screen #9 §19). */
  baseWeight: 0 | 1 | 2 | 3;
  /** Which sides of our offer it tends to make relevant. Empty = first-party: relevance comes from the conversation itself. */
  themes: ServiceTheme[];
  /** Action window in days after effectiveAt for time-boxed signals (screen #9 §35); null = none. */
  windowDays: number | null;
  /** Default recommended action for a cold prospect. */
  action: RecommendedAction;
  /** Never a reason to contact; verify before outreach instead (screen #9 §10). */
  negative: boolean;
  /** Where it comes from today. HIRING has no connected source yet — it is listed so the gap is honest. */
  source: SourceKind | 'NONE';
  description: string;
}

export const SIGNAL_TYPES = {
  NEW_SERVICE: { label: 'New service', category: 'GROWTH', lifetimeDays: 120, baseWeight: 2, themes: ['LEADS', 'SEO', 'WEBSITE', 'ADS'], windowDays: null, action: 'RESEARCH', negative: false, source: 'WEBSITE', description: 'A service appeared on the website that was not there before' },
  NEW_LOCATION: { label: 'New location', category: 'GROWTH', lifetimeDays: 180, baseWeight: 2, themes: ['SEO', 'WEBSITE', 'LEADS', 'REVIEWS'], windowDays: null, action: 'RESEARCH', negative: false, source: 'WEBSITE', description: 'A new location or service area was published' },
  EXPANSION: { label: 'Expansion pattern', category: 'GROWTH', lifetimeDays: 180, baseWeight: 2, themes: ['LEADS', 'AUTOMATION', 'CRM', 'SEO'], windowDays: null, action: 'RESEARCH', negative: false, source: 'WEBSITE', description: 'Several independent growth observations together (screen #9 §34) — still an inference' },
  HIRING: { label: 'Hiring', category: 'GROWTH', lifetimeDays: 60, baseWeight: 1, themes: ['AUTOMATION', 'LEADS', 'CRM'], windowDays: null, action: 'RESEARCH', negative: false, source: 'NONE', description: 'Relevant job openings (no hiring source is connected yet)' },
  WEBSITE_LAUNCHED: { label: 'Website launched', category: 'DIGITAL', lifetimeDays: 90, baseWeight: 2, themes: ['SEO', 'LEADS', 'ADS', 'REVIEWS'], windowDays: null, action: 'RESEARCH', negative: false, source: 'WEBSITE', description: 'A business that had no website now has one' },
  WEBSITE_CHANGE: { label: 'Website changed', category: 'DIGITAL', lifetimeDays: 60, baseWeight: 1, themes: ['WEBSITE', 'SEO', 'LEADS'], windowDays: null, action: 'RESEARCH', negative: false, source: 'WEBSITE', description: 'The website changed materially (not formatting or the copyright year)' },
  TECH_CHANGE: { label: 'Technology change', category: 'DIGITAL', lifetimeDays: 90, baseWeight: 1, themes: ['AUTOMATION', 'WEBSITE', 'CRM'], windowDays: null, action: 'RECORD', negative: false, source: 'WEBSITE', description: 'Booking, chat or a platform was added or removed' },
  WEBSITE_DOWN: { label: 'Website unavailable', category: 'NEGATIVE', lifetimeDays: 14, baseWeight: 0, themes: ['WEBSITE'], windowDays: null, action: 'RECHECK', negative: true, source: 'WEBSITE', description: 'The website stopped loading — technical issue, expired domain or a business change' },
  WEBSITE_BACK: { label: 'Website back online', category: 'DIGITAL', lifetimeDays: 30, baseWeight: 0, themes: ['WEBSITE'], windowDays: null, action: 'RECORD', negative: false, source: 'WEBSITE', description: 'A website that was unavailable loads again' },
  LEADERSHIP_CHANGE: { label: 'Leadership change', category: 'PEOPLE', lifetimeDays: 120, baseWeight: 2, themes: ['GENERAL'], windowDays: null, action: 'RESEARCH', negative: false, source: 'CRM', description: 'A decision maker left or a new one was publicly identified' },
  NEW_STAKEHOLDER: { label: 'New stakeholder', category: 'PEOPLE', lifetimeDays: 90, baseWeight: 1, themes: ['GENERAL'], windowDays: null, action: 'RECORD', negative: false, source: 'CRM', description: 'A new relevant person was found at the company' },
  NEW_TO_DATASET: { label: 'New to our dataset', category: 'GROWTH', lifetimeDays: 30, baseWeight: 0, themes: ['GENERAL'], windowDays: null, action: 'RESEARCH', negative: false, source: 'DISCOVERY', description: 'A saved market rescan found a business we did not have — "new to us", not necessarily newly opened (screen #9 §7)' },
  BUSINESS_CLOSED: { label: 'Business closed', category: 'NEGATIVE', lifetimeDays: 365, baseWeight: 0, themes: [], windowDays: null, action: 'RECORD', negative: true, source: 'CRM', description: 'Marked permanently closed — outreach eligibility removed' },
  CONTACT_LATER_DUE: { label: 'Follow-up date reached', category: 'RELATIONSHIP', lifetimeDays: 21, baseWeight: 3, themes: [], windowDays: 7, action: 'RE_ENGAGE', negative: false, source: 'COMMITMENT', description: 'They asked to be contacted later and that date has come' },
  LOST_DEAL_REVISIT: { label: 'Lost deal — revisit date', category: 'RELATIONSHIP', lifetimeDays: 30, baseWeight: 3, themes: [], windowDays: 14, action: 'RE_ENGAGE', negative: false, source: 'PIPELINE', description: 'A deal lost on timing reached its revisit date' },
  DORMANT_REENGAGED: { label: 'Dormant prospect replied', category: 'RELATIONSHIP', lifetimeDays: 14, baseWeight: 3, themes: [], windowDays: null, action: 'NOTIFY_OWNER', negative: false, source: 'CONVERSATION', description: 'A conversation quiet for months received a new message' },
  PRICING_ASKED: { label: 'Asked for pricing', category: 'CONVERSATION', lifetimeDays: 14, baseWeight: 3, themes: [], windowDays: null, action: 'NOTIFY_OWNER', negative: false, source: 'CONVERSATION', description: 'The prospect asked what it costs' },
  MEETING_ASKED: { label: 'Asked for a meeting', category: 'CONVERSATION', lifetimeDays: 7, baseWeight: 3, themes: [], windowDays: null, action: 'NOTIFY_OWNER', negative: false, source: 'CONVERSATION', description: 'The prospect asked for a call or availability' },
  TIMELINE_STATED: { label: 'Timeline stated', category: 'CONVERSATION', lifetimeDays: 60, baseWeight: 2, themes: [], windowDays: null, action: 'NOTIFY_OWNER', negative: false, source: 'CONVERSATION', description: 'They said when they want it ("live before December")' },
  CURRENT_SOLUTION_ISSUE: { label: 'Unhappy with current provider', category: 'CONVERSATION', lifetimeDays: 90, baseWeight: 3, themes: [], windowDays: null, action: 'NOTIFY_OWNER', negative: false, source: 'CONVERSATION', description: 'A first-party statement about their current solution (screen #9 §28) — internal sales context' },
  STAKEHOLDER_MENTIONED: { label: 'Stakeholder mentioned', category: 'CONVERSATION', lifetimeDays: 60, baseWeight: 1, themes: [], windowDays: null, action: 'RECORD', negative: false, source: 'CONVERSATION', description: 'They mentioned a partner or another decision maker' },
} as const satisfies Record<string, SignalTypeInfo>;

export type SignalTypeKey = keyof typeof SIGNAL_TYPES;
export const SIGNAL_TYPE_KEYS = Object.keys(SIGNAL_TYPES) as SignalTypeKey[];
export const signalTypeInfo = (type: string): SignalTypeInfo | undefined => (Object.hasOwn(SIGNAL_TYPES, type) ? (SIGNAL_TYPES as Record<string, SignalTypeInfo>)[type] : undefined);

export const SIGNAL_STRENGTHS = ['STRONG', 'MEDIUM', 'WEAK'] as const;
export type SignalStrengthKey = (typeof SIGNAL_STRENGTHS)[number];

export const SIGNAL_STATUSES = ['CANDIDATE', 'DETECTED', 'VALIDATED', 'ACTIONABLE', 'MONITOR', 'DISMISSED', 'EXPIRED', 'ACTED_ON'] as const;
export type SignalStatusKey = (typeof SIGNAL_STATUSES)[number];
export const SIGNAL_STATUS_INFO: Record<SignalStatusKey, { label: string; description: string }> = {
  CANDIDATE: { label: 'Candidate', description: 'A raw possible change — not yet checked' },
  DETECTED: { label: 'Needs verification', description: 'Seen by a source we do not fully trust yet' },
  VALIDATED: { label: 'Validated', description: 'A credible change — not necessarily commercial intent' },
  ACTIONABLE: { label: 'Actionable', description: 'Relevant to what we sell now — still not "definitely buying"' },
  MONITOR: { label: 'Monitoring', description: 'Real, but no reason to act now' },
  DISMISSED: { label: 'Not relevant', description: 'A person dismissed it (feedback kept)' },
  EXPIRED: { label: 'Expired', description: 'Too old to drive a "why now"' },
  ACTED_ON: { label: 'Acted on', description: 'Research, a deal note, re-engagement or a campaign candidate followed' },
};
/** Signals a person still sees in the queue. */
export const OPEN_SIGNAL_STATUSES: SignalStatusKey[] = ['DETECTED', 'VALIDATED', 'ACTIONABLE', 'MONITOR'];

export const SIGNAL_FEEDBACK = ['WRONG_COMPANY', 'WRONG_SIGNAL', 'NOT_RELEVANT', 'OLD_INFORMATION', 'WRONG_INTERPRETATION', 'DUPLICATE'] as const;
export type SignalFeedbackKey = (typeof SIGNAL_FEEDBACK)[number];
export const SIGNAL_FEEDBACK_LABEL: Record<SignalFeedbackKey, string> = {
  WRONG_COMPANY: 'Wrong company',
  WRONG_SIGNAL: 'Wrong signal',
  NOT_RELEVANT: 'Not commercially relevant',
  OLD_INFORMATION: 'Old information',
  WRONG_INTERPRETATION: 'Incorrect interpretation',
  DUPLICATE: 'Duplicate',
};

export const RULE_ACTIONS = ['RECORD', 'RESEARCH', 'PRIORITY', 'CAMPAIGN_CANDIDATE', 'NOTIFY_OWNER', 'IGNORE'] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];
export const RULE_ACTION_INFO: Record<RuleAction, { label: string; description: string }> = {
  RECORD: { label: 'Record only', description: 'Keep it in the history' },
  RESEARCH: { label: 'Deep research', description: 'Queue a research run for the company' },
  PRIORITY: { label: 'Add to priority queue', description: 'Show it at the top of the signal queue' },
  CAMPAIGN_CANDIDATE: { label: 'Campaign candidate', description: 'Mark it for signal-based campaigns (cold prospects only; every check and policy still applies)' },
  NOTIFY_OWNER: { label: 'Notify the owner', description: 'Tell the deal / conversation owner' },
  IGNORE: { label: 'Ignore', description: 'Suppress this noise: the signal is kept but never shown or acted on' },
};

export const WATCHLIST_KINDS = ['MANUAL', 'MARKET', 'OPEN_DEALS', 'LOST_DEALS', 'CUSTOMERS'] as const;
export type WatchlistKind = (typeof WATCHLIST_KINDS)[number];
export const WATCHLIST_KIND_INFO: Record<WatchlistKind, { label: string; description: string }> = {
  MANUAL: { label: 'Hand-picked', description: 'Companies a person added' },
  MARKET: { label: 'Saved market', description: 'Every company found in a Lead Hunter market' },
  OPEN_DEALS: { label: 'Open deals', description: 'Companies with an open opportunity (kept in sync)' },
  LOST_DEALS: { label: 'Lost deals', description: 'Companies whose deal was lost (kept in sync)' },
  CUSTOMERS: { label: 'Customers', description: 'Existing customers (kept in sync)' },
};

/** How often a watched company is re-checked (screen #9 §31): cost + usefulness + source limits. */
export const WATCHLIST_CADENCE_DAYS: Record<'HIGH' | 'NORMAL' | 'LOW', number> = { HIGH: 3, NORMAL: 7, LOW: 21 };
/** Most monitoring research runs queued per sweep — website reads cost provider calls. */
export const MONITOR_BATCH = 10;

export type Level = 'HIGH' | 'MEDIUM' | 'LOW';
const LEVEL_SCORE: Record<Level, number> = { HIGH: 2, MEDIUM: 1, LOW: 0 };

export type SourceTrust = 'FIRST_PARTY' | 'OFFICIAL_WEBSITE' | 'LEAD_SOURCE' | 'PERSON_ENTERED' | 'OTHER';

export interface RelevanceInput {
  type: SignalTypeKey;
  detectedAt: Date | string;
  now?: Date;
  /** One entry per evidence row; distinct `source` names count as independent sources. */
  sources: { trust: SourceTrust; source: string }[];
  /** Latest ICP_FIT assessment of the company (Phase 9 Scoring Agent), null = not assessed. */
  icp: Level | null;
  /** Themes of the approved SERVICE knowledge items (empty = nothing approved to sell). */
  offerThemes: ServiceTheme[];
  /** Names of the approved services whose themes match (for the explanation). */
  offerNames?: string[];
  relationship: Relationship;
}

/** Explainable components, not a bare score (screen #9 §13). */
export interface Relevance {
  freshness: Level;
  sourceReliability: Level;
  icpRelevance: Level;
  commercialRelevance: Level;
  relationshipContext: Level;
  score: number;
  strength: SignalStrengthKey;
  reasons: string[];
  /** Approved services that make the signal relevant (empty = nothing we sell fits). */
  matchedServices: string[];
}

const TRUST_LEVEL: Record<SourceTrust, Level> = { FIRST_PARTY: 'HIGH', OFFICIAL_WEBSITE: 'HIGH', PERSON_ENTERED: 'MEDIUM', LEAD_SOURCE: 'MEDIUM', OTHER: 'LOW' };
const FIRST_PARTY: SignalCategory[] = ['CONVERSATION', 'RELATIONSHIP'];

export function assessRelevance(input: RelevanceInput): Relevance {
  const info: SignalTypeInfo = SIGNAL_TYPES[input.type];
  const now = input.now ?? new Date();
  const ageDays = Math.max(0, (now.getTime() - new Date(input.detectedAt).getTime()) / 86_400_000);
  const reasons: string[] = [];

  const freshness: Level = ageDays <= info.lifetimeDays * 0.25 ? 'HIGH' : ageDays <= info.lifetimeDays * 0.6 ? 'MEDIUM' : 'LOW';
  reasons.push(freshness === 'HIGH' ? `Fresh: ${Math.round(ageDays)} day(s) old` : freshness === 'MEDIUM' ? `Aging: ${Math.round(ageDays)} day(s) old (useful for ~${info.lifetimeDays} days)` : `Old: ${Math.round(ageDays)} day(s) old — past most of its ${info.lifetimeDays}-day usefulness`);

  const best = input.sources.reduce<Level>((acc, s) => (LEVEL_SCORE[TRUST_LEVEL[s.trust]] > LEVEL_SCORE[acc] ? TRUST_LEVEL[s.trust] : acc), 'LOW');
  const independent = new Set(input.sources.map((s) => s.source)).size;
  const sourceReliability: Level = input.sources.length === 0 ? 'LOW' : independent >= 2 && best !== 'LOW' ? 'HIGH' : best;
  reasons.push(input.sources.length === 0 ? 'No stored evidence' : `${independent} independent source(s); best: ${best.toLowerCase()} trust`);

  const icpRelevance: Level = input.icp ?? 'LOW';
  reasons.push(input.icp ? `ICP fit assessed ${input.icp.toLowerCase()}` : 'ICP fit not assessed yet');

  const firstParty = FIRST_PARTY.includes(info.category);
  const matchedThemes = info.themes.filter((t) => input.offerThemes.includes(t));
  const matchedServices = input.offerNames ?? [];
  let commercialRelevance: Level;
  if (info.negative) commercialRelevance = 'LOW';
  else if (firstParty) commercialRelevance = input.offerThemes.length ? 'HIGH' : 'MEDIUM';
  else if (!input.offerThemes.length) commercialRelevance = 'LOW';
  else if (matchedThemes.length >= 2 || (matchedThemes.length === 1 && info.baseWeight >= 2)) commercialRelevance = 'HIGH';
  else if (matchedThemes.length === 1 || input.offerThemes.includes('GENERAL')) commercialRelevance = 'MEDIUM';
  else commercialRelevance = 'LOW';
  reasons.push(
    info.negative
      ? 'A negative signal is never a reason to contact'
      : firstParty
        ? 'First-party: they said it to us'
        : !input.offerThemes.length
          ? 'No approved service in the Knowledge Base — nothing to offer yet'
          : matchedThemes.length
            ? `Fits what we sell: ${matchedThemes.map((t) => SERVICE_THEME_LABEL[t].toLowerCase()).join(', ')}`
            : 'None of our approved services fits this change',
  );

  const relationshipContext: Level = input.relationship === 'COLD' ? (icpRelevance === 'HIGH' ? 'MEDIUM' : 'LOW') : input.relationship === 'FORMER_CUSTOMER' ? 'MEDIUM' : 'HIGH';
  reasons.push(`${RELATIONSHIP_INFO[input.relationship].label}`);

  const score = LEVEL_SCORE[freshness] + LEVEL_SCORE[sourceReliability] + LEVEL_SCORE[icpRelevance] + 2 * LEVEL_SCORE[commercialRelevance] + 1.5 * LEVEL_SCORE[relationshipContext] + info.baseWeight;
  let strength: SignalStrengthKey = score >= 11 ? 'STRONG' : score >= 7 ? 'MEDIUM' : 'WEAK';
  // Nothing to sell, or stale, or a negative event: never strong (screen #9 §45).
  if (commercialRelevance === 'LOW' || freshness === 'LOW' || info.negative) strength = 'WEAK';
  return { freshness, sourceReliability, icpRelevance, commercialRelevance, relationshipContext, score, strength, reasons, matchedServices };
}

export interface WhyNowInput {
  type: SignalTypeKey;
  companyName: string;
  fact: string;
  relevance: Relevance;
  relationship: Relationship;
  detectedAt: Date | string;
  now?: Date;
}

const ago = (at: Date | string, now: Date) => {
  const d = Math.round((now.getTime() - new Date(at).getTime()) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`;
};

/**
 * "Why contact them now?" (screen #9 §18). An evidence-backed sentence, or null when there is no meaningful reason —
 * then there is NO signal-based outreach and the company stays in the normal prospecting pool. "They exist" is never
 * a reason.
 */
export function whyNow(input: WhyNowInput): string | null {
  const info: SignalTypeInfo = SIGNAL_TYPES[input.type];
  const r = input.relevance;
  if (info.negative || r.strength === 'WEAK' || r.commercialRelevance === 'LOW' || r.freshness === 'LOW') return null;
  const now = input.now ?? new Date();
  const when = ago(input.detectedAt, now);
  const offer = r.matchedServices.length ? `our ${r.matchedServices.slice(0, 2).join(' and ')} offer is relevant` : 'our approved services are relevant';
  switch (input.type) {
    case 'CONTACT_LATER_DUE':
      return `They asked us to come back now (${input.fact}) — a request, not a cold approach.`;
    case 'LOST_DEAL_REVISIT':
      return `The deal was lost on timing and the revisit date they agreed to has come (${input.fact}).`;
    case 'DORMANT_REENGAGED':
      return `They came back to us after months of silence (${when}) — the relationship is warm again.`;
    case 'PRICING_ASKED':
    case 'MEETING_ASKED':
    case 'TIMELINE_STATED':
    case 'CURRENT_SOLUTION_ISSUE':
    case 'STAKEHOLDER_MENTIONED':
      return `${input.fact} (${when}) — explicit first-party interest that outranks any external signal.`;
    default:
      return `${input.fact} (${when}), and ${offer} to a business making this change.`;
  }
}

/**
 * What to do with a signal given the relationship (screen #9 §26-27): an open deal or conversation gets the signal
 * attached and its owner told; a customer's expansion goes to the account owner; a lost or dormant prospect is
 * refreshed and re-engaged; a cold prospect is researched first, and only a researched, actionable one becomes a
 * campaign candidate.
 */
export function recommendAction(input: { type: SignalTypeKey; relationship: Relationship; relevance: Relevance; researchFresh: boolean }): RecommendedAction {
  const info: SignalTypeInfo = SIGNAL_TYPES[input.type];
  if (info.negative) return info.action;
  switch (input.relationship) {
    case 'OPEN_DEAL':
      return 'ATTACH_TO_DEAL';
    case 'IN_CONVERSATION':
    case 'CUSTOMER':
      return 'NOTIFY_OWNER';
    case 'LOST_DEAL':
    case 'DORMANT':
      return input.relevance.strength === 'WEAK' ? 'RECORD' : 'RE_ENGAGE';
    default: {
      if (info.category === 'RELATIONSHIP') return input.relevance.strength === 'WEAK' ? 'RECORD' : 'RE_ENGAGE';
      if (input.relevance.strength === 'WEAK') return info.action === 'RECHECK' ? 'RECHECK' : 'RECORD';
      return input.researchFresh && input.relevance.strength === 'STRONG' ? 'CAMPAIGN_CANDIDATE' : 'RESEARCH';
    }
  }
}

/** docs/09 §67-76: DETECTED (untrusted source) → VALIDATED → ACTIONABLE / MONITOR. */
export function decideStatus(relevance: Relevance, why: string | null, negative: boolean): Extract<SignalStatusKey, 'DETECTED' | 'ACTIONABLE' | 'MONITOR'> {
  if (relevance.sourceReliability === 'LOW') return 'DETECTED';
  if (negative) return 'MONITOR';
  return why && relevance.strength !== 'WEAK' ? 'ACTIONABLE' : 'MONITOR';
}

export const signalSlug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'event';

/** Same company + type + subject + day = one signal; later sightings of an open signal merge into it (screen #9 §15). */
export function signalDedupeKey(companyId: string, type: string, subject: string, at: Date | string): string {
  return `${companyId}:${type}:${signalSlug(subject)}:${new Date(at).toISOString().slice(0, 10)}`;
}

export function signalExpiry(type: SignalTypeKey, effectiveAt: Date, proposedDays?: number | null): Date {
  const info: SignalTypeInfo = SIGNAL_TYPES[type];
  const days = proposedDays != null ? Math.min(Math.max(1, proposedDays), info.lifetimeDays) : info.lifetimeDays;
  return new Date(effectiveAt.getTime() + days * 86_400_000);
}

export function signalWindowEnd(type: SignalTypeKey, effectiveAt: Date): Date | null {
  const info: SignalTypeInfo = SIGNAL_TYPES[type];
  return info.windowDays ? new Date(effectiveAt.getTime() + info.windowDays * 86_400_000) : null;
}

// ───────────────────────────── website change intelligence (screen #9 §6) ─────────────────────────────

export interface PageState {
  title: string | null;
  description: string | null;
  text: string;
  ctas: string[];
  booking: boolean | null;
  chat: boolean | null;
  contactForm: boolean | null;
  technologies: string[];
  copyrightYear: number | null;
}

export type ChangeLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface DetectedChange {
  /** Which signal it supports, or null for an observation that is counted but not a signal. */
  signal: SignalTypeKey | null;
  level: ChangeLevel;
  label: string;
  subject: string;
  previous: string[] | string | null;
  current: string[] | string | null;
  detail: string;
}

const SERVICE_WORDS = /\b(landscap\w*|lawn|irrigation|hardscap\w*|tree|snow|roof\w*|plumb\w*|hvac|heating|cooling|electric\w*|clean\w*|paint\w*|remodel\w*|renovat\w*|repair\w*|detailing|install\w*|maintenance|design|seo|marketing|commercial|residential|pest|pool|fencing|concrete|paving|solar|dental|chiropractic|physio\w*|grooming|catering|moving|storage|towing|auto|tires?|brakes?|inspection|wellness|massage|training|consult\w*|accounting|bookkeeping|legal|insurance)\b/i;
const COMMERCIAL_CTA = /\b(commercial|business|enterprise|wholesale|contract|b2b)\b/i;

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size && !wb.size) return 1;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return both / (wa.size + wb.size - both);
}

/** Phrases that read like service names: short capitalised runs ending in a service word, or service-word bigrams. */
export function servicePhrases(text: string): string[] {
  const out = new Set<string>();
  const re = /\b([A-Z][a-zA-Z&-]+(?:\s+[A-Z&][a-zA-Z&-]+){0,3})\b/g;
  for (const m of text.matchAll(re)) {
    const phrase = m[1]!.trim();
    if (phrase.split(/\s+/).length >= 2 && SERVICE_WORDS.test(phrase) && phrase.length <= 48) out.add(phrase);
  }
  return [...out].slice(0, 40);
}

/**
 * Previous vs current page: which changes matter. Formatting, wording and the copyright year are LOW (counted, no
 * signal); a new service, booking or chat, a new commercial CTA, or a rewritten page are MEDIUM/HIGH and become signals.
 */
export function classifyWebsiteChange(previous: PageState, current: PageState): { level: ChangeLevel; changes: DetectedChange[] } {
  const changes: DetectedChange[] = [];
  const sim = similarity(previous.text, current.text);
  const prevServices = servicePhrases(previous.text);
  const currServices = servicePhrases(current.text);
  const newServices = currServices.filter((s) => !prevServices.some((p) => p.toLowerCase() === s.toLowerCase()));
  const newCtas = current.ctas.filter((c) => !previous.ctas.some((p) => p.toLowerCase() === c.toLowerCase()));

  for (const s of newServices.slice(0, 3)) {
    changes.push({ signal: 'NEW_SERVICE', level: 'HIGH', label: 'New service', subject: s, previous: prevServices, current: currServices, detail: `"${s}" appears on the website and was not there at the previous check.` });
  }
  if (previous.booking === false && current.booking === true) changes.push({ signal: 'TECH_CHANGE', level: 'HIGH', label: 'Online booking added', subject: 'booking', previous: 'No online booking detected', current: 'Booking system detected', detail: 'A booking tool is now embedded on the site.' });
  if (previous.booking === true && current.booking === false) changes.push({ signal: 'TECH_CHANGE', level: 'MEDIUM', label: 'Online booking removed', subject: 'booking', previous: 'Booking system detected', current: 'No online booking detected', detail: 'The booking tool is no longer on the pages checked.' });
  if (previous.chat === false && current.chat === true) changes.push({ signal: 'TECH_CHANGE', level: 'MEDIUM', label: 'Live chat added', subject: 'chat', previous: 'No chat detected', current: 'Chat widget detected', detail: 'A chat widget is now on the site.' });
  if (previous.contactForm === false && current.contactForm === true) changes.push({ signal: 'TECH_CHANGE', level: 'MEDIUM', label: 'Contact form added', subject: 'contact-form', previous: 'No contact form', current: 'Contact form detected', detail: 'The site now has a contact form.' });
  const newTech = current.technologies.filter((t) => !previous.technologies.includes(t));
  const goneTech = previous.technologies.filter((t) => !current.technologies.includes(t));
  if (newTech.length || goneTech.length) changes.push({ signal: 'TECH_CHANGE', level: 'MEDIUM', label: 'Technology changed', subject: 'technology', previous: previous.technologies, current: current.technologies, detail: [newTech.length ? `Added: ${newTech.join(', ')}` : '', goneTech.length ? `Removed: ${goneTech.join(', ')}` : ''].filter(Boolean).join('. ') });
  const commercialCta = newCtas.find((c) => COMMERCIAL_CTA.test(c));
  if (commercialCta) changes.push({ signal: 'WEBSITE_CHANGE', level: 'HIGH', label: 'New commercial call to action', subject: 'cta', previous: previous.ctas, current: current.ctas, detail: `New call to action: "${commercialCta}".` });
  else if (newCtas.length) changes.push({ signal: null, level: 'MEDIUM', label: 'Call to action changed', subject: 'cta', previous: previous.ctas, current: current.ctas, detail: `New: ${newCtas.join(', ')}` });
  if (sim < 0.5 && (previous.text.length > 200 || current.text.length > 200)) changes.push({ signal: 'WEBSITE_CHANGE', level: 'HIGH', label: 'Major redesign', subject: 'home', previous: previous.title, current: current.title, detail: `About ${Math.round((1 - sim) * 100)}% of the home page text is new.` });
  else if (sim < 0.8 && !changes.length) changes.push({ signal: null, level: 'MEDIUM', label: 'Content updated', subject: 'home', previous: previous.title, current: current.title, detail: `About ${Math.round((1 - sim) * 100)}% of the home page text changed.` });
  if ((previous.title ?? '') !== (current.title ?? '') && !changes.some((c) => c.subject === 'home')) changes.push({ signal: null, level: 'MEDIUM', label: 'Page title changed', subject: 'title', previous: previous.title, current: current.title, detail: 'The home page title changed.' });
  if (!changes.length) {
    if (previous.copyrightYear !== current.copyrightYear) changes.push({ signal: null, level: 'LOW', label: 'Copyright year', subject: 'copyright', previous: String(previous.copyrightYear ?? ''), current: String(current.copyrightYear ?? ''), detail: 'Only the copyright year changed.' });
    else if (sim < 1) changes.push({ signal: null, level: 'LOW', label: 'Minor wording', subject: 'home', previous: null, current: null, detail: 'Tiny wording or formatting changes.' });
  }
  const rank: Record<ChangeLevel, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  const level = changes.reduce<ChangeLevel>((acc, c) => (rank[c.level] > rank[acc] ? c.level : acc), 'NONE');
  return { level, changes };
}

// ───────────────────────────── rules (screen #9 §22-24, §41) ─────────────────────────────

export interface RuleConditions {
  types?: string[];
  categories?: string[];
  minStrength?: SignalStrengthKey;
  icpLevels?: Level[];
  industries?: string[];
  marketIds?: string[];
  relationships?: Relationship[];
}

export interface RuleSubject {
  type: string;
  category: string;
  strength: SignalStrengthKey;
  icp: Level | null;
  industry: string | null;
  marketIds: string[];
  relationship: Relationship;
}

const STRENGTH_RANK: Record<SignalStrengthKey, number> = { WEAK: 0, MEDIUM: 1, STRONG: 2 };

export function parseRuleConditions(json: unknown): RuleConditions {
  const c = (json ?? {}) as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : undefined);
  const minStrength = typeof c.minStrength === 'string' && SIGNAL_STRENGTHS.includes(c.minStrength as SignalStrengthKey) ? (c.minStrength as SignalStrengthKey) : undefined;
  return {
    types: strings(c.types),
    categories: strings(c.categories),
    minStrength,
    icpLevels: strings(c.icpLevels)?.filter((l): l is Level => ['HIGH', 'MEDIUM', 'LOW'].includes(l)),
    industries: strings(c.industries),
    marketIds: strings(c.marketIds),
    relationships: strings(c.relationships)?.filter((r): r is Relationship => Object.hasOwn(RELATIONSHIP_INFO, r)),
  };
}

/** Every given condition must hold (AND); an empty rule matches everything. */
export function ruleMatches(conditions: RuleConditions, s: RuleSubject): boolean {
  if (conditions.types?.length && !conditions.types.includes(s.type)) return false;
  if (conditions.categories?.length && !conditions.categories.includes(s.category)) return false;
  if (conditions.minStrength && STRENGTH_RANK[s.strength] < STRENGTH_RANK[conditions.minStrength]) return false;
  if (conditions.icpLevels?.length && (!s.icp || !conditions.icpLevels.includes(s.icp))) return false;
  if (conditions.industries?.length && !conditions.industries.some((i) => (s.industry ?? '').toLowerCase().includes(i.toLowerCase()))) return false;
  if (conditions.marketIds?.length && !conditions.marketIds.some((m) => s.marketIds.includes(m))) return false;
  if (conditions.relationships?.length && !conditions.relationships.includes(s.relationship)) return false;
  return true;
}

export function describeRule(conditions: RuleConditions): string {
  const parts: string[] = [];
  if (conditions.types?.length) parts.push(`type is ${conditions.types.map((t) => signalTypeInfo(t)?.label ?? t).join(' / ')}`);
  if (conditions.categories?.length) parts.push(`category is ${conditions.categories.join(' / ')}`);
  if (conditions.minStrength) parts.push(`strength ≥ ${conditions.minStrength.toLowerCase()}`);
  if (conditions.icpLevels?.length) parts.push(`ICP fit ${conditions.icpLevels.join(' / ').toLowerCase()}`);
  if (conditions.industries?.length) parts.push(`industry contains ${conditions.industries.join(' / ')}`);
  if (conditions.marketIds?.length) parts.push(`in ${conditions.marketIds.length} market(s)`);
  if (conditions.relationships?.length) parts.push(`relationship ${conditions.relationships.map((r) => RELATIONSHIP_INFO[r].label.toLowerCase()).join(' / ')}`);
  return parts.length ? `IF ${parts.join(' AND ')}` : 'IF any signal';
}

// ───────────────────────────── API shapes (web ↔ API) ─────────────────────────────

export interface SignalEvidenceView {
  evidenceId: string;
  source: string;
  sourceType: string;
  evidenceType: string;
  url: string | null;
  excerpt: string | null;
  observedAt: string;
  note: string | null;
  trust: SourceTrust;
}

/** One row in the queue / lists. */
export interface SignalRow {
  id: string;
  companyId: string;
  company: string;
  industry: string | null;
  city: string | null;
  type: string;
  typeLabel: string;
  category: SignalCategory;
  title: string;
  fact: string;
  status: SignalStatusKey;
  strength: SignalStrengthKey;
  relevance: Relevance;
  confidence: Level;
  sourceKind: SourceKind;
  relationship: Relationship;
  interpretation: string | null;
  interpretationSource: 'RULE' | 'AI' | null;
  whyNow: string | null;
  recommendedAction: RecommendedAction;
  autoActions: string[];
  campaignCandidate: boolean;
  priority: boolean;
  evidenceCount: number;
  sourceCount: number;
  icp: Level | null;
  detectedAt: string;
  effectiveAt: string;
  lastSeenAt: string;
  expiresAt: string;
  windowEndsAt: string | null;
  windowState: 'ACTIVE' | 'PASSED' | null;
  opportunityId: string | null;
  conversationId: string | null;
  hypothesisId: string | null;
  marketId: string | null;
  actedAction: string | null;
  actedAt: string | null;
  feedback: string | null;
}

export interface SignalDetail extends SignalRow {
  change: { label: string; previous: string[] | string | null; current: string[] | string | null } | null;
  evidence: SignalEvidenceView[];
  hypothesis: { id: string; hypothesis: string; reasonSummary: string; confidence: Level; status: string; source: string } | null;
  opportunity: { id: string; name: string; stage: string; owner: string | null } | null;
  conversation: { id: string; subject: string; contactName: string | null; owner: string | null } | null;
  researchedAt: string | null;
  matchedRules: { id: string; name: string; actions: string[] }[];
  history: { at: string; action: string; actor: string; detail: string | null }[];
  /** Other open signals of the same company (clusters, screen #9 §34). */
  related: { id: string; type: string; typeLabel: string; title: string; strength: SignalStrengthKey; detectedAt: string }[];
}

export interface SignalFunnel {
  observations: number;
  meaningful: number;
  signals: number;
  relevant: number;
  highPriority: number;
  needHuman: number;
}

export interface SignalSourceStatus {
  kind: SourceKind | 'HIRING';
  label: string;
  connected: boolean;
  detail: string;
  signals30d: number;
}

export interface SignalOverview {
  today: SignalRow[];
  priority: SignalRow[];
  funnel: SignalFunnel;
  counts: { open: number; actionable: number; monitor: number; needsVerification: number; windowsActive: number; windowsMissed: number; expired30d: number; dismissed30d: number };
  byType: { type: string; label: string; category: SignalCategory; open: number; total30d: number }[];
  sources: SignalSourceStatus[];
  watched: { companies: number; watchlists: number; dueForCheck: number; lastSweepAt: string | null };
  markets: MarketMonitorRow[];
}

export interface MarketMonitorRow {
  marketId: string;
  name: string;
  tracked: number;
  newToDataset30d: number;
  websiteLaunched30d: number;
  websiteChanges30d: number;
  newServices30d: number;
  followUpsDue30d: number;
  strong: number;
  watched: boolean;
  watchlistId: string | null;
}

export interface WatchlistRow {
  id: string;
  name: string;
  description: string | null;
  kind: WatchlistKind;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  marketId: string | null;
  market: string | null;
  cadenceDays: number;
  members: number;
  openSignals: number;
  dueForCheck: number;
  lastSweepAt: string | null;
  createdAt: string;
}

export interface WatchlistDetail extends WatchlistRow {
  companies: { companyId: string; company: string; industry: string | null; city: string | null; reason: string | null; addedAt: string; lastCheckedAt: string | null; nextCheckAt: string | null; openSignals: number; strongest: SignalStrengthKey | null }[];
}

export interface SignalRuleRow {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleConditions;
  description: string;
  actions: RuleAction[];
  position: number;
  matches: number;
  lastMatchedAt: string | null;
  createdAt: string;
}

export interface CompanySignals {
  open: SignalRow[];
  history: SignalRow[];
  observations: { sourceKind: SourceKind; subject: string; changeLevel: ChangeLevel; detail: string | null; observedAt: string }[];
  watchlists: { id: string; name: string; priority: 'HIGH' | 'NORMAL' | 'LOW' }[];
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
}

export interface SignalListQuery {
  status?: SignalStatusKey | 'OPEN' | 'ALL';
  strength?: SignalStrengthKey;
  type?: string;
  category?: SignalCategory;
  days?: number;
  marketId?: string;
  icp?: Level;
  relationship?: Relationship;
  priority?: boolean;
  campaignCandidate?: boolean;
  companyId?: string;
  q?: string;
}

export interface SignalAnalytics {
  days: number;
  funnel: SignalFunnel;
  outcomes: { detected: number; relevant: number; actedOn: number; conversations: number; meetings: number; opportunities: number; won: number };
  byType: { type: string; label: string; signals: number; actedOn: number; dismissed: number; conversations: number; meetings: number; opportunities: number; won: number }[];
  feedback: { feedback: SignalFeedbackKey; label: string; count: number }[];
  /** Plain-language suggestions from real outcomes ("Website changes rarely led to action — lower their priority?"); a person decides. */
  suggestions: string[];
}

/** "Austin landscapers that added a new service recently" → structured filters, shown back to the person. */
export interface SignalSearchResult {
  query: string;
  filters: SignalListQuery;
  explanation: string[];
  items: SignalRow[];
}
