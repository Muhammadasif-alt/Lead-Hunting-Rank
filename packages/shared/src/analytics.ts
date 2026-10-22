/**
 * Analytics + revenue intelligence (screen #10, docs/04 §45-46, docs/06 §133-146, docs/07 §81-85, docs/17 §111-113).
 * Browser-safe: metric definitions, periods, attribution models, period comparison with small-sample honesty, anomaly
 * baselines and the API shapes shared by the API and the web app.
 *
 * Rules: business outcomes first (revenue, deals, meetings), not vanity counts. Every number is drillable to records.
 * Projections are derived, never the source of truth. Stale data is labelled stale. Unknown cost stays unknown.
 */

export type MetricLevel = 1 | 2 | 3 | 4;
export type MetricUnit = 'COUNT' | 'MONEY' | 'PERCENT' | 'DAYS' | 'HOURS';

export interface MetricDefinition {
  key: string;
  label: string;
  level: MetricLevel;
  unit: MetricUnit;
  definition: string;
  /** How it is counted, in words — shown on click (screen #10 §52). */
  counted: string;
  version: number;
  changedAt: string;
  /** Higher is better (false for cost, cycle time, bounces…). */
  higherIsBetter: boolean;
}

export const METRIC_LEVEL_LABEL: Record<MetricLevel, string> = {
  1: 'Business outcomes',
  2: 'Sales performance',
  3: 'Outreach performance',
  4: 'Operational health',
};

const def = (key: string, label: string, level: MetricLevel, unit: MetricUnit, definition: string, counted: string, higherIsBetter = true): MetricDefinition => ({ key, label, level, unit, definition, counted, version: 1, changedAt: '2026-10-15', higherIsBetter });

export const METRICS = {
  wonRevenue: def('wonRevenue', 'Won revenue', 1, 'MONEY', 'Revenue from won deals plus recorded payments and expansions, minus refunds, in the period.', 'Sum of RevenueEvent amounts by occurredAt (WON + PAYMENT + EXPANSION − REFUND). The WON amount is recorded once per deal.'),
  wonDeals: def('wonDeals', 'Won deals', 1, 'COUNT', 'Opportunities marked won in the period.', 'Opportunities with status WON and closedAt in the period.'),
  openPipeline: def('openPipeline', 'Open pipeline', 1, 'MONEY', 'Estimated value of open opportunities right now.', 'Sum of amountMinor of OPEN opportunities; deals without an estimate are counted separately, never invented.'),
  opportunities: def('opportunities', 'New opportunities', 1, 'COUNT', 'Opportunities created in the period.', 'Opportunities by createdAt.'),
  qualifiedOpportunities: def('qualifiedOpportunities', 'Qualified opportunities', 1, 'COUNT', 'Opportunities whose qualification reached QUALIFIED (need confirmed plus who decides or when).', 'Qualification status QUALIFIED, by the opportunity creation date in the period.'),
  meetingsBooked: def('meetingsBooked', 'Meetings booked', 1, 'COUNT', 'Meetings confirmed by the calendar provider (or explicitly confirmed by a person) in the period.', 'MeetingBooked events by booking time — a proposed slot is not a meeting.'),
  meetingsHeld: def('meetingsHeld', 'Meetings held', 2, 'COUNT', 'Meetings with a recorded outcome other than no-show.', 'MeetingOutcome rows by meeting start in the period.'),
  winRate: def('winRate', 'Win rate', 2, 'PERCENT', 'Won ÷ (won + lost) for deals closed in the period.', 'Closed deals only; open deals do not count against it.'),
  salesCycleDays: def('salesCycleDays', 'Sales cycle', 2, 'DAYS', 'Median days from opportunity creation to won.', 'Median over deals won in the period.', false),
  contacted: def('contacted', 'Prospects contacted', 3, 'COUNT', 'Prospects who received a first campaign message.', 'Distinct enrollments with a SENT first-touch message in the period.'),
  messagesSent: def('messagesSent', 'Messages sent', 3, 'COUNT', 'Campaign messages and conversation replies sent.', 'CampaignMessage SENT + ConversationReply SENT by sentAt.'),
  replies: def('replies', 'Replies', 3, 'COUNT', 'Conversations started by a prospect reply.', 'Conversations by createdAt (auto-replies and bounces are not conversations).'),
  positiveReplies: def('positiveReplies', 'Positive replies', 3, 'COUNT', 'Replies classified as interested, a question, pricing or a meeting request.', 'First classification of the conversation with a positive primary intent.'),
  replyRate: def('replyRate', 'Reply rate', 3, 'PERCENT', 'Replies ÷ prospects contacted.', 'Same period, same cohort filters.'),
  unsubscribes: def('unsubscribes', 'Unsubscribes', 4, 'COUNT', 'Prospects who asked not to be contacted.', 'Suppressions with reason UNSUBSCRIBE in the period.', false),
  bounces: def('bounces', 'Bounces', 4, 'COUNT', 'Messages that bounced.', 'Mailbox messages of kind BOUNCE in the period.', false),
  providerCost: def('providerCost', 'Provider cost', 4, 'MONEY', 'Recorded cost of provider calls (lead data, verification, website reads, embeddings).', 'Sum of ProviderCallRecord.costMinor; calls without a known cost are counted as "unknown cost", not zero.', false),
  aiCost: def('aiCost', 'AI cost', 4, 'MONEY', 'Recorded cost of AI runs.', 'Sum of AiRun.costMinor (estimates labelled); unknown stays unknown.', false),
  costPerMeeting: def('costPerMeeting', 'Cost per meeting', 4, 'MONEY', '(Provider + AI cost) ÷ meetings booked.', 'Only shown when both numbers are known.', false),
  companiesDiscovered: def('companiesDiscovered', 'Companies discovered', 4, 'COUNT', 'Companies first created by Lead Hunter in the period.', 'Company.createdAt for companies with a discovery observation.'),
  verifiedContacts: def('verifiedContacts', 'Verified contacts', 4, 'COUNT', 'Emails whose latest verification is VALID.', 'ContactVerification VALID by verifiedAt.'),
} as const satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

// ───────────────────────────── periods ─────────────────────────────

export const RANGES = ['7d', '30d', '90d', '180d', '365d', 'mtd', 'qtd', 'ytd', 'custom'] as const;
export type RangeKey = (typeof RANGES)[number];
export const RANGE_LABEL: Record<RangeKey, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '180d': 'Last 6 months', '365d': 'Last 12 months', mtd: 'Month to date', qtd: 'Quarter to date', ytd: 'Year to date', custom: 'Custom' };

export interface Period {
  from: string;
  to: string;
  label: string;
}

const DAY_MS = 86_400_000;
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** The selected period and the equally long period right before it (screen #10 §45). `to` is exclusive. */
export function resolvePeriod(range: RangeKey, now = new Date(), custom?: { from?: string; to?: string }): { current: Period; previous: Period } {
  const end = new Date(startOfUtcDay(now).getTime() + DAY_MS);
  let start: Date;
  switch (range) {
    case 'mtd':
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    case 'qtd':
      start = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
      break;
    case 'ytd':
      start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      break;
    case 'custom': {
      const f = custom?.from ? startOfUtcDay(new Date(custom.from)) : new Date(end.getTime() - 30 * DAY_MS);
      const t = custom?.to ? new Date(startOfUtcDay(new Date(custom.to)).getTime() + DAY_MS) : end;
      const len = Math.max(DAY_MS, t.getTime() - f.getTime());
      return {
        current: { from: f.toISOString(), to: t.toISOString(), label: `${f.toISOString().slice(0, 10)} – ${new Date(t.getTime() - DAY_MS).toISOString().slice(0, 10)}` },
        previous: { from: new Date(f.getTime() - len).toISOString(), to: f.toISOString(), label: 'Previous period' },
      };
    }
    default:
      start = new Date(end.getTime() - Number.parseInt(range, 10) * DAY_MS);
  }
  const len = end.getTime() - start.getTime();
  return {
    current: { from: start.toISOString(), to: end.toISOString(), label: RANGE_LABEL[range] },
    previous: { from: new Date(start.getTime() - len).toISOString(), to: start.toISOString(), label: `Previous ${Math.round(len / DAY_MS)} days` },
  };
}

// ───────────────────────────── comparison + anomalies ─────────────────────────────

export interface KpiValue {
  key: MetricKey;
  value: number | null;
  previous: number | null;
  delta: number | null;
  deltaPct: number | null;
  /** Too few observations to read a trend into (screen #10 §45 — "statistically weak"). */
  lowSample: boolean;
  /** better / worse / flat, using the metric's direction; null when not comparable. */
  direction: 'BETTER' | 'WORSE' | 'FLAT' | null;
  /** Some inputs unknown (e.g. costs not reported by a provider). */
  partial?: boolean;
}

export const LOW_SAMPLE = 10;

export function compareKpi(key: MetricKey, value: number | null, previous: number | null, sample?: number): KpiValue {
  const m = METRICS[key];
  if (value === null || previous === null) return { key, value, previous, delta: null, deltaPct: null, lowSample: true, direction: null };
  const delta = value - previous;
  const deltaPct = previous === 0 ? null : Math.round((delta / Math.abs(previous)) * 1000) / 10;
  const n = sample ?? (m.unit === 'COUNT' ? Math.max(value, previous) : LOW_SAMPLE);
  const flat = delta === 0 || (deltaPct !== null && Math.abs(deltaPct) < 5);
  const better = m.higherIsBetter ? delta > 0 : delta < 0;
  return { key, value, previous, delta, deltaPct, lowSample: n < LOW_SAMPLE, direction: flat ? 'FLAT' : better ? 'BETTER' : 'WORSE' };
}

export interface Anomaly {
  metric: MetricKey;
  day: string;
  value: number;
  baseline: number;
  /** Signed deviation in baseline standard deviations. */
  score: number;
  direction: 'SPIKE' | 'DROP';
}

/** Days that sit far outside the trailing baseline (screen #10 §46). Needs ≥ 14 days of history; quiet series never alarm. */
export function detectAnomalies(metric: MetricKey, series: { day: string; value: number }[], opts: { window?: number; threshold?: number; minBaseline?: number } = {}): Anomaly[] {
  const window = opts.window ?? 14;
  const threshold = opts.threshold ?? 3;
  const minBaseline = opts.minBaseline ?? 3;
  const out: Anomaly[] = [];
  for (let i = window; i < series.length; i++) {
    const past = series.slice(i - window, i).map((p) => p.value);
    const mean = past.reduce((a, b) => a + b, 0) / past.length;
    if (mean < minBaseline) continue;
    const sd = Math.sqrt(past.reduce((a, b) => a + (b - mean) ** 2, 0) / past.length) || Math.max(1, mean * 0.1);
    const v = series[i]!.value;
    const score = (v - mean) / sd;
    if (Math.abs(score) >= threshold) out.push({ metric, day: series[i]!.day, value: v, baseline: Math.round(mean * 10) / 10, score: Math.round(score * 10) / 10, direction: score > 0 ? 'SPIKE' : 'DROP' });
  }
  return out;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ───────────────────────────── attribution ─────────────────────────────

export const TOUCH_TYPES = ['MARKET', 'DISCOVERY', 'SIGNAL', 'HYPOTHESIS', 'CAMPAIGN', 'MESSAGE', 'CONVERSATION', 'MEETING', 'REFERRAL', 'HUMAN'] as const;
export type TouchTypeKey = (typeof TOUCH_TYPES)[number];
export const TOUCH_TYPE_LABEL: Record<TouchTypeKey, string> = {
  MARKET: 'Market',
  DISCOVERY: 'Discovery source',
  SIGNAL: 'Signal',
  HYPOTHESIS: 'Opportunity hypothesis',
  CAMPAIGN: 'Campaign',
  MESSAGE: 'Message',
  CONVERSATION: 'Conversation',
  MEETING: 'Meeting',
  REFERRAL: 'Referral',
  HUMAN: 'Added by a person',
};

export const ATTRIBUTION_MODELS = ['FULL', 'FIRST_TOUCH', 'LAST_TOUCH', 'LINEAR'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];
export const ATTRIBUTION_MODEL_INFO: Record<AttributionModel, { label: string; description: string }> = {
  FULL: { label: 'Full credit per dimension', description: 'Each market, campaign, signal… on the path gets the full deal value — answers "which deals did this touch?" (sums can exceed total revenue)' },
  FIRST_TOUCH: { label: 'First touch', description: 'All credit to the earliest touch of each dimension type' },
  LAST_TOUCH: { label: 'Last touch', description: 'All credit to the latest touch before the deal' },
  LINEAR: { label: 'Linear', description: 'Credit split evenly across every touch on the path' },
};

export interface TouchLike {
  touchType: TouchTypeKey;
  sourceId: string;
  label: string;
  occurredAt: string;
}

/** Credit per touch for one deal under a model (minor units, integers that add up to the amount for split models). */
export function attributeDeal(touches: TouchLike[], amountMinor: number, model: AttributionModel): { touch: TouchLike; creditMinor: number }[] {
  if (!touches.length) return [];
  const ordered = [...touches].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  switch (model) {
    case 'FULL':
      return ordered.map((touch) => ({ touch, creditMinor: amountMinor }));
    case 'FIRST_TOUCH':
      return ordered.map((touch, i) => ({ touch, creditMinor: i === 0 ? amountMinor : 0 }));
    case 'LAST_TOUCH':
      return ordered.map((touch, i) => ({ touch, creditMinor: i === ordered.length - 1 ? amountMinor : 0 }));
    case 'LINEAR': {
      const base = Math.floor(amountMinor / ordered.length);
      const rest = amountMinor - base * ordered.length;
      return ordered.map((touch, i) => ({ touch, creditMinor: base + (i < rest ? 1 : 0) }));
    }
  }
}

// ───────────────────────────── funnel ─────────────────────────────

export const FUNNEL_STAGES = ['discovered', 'researched', 'contactable', 'contacted', 'replied', 'positive', 'opportunity', 'qualified', 'meeting', 'won'] as const;
export type FunnelStageKey = (typeof FUNNEL_STAGES)[number];
export const FUNNEL_STAGE_LABEL: Record<FunnelStageKey, string> = {
  discovered: 'Companies discovered',
  researched: 'Researched',
  contactable: 'Verified contact',
  contacted: 'Contacted',
  replied: 'Replied',
  positive: 'Positive reply',
  opportunity: 'Opportunity',
  qualified: 'Qualified',
  meeting: 'Meeting',
  won: 'Won',
};

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  count: number;
  /** Share of the previous stage that reached this one (null for the first). */
  conversion: number | null;
  previousConversion: number | null;
  /** Largest relative drop vs the previous period marks the leak (screen #10 §7). */
  leak: boolean;
}

/** Conversion between consecutive stages and the biggest leak (largest worsening vs previous period, else lowest conversion). */
export function buildFunnel(current: Record<FunnelStageKey, number>, previous?: Record<FunnelStageKey, number>): FunnelStage[] {
  const stages: FunnelStage[] = FUNNEL_STAGES.map((key, i) => {
    const prevKey = FUNNEL_STAGES[i - 1];
    const conv = prevKey && current[prevKey] > 0 ? Math.round((current[key] / current[prevKey]) * 1000) / 10 : null;
    const pconv = prevKey && previous && previous[prevKey] > 0 ? Math.round((previous[key] / previous[prevKey]) * 1000) / 10 : null;
    return { key, label: FUNNEL_STAGE_LABEL[key], count: current[key], conversion: i === 0 ? null : conv, previousConversion: i === 0 ? null : pconv, leak: false };
  });
  const candidates = stages.filter((s) => s.conversion !== null && s.count + (current[FUNNEL_STAGES[FUNNEL_STAGES.indexOf(s.key) - 1]!] ?? 0) >= 5);
  let worst: FunnelStage | undefined;
  const drops = candidates.filter((s) => s.previousConversion !== null && s.conversion! < s.previousConversion!);
  if (drops.length) worst = drops.sort((a, b) => (a.conversion! - a.previousConversion!) / Math.max(1, a.previousConversion!) - (b.conversion! - b.previousConversion!) / Math.max(1, b.previousConversion!))[0];
  else worst = [...candidates].sort((a, b) => a.conversion! - b.conversion!)[0];
  if (worst) worst.leak = true;
  return stages;
}

// ───────────────────────────── freshness ─────────────────────────────

export type FreshnessState = 'CURRENT' | 'DELAYED' | 'STALE' | 'NOT_CONNECTED';

/** A source is current within its expected cadence, delayed up to 3×, stale beyond (screen #10 §51). */
export function freshnessState(lastAt: string | Date | null, expectedMinutes: number, now = new Date(), connected = true): FreshnessState {
  if (!connected) return 'NOT_CONNECTED';
  if (!lastAt) return 'STALE';
  const mins = (now.getTime() - new Date(lastAt).getTime()) / 60_000;
  return mins <= expectedMinutes ? 'CURRENT' : mins <= expectedMinutes * 3 ? 'DELAYED' : 'STALE';
}

// ───────────────────────────── API shapes ─────────────────────────────

export interface AnalyticsFilters {
  range: RangeKey;
  from?: string;
  to?: string;
  marketId?: string;
  industry?: string;
  campaignId?: string;
  ownerId?: string;
}

export interface FreshnessRow {
  source: 'EVENTS' | 'EMAIL' | 'CRM' | 'CALENDAR' | 'REVENUE' | 'PROVIDER_COST' | 'PROJECTIONS';
  label: string;
  state: FreshnessState;
  lastAt: string | null;
  detail: string;
}

export interface RecordRef {
  type: 'COMPANY' | 'OPPORTUNITY' | 'CONVERSATION' | 'CAMPAIGN' | 'MEETING' | 'MARKET' | 'SIGNAL';
  id: string;
  label: string;
  href: string;
  detail?: string;
}

export interface Insight {
  kind: 'BOTTLENECK' | 'ANOMALY' | 'STAGE_AGING' | 'COST' | 'DATA';
  title: string;
  detail: string;
  /** Evidence first: the numbers behind it. */
  evidence: string[];
  records: RecordRef[];
  /** "Investigate" target — a tab + filters or a records drill. */
  drill: { metric: string; filters?: Record<string, string> } | null;
}

export interface AnalyticsOverview {
  period: Period;
  previous: Period;
  outcomes: KpiValue[];
  sales: KpiValue[];
  outreach: KpiValue[];
  operations: KpiValue[];
  /** Deals without an estimated value are counted, never valued (screen #10 honesty). */
  openPipelineUnvalued: number;
  funnel: FunnelStage[];
  insights: Insight[];
  timeline: { week: string; revenueMinor: number; won: number; meetings: number; opportunities: number }[];
  freshness: FreshnessRow[];
  currency: string;
  empty: boolean;
}

export interface AttributionRow {
  key: string;
  label: string;
  revenueMinor: number;
  wonDeals: number;
  opportunities: number;
  pipelineMinor: number;
  meetings: number;
  href: string | null;
}

export interface LineageStep {
  touchType: TouchTypeKey;
  label: string;
  occurredAt: string;
  href: string | null;
  detail: Record<string, unknown>;
}

export interface DealLineage {
  opportunityId: string;
  name: string;
  company: string;
  companyId: string;
  status: string;
  amountMinor: number | null;
  wonAmountMinor: number | null;
  currency: string;
  closedAt: string | null;
  steps: LineageStep[];
  revenue: { id: string; type: string; amountMinor: number; currency: string; occurredAt: string; note: string | null }[];
  /** Human contribution next to the chain — revenue is never credited to one salesperson alone. */
  owner: string | null;
  gaps: string[];
}

export interface AttributionReport {
  model: AttributionModel;
  period: Period;
  totalRevenueMinor: number;
  byDimension: Record<'market' | 'source' | 'signalType' | 'campaign' | 'industry' | 'persona' | 'owner', AttributionRow[]>;
  deals: DealLineage[];
  unattributed: number;
}

export interface MarketEconomicsRow {
  marketId: string;
  name: string;
  companies: number;
  contactable: number;
  contacted: number;
  replies: number;
  positive: number;
  meetings: number;
  opportunities: number;
  won: number;
  revenueMinor: number;
  costMinor: number | null;
  costUnknownCalls: number;
  costPerMeetingMinor: number | null;
  revenuePerCostUnit: number | null;
}

export interface CampaignAnalyticsRow {
  campaignId: string;
  name: string;
  status: string;
  enrolled: number;
  contacted: number;
  sent: number;
  replies: number;
  positive: number;
  unsubscribes: number;
  bounces: number;
  meetings: number;
  opportunities: number;
  won: number;
  revenueMinor: number;
  replyRate: number | null;
  /** Replies by sequence step (screen #10 §21-22 follow-up intelligence / drop-off). */
  steps: { position: number; sent: number; replies: number }[];
}

export interface PipelineAnalytics {
  stages: { semantic: string; label: string; open: number; valueMinor: number; medianAgeDays: number | null; baselineDays: number | null; aging: number }[];
  salesCycleDays: number | null;
  winRate: number | null;
  lostReasons: { reason: string; label: string; count: number; valueMinor: number }[];
  objections: { type: string; label: string; count: number }[];
  aging: RecordRef[];
}

export interface ConversationAnalytics {
  total: number;
  byIntent: { intent: string; label: string; count: number }[];
  medianFirstResponseHours: number | null;
  needsHumanShare: number | null;
  questions: { topic: string; count: number }[];
  knowledgeGaps: { question: string; occurrences: number; status: string }[];
  repliesByAuthor: { author: 'AI' | 'HUMAN'; drafted: number; sent: number; rejected: number }[];
}

export interface SourceQualityRow {
  provider: string;
  label: string;
  observations: number;
  companies: number;
  duplicatesMatched: number;
  withWebsite: number;
  verifiedEmails: number;
  contacted: number;
  meetings: number;
  won: number;
  costMinor: number | null;
}

export interface DataQuality {
  companies: number;
  withWebsite: number;
  researched: number;
  withVerifiedContact: number;
  staleResearch: number;
  openDuplicates: number;
  invalidEmails: number;
}

export interface CostAnalytics {
  totalMinor: number | null;
  providerMinor: number;
  aiMinor: number;
  unknownCostCalls: number;
  estimatedShare: number | null;
  byProvider: { provider: string; capability: string; calls: number; costMinor: number; unknown: number }[];
  byAgent: { agent: string; runs: number; costMinor: number; unknown: number; failed: number }[];
  byMarket: { marketId: string; name: string; costMinor: number }[];
  perMeetingMinor: number | null;
  perWonDealMinor: number | null;
  daily: { day: string; providerMinor: number; aiMinor: number }[];
}

export interface AiContribution {
  repliesSentByAi: number;
  repliesSentByHuman: number;
  draftsEditedByHuman: number;
  draftsRejected: number;
  takeovers: number;
  escalations: number;
  meetingsBookedAfterAiReply: number;
  validatorBlocks: { validator: string; count: number }[];
  agentRuns: { agent: string; label: string; runs: number; succeeded: number; failed: number; blocked: number }[];
  calibration: { confidence: string; decisions: number; laterConfirmed: number | null }[];
}

export interface RevenueAnswer {
  question: string;
  /** Which analysis answered it (REVENUE_SOURCES, COMPARE_MARKETS, LOST_REASONS, SIGNAL_PERFORMANCE, BOTTLENECK, COST_WASTE, CONTACTABILITY, MEETINGS_TREND, UNKNOWN). */
  intent: string;
  period: Period;
  observed: { label: string; value: string; change?: string }[];
  primaryChange: string | null;
  evidence: string[];
  records: RecordRef[];
  recommendation: string | null;
  /** When the question could not be mapped: what it can answer instead. */
  suggestions: string[];
}

export interface DrillResult {
  metric: string;
  label: string;
  period: Period;
  total: number;
  records: RecordRef[];
}

export interface AnalyticsViewRow {
  id: string;
  name: string;
  tab: string;
  filters: AnalyticsFilters;
  shared: boolean;
  mine: boolean;
  createdAt: string;
}

export interface RevenueEventRow {
  id: string;
  opportunityId: string;
  opportunity: string;
  companyId: string;
  company: string;
  type: 'WON' | 'PAYMENT' | 'EXPANSION' | 'REFUND';
  amountMinor: number;
  currency: string;
  occurredAt: string;
  note: string | null;
  createdBy: string | null;
}
