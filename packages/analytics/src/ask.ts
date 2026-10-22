import type { PrismaClient } from '@revenue-os/database';
import { FUNNEL_STAGES, type AnalyticsFilters, type RecordRef, type RevenueAnswer } from '@revenue-os/shared';
import { HREF } from './deps.js';
import { costs, markets, pipeline, sources } from './economics.js';
import { attributionReport, overview, workspaceCurrency } from './overview.js';
import { resolveScope } from './scope.js';
import { windowMetrics } from './metrics.js';

export const ASK_INTENTS = ['SIGNAL_PERFORMANCE', 'LOST_REASONS', 'COST_WASTE', 'CONTACTABILITY', 'MEETINGS_TREND', 'BOTTLENECK', 'COMPARE_MARKETS', 'REVENUE_SOURCES'] as const;
export type AskIntent = (typeof ASK_INTENTS)[number] | 'UNKNOWN';

/** Keyword routes, most specific first (English + Roman Urdu). */
const ROUTES: [AskIntent, RegExp][] = [
  ['SIGNAL_PERFORMANCE', /\bsignals?\b|\bintent\b|why[- ]now/i],
  ['LOST_REASONS', /\blos[et]\b|\blosing\b|\bhaar\b|\bhaare?\b|\bharay?\b|lost deals?|\bchurn\b|deals? kyun/i],
  ['COST_WASTE', /\bcosts?\b|\bspend\b|\bspent\b|\bwaste\b|\bkharch\b|\bkharcha\b|\bpaisa\b|\bpaise\b|expensive|\bbudget\b|\broi\b/i],
  ['CONTACTABILITY', /contactable|verified (?:email|contact)|\bemails? (?:found|valid|verify)|contact rate|\bbounce/i],
  ['MEETINGS_TREND', /\bmeetings?\b|\bcalls? booked\b|\bmulaqat\b/i],
  ['BOTTLENECK', /bottleneck|\bleak\b|\bstuck\b|\bruk\b|\bfunnel\b|\bdrop[- ]?off\b|where .*drop|kahan .*ruk/i],
  ['COMPARE_MARKETS', /\bcompare\b|\bvs\.?\b|\bversus\b|\bmuqabla\b|which market|best market|markets? (?:better|best|perform)|\bmarkets?\b/i],
  ['REVENUE_SOURCES', /\brevenue\b|kahan se|where .*(?:come|coming)|\bsource\b|\bsources\b|attribution|\bwon\b|\bdeals? from\b|\bkamai\b|\baamdani\b/i],
];

export function routeQuestion(q: string): AskIntent {
  for (const [intent, re] of ROUTES) if (re.test(q)) return intent;
  return 'UNKNOWN';
}

export const ASK_SUGGESTIONS = [
  'Where is our revenue coming from?',
  'Compare our markets',
  'Why are we losing deals?',
  'Which signals lead to deals?',
  'Where is the funnel leaking?',
  'Where are we wasting cost?',
  'How many companies are contactable?',
  'Are meetings down?',
];

const fmtMoney = (minor: number | null, currency: string) => (minor == null ? 'unknown' : `${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`);
const change = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 'no change' : `new (was 0)`) : `${cur >= prev ? '+' : '−'}${Math.abs(Math.round(((cur - prev) / prev) * 1000) / 10)}% vs previous period`);

/**
 * "Ask your revenue data" (screen #10 §47-49): a deterministic router maps the question to one of the analyses and
 * answers with observed numbers, the change, the evidence and the records — a recommendation is phrased as something to
 * investigate. No LLM; an unmapped question gets the questions it can answer.
 */
export async function ask(db: PrismaClient, workspaceId: string, question: string, filters: AnalyticsFilters, now = new Date()): Promise<RevenueAnswer> {
  const intent = routeQuestion(question);
  const s = await resolveScope(db, workspaceId, filters, now);
  const currency = await workspaceCurrency(db, workspaceId);
  const base = { question, intent, period: s.period, observed: [] as RevenueAnswer['observed'], primaryChange: null as string | null, evidence: [] as string[], records: [] as RecordRef[], recommendation: null as string | null, suggestions: [] as string[] };

  switch (intent) {
    case 'REVENUE_SOURCES': {
      const [rep, prev] = await Promise.all([attributionReport(db, workspaceId, filters, 'FULL', now), windowMetrics(db, s, s.prevFrom, s.prevTo)]);
      const top = (k: keyof typeof rep.byDimension) => rep.byDimension[k].filter((r) => r.revenueMinor > 0)[0];
      const market = top('market');
      const source = top('source');
      const campaign = top('campaign');
      base.observed.push({ label: 'Revenue in period', value: fmtMoney(rep.totalRevenueMinor, currency), change: change(rep.totalRevenueMinor, prev.wonRevenue) });
      if (market) base.observed.push({ label: 'Top market', value: `${market.label} — ${fmtMoney(market.revenueMinor, currency)}` });
      if (source) base.observed.push({ label: 'Top discovery source', value: `${source.label} — ${fmtMoney(source.revenueMinor, currency)}` });
      if (campaign) base.observed.push({ label: 'Top campaign', value: `${campaign.label} — ${fmtMoney(campaign.revenueMinor, currency)}` });
      base.primaryChange = rep.totalRevenueMinor || prev.wonRevenue ? `Revenue ${change(rep.totalRevenueMinor, prev.wonRevenue)}` : null;
      base.evidence = [`${rep.deals.length} deal(s) with revenue in the period`, `${rep.unattributed} won deal(s) without a recorded acquisition chain`, ...rep.deals.slice(0, 5).map((d) => `${d.name} (${d.company}): ${d.steps.map((st) => st.touchType.toLowerCase()).join(' → ') || 'no touches'}`)];
      base.records = [...rep.deals.slice(0, 10).map((d): RecordRef => ({ type: 'OPPORTUNITY', id: d.opportunityId, label: d.name, href: HREF.opportunity(d.opportunityId), detail: d.company })), ...(market ? [{ type: 'MARKET' as const, id: market.key, label: market.label, href: HREF.market(market.key) }] : [])];
      base.recommendation = rep.deals.length ? `Investigate what ${market?.label ?? source?.label ?? 'the top source'} has in common across these deals before shifting effort — full credit per dimension means sums can exceed total revenue.` : 'No revenue recorded in this period yet — widen the range or record won amounts on closed deals.';
      break;
    }
    case 'COMPARE_MARKETS': {
      const rows = await markets(db, workspaceId, filters, now);
      for (const m of rows.slice(0, 5)) base.observed.push({ label: m.name, value: `${m.companies} companies · ${m.meetings} meetings · ${m.won} won · ${fmtMoney(m.revenueMinor, currency)}${m.costMinor !== null ? ` · cost ${fmtMoney(m.costMinor, currency)}` : ''}` });
      base.evidence = rows.slice(0, 5).map((m) => `${m.name}: contactable ${m.contactable}/${m.companies}, replies ${m.replies}, positive ${m.positive}${m.costUnknownCalls ? `, ${m.costUnknownCalls} call(s) with unknown cost` : ''}`);
      base.records = rows.slice(0, 10).map((m) => ({ type: 'MARKET', id: m.marketId, label: m.name, href: HREF.market(m.marketId) }));
      base.primaryChange = rows[0] && rows[0].revenueMinor > 0 ? `${rows[0].name} leads on revenue` : null;
      base.recommendation = rows.length > 1 ? 'Investigate the conversion step where the weaker markets fall behind (contactable → replies → meetings) before moving budget.' : rows.length ? 'Only one market has data — comparison needs a second market.' : 'No markets yet.';
      break;
    }
    case 'LOST_REASONS': {
      const p = await pipeline(db, workspaceId, filters, now);
      const lost = p.lostReasons.reduce((a, r) => a + r.count, 0);
      base.observed.push({ label: 'Deals lost in period', value: String(lost) }, { label: 'Win rate', value: p.winRate === null ? 'no closed deals' : `${p.winRate}%` });
      for (const r of p.lostReasons.slice(0, 5)) base.observed.push({ label: r.label, value: `${r.count} deal(s) · ${fmtMoney(r.valueMinor, currency)}` });
      base.evidence = p.objections.slice(0, 5).map((o) => `Objection "${o.label}" raised ${o.count}×`);
      base.primaryChange = p.lostReasons[0] ? `Most common reason: ${p.lostReasons[0].label}` : null;
      base.recommendation = p.lostReasons[0] ? `Investigate the deals lost to "${p.lostReasons[0].label}" — read their conversations for the moment it turned.` : 'No lost deals with a reason in this period.';
      break;
    }
    case 'SIGNAL_PERFORMANCE': {
      const [rep, signals] = await Promise.all([attributionReport(db, workspaceId, filters, 'FULL', now), db.signal.groupBy({ by: ['type'], where: { workspaceId, detectedAt: { gte: s.from, lt: s.to }, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}) }, _count: { _all: true } })]);
      for (const r of rep.byDimension.signalType.slice(0, 5)) base.observed.push({ label: r.label, value: `${r.opportunities} new deal(s) · ${r.wonDeals} won · ${fmtMoney(r.revenueMinor, currency)}` });
      base.evidence = signals.sort((a, b) => b._count._all - a._count._all).slice(0, 5).map((g) => `${g.type}: ${g._count._all} signal(s) detected in the period`);
      base.primaryChange = rep.byDimension.signalType[0] ? `${rep.byDimension.signalType[0].label} appears on the most valuable deals` : null;
      base.recommendation = rep.byDimension.signalType.length ? 'Investigate whether these signal types preceded the deal or were found after first contact — the lineage shows the order.' : 'No signal appears on a deal’s path yet.';
      break;
    }
    case 'BOTTLENECK': {
      const o = await overview(db, workspaceId, filters, now);
      const leak = o.funnel.find((f) => f.leak);
      for (const f of o.funnel) base.observed.push({ label: f.label, value: String(f.count), ...(f.conversion !== null ? { change: `${f.conversion}% from previous stage${f.previousConversion !== null ? ` (was ${f.previousConversion}%)` : ''}` } : {}) });
      const ins = o.insights.find((i) => i.kind === 'BOTTLENECK');
      base.primaryChange = ins?.title ?? null;
      base.evidence = ins?.evidence ?? ['Not enough funnel volume to name a leak (needs at least 5 companies around a stage)'];
      if (leak) {
        const i = FUNNEL_STAGES.indexOf(leak.key);
        base.recommendation = `Investigate the companies that reached "${o.funnel[i - 1]!.label}" but not "${leak.label}".`;
      }
      break;
    }
    case 'COST_WASTE': {
      const c = await costs(db, workspaceId, filters, now);
      base.observed.push({ label: 'Total recorded cost', value: fmtMoney(c.totalMinor, currency) }, { label: 'Unknown-cost calls', value: String(c.unknownCostCalls) }, { label: 'Cost per meeting', value: c.perMeetingMinor === null ? 'not known' : fmtMoney(c.perMeetingMinor, currency) });
      base.evidence = [...c.byProvider.slice(0, 5).map((p) => `${p.provider} ${p.capability}: ${p.calls} call(s), ${fmtMoney(p.costMinor, currency)}${p.unknown ? `, ${p.unknown} unknown` : ''}`), ...c.byAgent.slice(0, 3).map((a) => `${a.agent}: ${a.runs} run(s), ${fmtMoney(a.costMinor, currency)}, ${a.failed} failed`)];
      base.primaryChange = c.byProvider[0] ? `${c.byProvider[0].provider} is the largest cost line` : null;
      base.recommendation = c.unknownCostCalls ? 'Part of the cost is unknown — investigate which providers do not report cost before judging waste.' : c.byProvider[0] ? `Investigate whether ${c.byProvider[0].provider} calls lead to contacted companies and meetings (Markets & sources tab).` : null;
      break;
    }
    case 'CONTACTABILITY': {
      const src = await sources(db, workspaceId, filters, now);
      const q = src.quality;
      base.observed.push({ label: 'Companies', value: String(q.companies) }, { label: 'With a verified contact', value: `${q.withVerifiedContact}${q.companies ? ` (${Math.round((q.withVerifiedContact / q.companies) * 1000) / 10}%)` : ''}` }, { label: 'With a website', value: String(q.withWebsite) }, { label: 'Invalid emails', value: String(q.invalidEmails) });
      base.evidence = src.providers.slice(0, 5).map((p) => `${p.label}: ${p.companies} companies, ${p.verifiedEmails} with a verified email`);
      base.recommendation = q.companies && q.withVerifiedContact / q.companies < 0.3 ? 'Investigate which sources bring companies without findable contacts — compare verified-email share per source.' : null;
      break;
    }
    case 'MEETINGS_TREND': {
      const [cur, prev] = await Promise.all([windowMetrics(db, s, s.from, s.to), windowMetrics(db, s, s.prevFrom, s.prevTo)]);
      base.observed.push({ label: 'Meetings booked', value: String(cur.meetingsBooked), change: change(cur.meetingsBooked, prev.meetingsBooked) }, { label: 'Positive replies', value: String(cur.positiveReplies), change: change(cur.positiveReplies, prev.positiveReplies) }, { label: 'Replies', value: String(cur.replies), change: change(cur.replies, prev.replies) });
      base.primaryChange = `Meetings ${change(cur.meetingsBooked, prev.meetingsBooked)}`;
      base.evidence = [`Contacted: ${cur.contacted} (previous ${prev.contacted})`, `Meetings held: ${cur.meetingsHeld} (previous ${prev.meetingsHeld})`, ...(Math.max(cur.meetingsBooked, prev.meetingsBooked) < 10 ? ['Fewer than 10 meetings — too few to read a trend into'] : [])];
      const recent = await db.meeting.findMany({ where: { workspaceId, bookedAt: { gte: s.from, lt: s.to }, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}) }, orderBy: { bookedAt: 'desc' }, take: 10, select: { id: true, title: true, status: true } });
      base.records = recent.map((m) => ({ type: 'MEETING', id: m.id, label: m.title, href: HREF.meeting(m.id), detail: m.status.toLowerCase() }));
      base.recommendation = cur.meetingsBooked < prev.meetingsBooked ? (cur.positiveReplies < prev.positiveReplies ? 'Positive replies fell too — investigate outreach volume and reply quality first.' : 'Positive replies held up — investigate scheduling: offered slots, response time, calendar availability.') : null;
      break;
    }
    default:
      base.suggestions = ASK_SUGGESTIONS;
  }
  return base;
}
