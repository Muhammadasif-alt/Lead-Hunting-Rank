import { writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { classifyWebsiteChange, OPEN_SIGNAL_STATUSES, roleRelevance, SIGNAL_TYPES, type SignalDetectJobData, type SourceKind } from '@revenue-os/shared';
import { ensureEvidenceTx, recordObservationTx } from './context.js';
import { day, expansionCluster, isComeBackRequest, negativeAboutSolution, pageStateOf, typeLabel } from './detect-rules.js';
import { DAY, nowOf, systemCtx, TX, type SignalDeps } from './deps.js';
import { recordSignal, type RecordedSignal, type SignalInput } from './engine.js';

export interface DetectResult {
  source: SignalDetectJobData['source'];
  skipped?: string;
  observations: number;
  created: number;
  merged: number;
  signalIds: string[];
}

/**
 * Detects signals from one source event (docs/17 §106-110). Every comparison is counted as an observation; only
 * meaningful changes become signals, and the same event seen again merges into its signal. Idempotent: evidence is
 * recorded once per source record, observations once per subject + time, and a repeat merges nothing new.
 * Nothing here contacts anyone or creates an external action.
 */
export async function detectSignals(deps: SignalDeps, job: Pick<SignalDetectJobData, 'workspaceId' | 'companyId' | 'source' | 'refId'>): Promise<DetectResult> {
  const ctx = systemCtx(job.workspaceId);
  const now = nowOf(deps);
  const out: DetectResult = { source: job.source, observations: 0, created: 0, merged: 0, signalIds: [] };
  const companyId = await deps.db.$transaction(async (tx) => {
    const d = new Detection(tx, ctx, now, out);
    switch (job.source) {
      case 'RESEARCH':
        return d.research(job.refId);
      case 'CONVERSATION':
        return d.conversation(job.refId);
      case 'COMMITMENT':
        return d.commitment(job.refId);
      case 'PIPELINE':
        return d.pipeline(job.refId);
      case 'DISCOVERY':
        return d.discovery(job.refId, job.companyId ?? null);
      case 'CRM':
        return d.employment(job.refId);
      default:
        out.skipped = 'UNKNOWN_SOURCE';
        return null;
    }
  }, TX);
  if (companyId && out.created) await deps.db.$transaction((tx) => new Detection(tx, ctx, now, out).cluster(companyId), TX);
  return out;
}

class Detection {
  constructor(
    private readonly tx: Tx,
    private readonly ctx: ServiceContext,
    private readonly now: Date,
    private readonly out: DetectResult,
  ) {}

  private get ws() {
    return this.ctx.workspaceId;
  }

  private skip(reason: string) {
    this.out.skipped = reason;
    return null;
  }

  private async observe(companyId: string, sourceKind: SourceKind, subject: string, changeLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH', detail: string | null, observedAt: Date, signalId?: string | null) {
    await recordObservationTx(this.tx, this.ctx, { companyId, sourceKind, subject, changeLevel, detail, observedAt, signalId });
    this.out.observations++;
  }

  private async signal(input: Omit<SignalInput, 'now'>): Promise<RecordedSignal> {
    const r = await recordSignal(this.tx, this.ctx, { ...input, now: this.now });
    if (r.outcome === 'CREATED') this.out.created++;
    if (r.outcome === 'MERGED') this.out.merged++;
    if (!this.out.signalIds.includes(r.signal.id)) this.out.signalIds.push(r.signal.id);
    return r;
  }

  // ───────────────────────────── website (research rerun diff) ─────────────────────────────

  /** This run's home page vs the previous run's (screen #9 §5-6); first research is the baseline only. */
  async research(runId: string): Promise<string | null> {
    const run = await this.tx.researchRun.findFirst({ where: { id: runId, workspaceId: this.ws } });
    if (!run) return this.skip('NOT_FOUND');
    if (run.status !== 'COMPLETED' && run.status !== 'PARTIAL') return this.skip('NOT_FINISHED');
    const company = await this.tx.company.findUniqueOrThrow({ where: { id: run.companyId } });
    const finishedAt = run.completedAt ?? run.updatedAt;
    const prev = await this.tx.researchRun.findFirst({
      where: { workspaceId: this.ws, companyId: run.companyId, id: { not: run.id }, status: { in: ['COMPLETED', 'PARTIAL'] }, createdAt: { lt: run.createdAt } },
      orderBy: { createdAt: 'desc' },
    });
    const home = (researchRunId: string) => this.tx.websiteSnapshot.findFirst({ where: { workspaceId: this.ws, researchRunId, pageType: 'HOME' }, orderBy: { fetchedAt: 'desc' } });
    const failure = (r: { startedAt: Date | null; createdAt: Date; completedAt: Date | null; updatedAt: Date }) =>
      this.tx.evidence.findFirst({ where: { workspaceId: this.ws, entityType: 'COMPANY', entityId: run.companyId, evidenceType: 'WEBSITE_CHECK', createdAt: { gte: r.startedAt ?? r.createdAt, lte: r.completedAt ?? r.updatedAt } }, orderBy: { createdAt: 'desc' } });
    const current = await home(run.id);
    const currentFailure = current ? null : await failure(run);
    const subjectAt = current?.fetchedAt ?? currentFailure?.observedAt ?? finishedAt;
    const domain = company.websiteDomain ?? 'website';

    if (!prev) {
      await this.observe(company.id, 'WEBSITE', 'website:home', 'NONE', 'Baseline — first research of this company', subjectAt);
      return company.id;
    }
    const before = await home(prev.id);
    const beforeFailure = before ? null : await failure(prev);

    // Availability changes: a negative signal (recheck, never a reason to contact) or the site back again.
    if (!current && currentFailure && before) {
      await this.websiteStatus(company.id, 'WEBSITE_DOWN', `The website ${domain} did not load at the latest check (${day(currentFailure.observedAt)}); it loaded at the previous check.`, currentFailure.id, domain, currentFailure.observedAt, { label: 'Website unavailable', previous: 'Loaded', current: currentFailure.contentExcerpt ?? 'Did not load' });
      return company.id;
    }
    if (current && !before && beforeFailure) {
      await this.websiteStatus(company.id, 'WEBSITE_BACK', `The website ${domain} loads again (${day(current.fetchedAt)}); it did not load at the previous check.`, current.evidenceId, domain, current.fetchedAt, { label: 'Website back online', previous: 'Did not load', current: 'Loads' });
      return company.id;
    }
    if (current && !before && !beforeFailure) {
      // The previous research had no website to read: the business now has one.
      const invalidated = await this.tx.opportunityHypothesis.findFirst({ where: { workspaceId: this.ws, companyId: company.id, key: 'NO_WEBSITE', status: 'INVALIDATED' }, select: { id: true } });
      const fact = `A website (${domain}) is now on record and loads (${day(current.fetchedAt)}); the previous research found no website.${invalidated ? ' The earlier "no website" hypothesis no longer holds.' : ''}`;
      await this.websiteStatus(company.id, 'WEBSITE_LAUNCHED', fact, current.evidenceId, domain, current.fetchedAt, { label: 'Website launched', previous: 'No website', current: domain });
      return company.id;
    }
    if (!current || !before) {
      await this.observe(company.id, 'WEBSITE', 'website:home', 'NONE', 'Nothing to compare — the home page was not read in both checks', subjectAt);
      return company.id;
    }

    const audit = (researchRunId: string) => this.tx.websiteAudit.findFirst({ where: { workspaceId: this.ws, researchRunId }, orderBy: { performedAt: 'desc' } });
    const [a1, a2] = [await audit(prev.id), await audit(run.id)];
    const prevState = pageStateOf(before, a1);
    const currState = pageStateOf(current, a2);
    const { changes } = classifyWebsiteChange(prevState, currState);
    if (!changes.length) {
      await this.observe(company.id, 'WEBSITE', 'website:home', 'NONE', current.contentHash === before.contentHash ? 'Home page unchanged' : 'No meaningful change', current.fetchedAt);
      return company.id;
    }
    // A booking tool that is gone after a "no booking" hypothesis was invalidated — or the reverse — is in the fact.
    const bookingHypothesis = await this.tx.opportunityHypothesis.findFirst({ where: { workspaceId: this.ws, companyId: company.id, key: { in: ['NO_ONLINE_BOOKING', 'NO_BOOKING'] }, status: 'INVALIDATED', updatedAt: { gte: run.startedAt ?? run.createdAt } }, select: { id: true } });
    for (const ch of changes) {
      let signalId: string | null = null;
      if (ch.signal && current.evidenceId) {
        const subject = ch.subject;
        const title = ch.signal === 'NEW_SERVICE' ? `New service on the website: "${ch.subject}"` : ch.label;
        const extra = ch.subject === 'booking' && bookingHypothesis ? ' The earlier "no online booking" hypothesis no longer holds.' : '';
        const evidence = [{ evidenceId: current.evidenceId, source: domain, note: 'Latest check', observedAt: current.fetchedAt }];
        if (before.evidenceId) evidence.push({ evidenceId: before.evidenceId, source: domain, note: 'Previous check', observedAt: before.fetchedAt });
        const r = await this.signal({
          companyId: company.id,
          type: ch.signal,
          subject,
          title,
          fact: `${ch.detail} (official website ${domain}, checked ${day(current.fetchedAt)} vs ${day(before.fetchedAt)}).${extra}`,
          sourceKind: 'WEBSITE',
          evidence,
          change: { label: ch.label, previous: ch.previous, current: ch.current },
          confidence: 'HIGH',
        });
        signalId = r.signal.id;
      }
      await this.observe(company.id, 'WEBSITE', `website:${ch.label.toLowerCase().replace(/\s+/g, '-')}:${ch.subject}`, ch.level, ch.detail, current.fetchedAt, signalId);
    }
    return company.id;
  }

  private async websiteStatus(companyId: string, type: 'WEBSITE_DOWN' | 'WEBSITE_BACK' | 'WEBSITE_LAUNCHED', fact: string, evidenceId: string | null, domain: string, at: Date, change: { label: string; previous: string; current: string }) {
    let signalId: string | null = null;
    if (evidenceId) {
      const r = await this.signal({ companyId, type, subject: 'website', title: SIGNAL_TYPES[type].label, fact, sourceKind: 'WEBSITE', evidence: [{ evidenceId, source: domain, observedAt: at }], change, confidence: type === 'WEBSITE_DOWN' ? 'MEDIUM' : 'HIGH' });
      signalId = r.signal.id;
    }
    await this.observe(companyId, 'WEBSITE', 'website:availability', type === 'WEBSITE_BACK' ? 'LOW' : 'HIGH', fact, at, signalId);
  }

  // ───────────────────────────── conversation (first-party, screen #9 §28) ─────────────────────────────

  /** What the prospect said in one inbound message: pricing, a meeting, a timeline, an unhappy current provider, a stakeholder. */
  async conversation(messageId: string): Promise<string | null> {
    const msg = await this.tx.conversationMessage.findFirst({ where: { id: messageId, workspaceId: this.ws }, include: { conversation: true, classification: true } });
    if (!msg) return this.skip('NOT_FOUND');
    if (msg.direction !== 'INBOUND') return this.skip('NOT_INBOUND');
    const conv = msg.conversation;
    const cls = msg.classification;
    if (!cls) return this.skip('NOT_CLASSIFIED');
    const intents = [cls.primaryIntent, ...cls.secondaryIntents];
    if (['UNSUBSCRIBE', 'OUT_OF_OFFICE', 'AUTOMATED'].includes(cls.primaryIntent)) {
      await this.observe(conv.companyId, 'CONVERSATION', `message:${msg.id}`, 'NONE', `Not a buying signal (${cls.primaryIntent.toLowerCase().replace(/_/g, ' ')})`, msg.occurredAt);
      return conv.companyId;
    }
    const extractions = await this.tx.extractionCandidate.findMany({ where: { workspaceId: this.ws, messageId: msg.id, status: { not: 'REJECTED' } } });
    const who = conv.contactName ?? conv.email;
    const excerpt = (q: string) => q.replace(/\s+/g, ' ').trim().slice(0, 300);
    const evidence = async (quote: string, key: string) => {
      const id = await ensureEvidenceTx(this.tx, this.ctx, { companyId: conv.companyId, ref: `conversation-message/${msg.id}/${key}`, evidenceType: 'CONVERSATION_MESSAGE', sourceType: 'CONVERSATION', sourceName: 'Conversation', excerpt: `${who}: "${excerpt(quote)}"`, observedAt: msg.occurredAt });
      return [{ evidenceId: id, source: 'conversation', observedAt: msg.occurredAt }];
    };
    const base = { companyId: conv.companyId, sourceKind: 'CONVERSATION' as const, conversationId: conv.id, personId: conv.personId, opportunityId: conv.opportunityId, confidence: cls.confidence };
    const found: string[] = [];
    const firstSentence = (re: RegExp) => msg.text.split(/(?<=[.!?])\s+/).find((s) => re.test(s)) ?? cls.questions[0] ?? cls.summary ?? msg.text;

    if (intents.includes('PRICING')) {
      const q = firstSentence(/\b(price|pricing|cost|quote|how much|budget|rates?)\b/i);
      await this.signal({ ...base, type: 'PRICING_ASKED', subject: `conversation:${conv.id}`, title: `${who} asked about pricing`, fact: `${who} asked about pricing: "${excerpt(q)}"`, evidence: await evidence(q, 'pricing') });
      found.push('pricing');
    }
    if (intents.includes('MEETING_REQUEST')) {
      const q = firstSentence(/\b(call|meet|meeting|chat|talk|available|availability|schedule|demo)\b/i);
      await this.signal({ ...base, type: 'MEETING_ASKED', subject: `conversation:${conv.id}`, title: `${who} asked for a meeting`, fact: `${who} asked for a call or meeting: "${excerpt(q)}"`, evidence: await evidence(q, 'meeting') });
      found.push('meeting');
    }
    for (const e of extractions) {
      if (e.field === 'TIMELINE') {
        await this.signal({ ...base, type: 'TIMELINE_STATED', subject: `conversation:${conv.id}`, title: `Timeline: ${e.value}`.slice(0, 200), fact: `${who} stated a timeline: "${excerpt(e.quote)}"`, evidence: await evidence(e.quote, `timeline:${e.id}`) });
        found.push('timeline');
      } else if (e.field === 'CURRENT_SOLUTION' && negativeAboutSolution(e.quote)) {
        await this.signal({ ...base, type: 'CURRENT_SOLUTION_ISSUE', subject: `conversation:${conv.id}`, title: `Unhappy with current solution: ${e.value}`.slice(0, 200), fact: `${who} said about their current solution: "${excerpt(e.quote)}"`, evidence: await evidence(e.quote, `solution:${e.id}`) });
        found.push('current-solution');
      } else if (e.field === 'REFERRAL') {
        await this.signal({ ...base, type: 'STAKEHOLDER_MENTIONED', subject: `stakeholder:${e.value.toLowerCase().slice(0, 80)}`, title: `Mentioned ${e.value}`.slice(0, 200), fact: `${who} mentioned another person: "${excerpt(e.quote)}"`, evidence: await evidence(e.quote, `referral:${e.id}`) });
        found.push('stakeholder');
      }
    }
    // Months of silence, then a message: the relationship is warm again.
    const prevInbound = await this.tx.conversationMessage.findFirst({ where: { workspaceId: this.ws, direction: 'INBOUND', id: { not: msg.id }, occurredAt: { lt: msg.occurredAt }, conversation: { companyId: conv.companyId } }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } });
    if (prevInbound && msg.occurredAt.getTime() - prevInbound.occurredAt.getTime() > 120 * DAY) {
      const months = Math.round((msg.occurredAt.getTime() - prevInbound.occurredAt.getTime()) / (30 * DAY));
      await this.signal({ ...base, type: 'DORMANT_REENGAGED', subject: `conversation:${conv.id}`, title: `${who} replied after ${months} months`, fact: `${who} wrote again after ${months} months of silence (last message ${day(prevInbound.occurredAt)}): "${excerpt(cls.summary || msg.text)}"`, evidence: await evidence(msg.text.slice(0, 300), 'reengaged') });
      found.push('dormant');
    }
    await this.observe(conv.companyId, 'CONVERSATION', `message:${msg.id}`, found.length ? 'HIGH' : 'NONE', found.length ? `First-party: ${found.join(', ')}` : 'No buying signal in this message', msg.occurredAt, this.out.signalIds[0] ?? null);
    return conv.companyId;
  }

  // ───────────────────────────── commitments (contact later) ─────────────────────────────

  /** "Contact me after the busy season" reached its date (screen #9 §35): a request, with a 7-day window. */
  async commitment(commitmentId: string): Promise<string | null> {
    const c = await this.tx.commitment.findFirst({ where: { id: commitmentId, workspaceId: this.ws } });
    if (!c) return this.skip('NOT_FOUND');
    if (!['OPEN', 'WAITING', 'DUE'].includes(c.status) || !c.dueAt || c.dueAt > this.now) return this.skip('NOT_DUE');
    let comeBack = isComeBackRequest(`${c.title} ${c.detail ?? ''} ${c.quote ?? ''}`);
    if (!comeBack && c.sourceType === 'MESSAGE' && c.sourceId) {
      comeBack = (await this.tx.extractionCandidate.count({ where: { workspaceId: this.ws, messageId: c.sourceId, field: { in: ['CONTACT_LATER', 'RETURN_DATE'] } } })) > 0;
    }
    if (!comeBack) {
      await this.observe(c.companyId, 'COMMITMENT', `commitment:${c.id}`, 'NONE', 'A promise fell due — not a request to come back later', c.dueAt);
      return c.companyId;
    }
    const said = c.quote ?? c.title;
    const evidenceId = await ensureEvidenceTx(this.tx, this.ctx, { companyId: c.companyId, ref: `commitment/${c.id}`, evidenceType: 'COMMITMENT', sourceType: 'COMMITMENT', sourceName: 'Commitment', excerpt: `${c.title}${c.quote ? ` — "${c.quote}"` : ''} (due ${day(c.dueAt)})`, observedAt: c.createdAt });
    const r = await this.signal({
      companyId: c.companyId,
      type: 'CONTACT_LATER_DUE',
      subject: `commitment:${c.id}`,
      title: `Follow-up date reached: ${c.title}`.slice(0, 200),
      fact: `asked on ${day(c.createdAt)} to be contacted around ${day(c.dueAt)}: "${said.slice(0, 200)}"`,
      sourceKind: 'COMMITMENT',
      evidence: [{ evidenceId, source: 'commitment', observedAt: c.createdAt }],
      effectiveAt: c.dueAt,
      commitmentId: c.id,
      conversationId: c.conversationId,
      opportunityId: c.opportunityId,
      personId: c.personId,
    });
    await this.observe(c.companyId, 'COMMITMENT', `commitment:${c.id}`, 'HIGH', 'Contact-later date reached', c.dueAt, r.signal.id);
    return c.companyId;
  }

  // ───────────────────────────── pipeline ─────────────────────────────

  /** A lost deal is watched for timing; its revisit date opens a signal from the sweep, not now. */
  async pipeline(opportunityId: string): Promise<string | null> {
    const opp = await this.tx.opportunity.findFirst({ where: { id: opportunityId, workspaceId: this.ws }, include: { losses: { orderBy: { lostAt: 'desc' }, take: 1 } } });
    if (!opp) return this.skip('NOT_FOUND');
    if (opp.status !== 'LOST') return this.skip('NOT_LOST');
    const lists = await this.tx.signalWatchlist.findMany({ where: { workspaceId: this.ws, kind: 'LOST_DEALS', archivedAt: null }, select: { id: true } });
    for (const l of lists) {
      const { count } = await this.tx.signalWatchlistMember.createMany({ data: [{ workspaceId: this.ws, watchlistId: l.id, companyId: opp.companyId, reason: `Deal "${opp.name}" lost`.slice(0, 200), nextCheckAt: null }], skipDuplicates: true });
      if (count) await recordEvent(this.tx, this.ctx, 'WatchlistChanged', l.id, { watchlistId: l.id, change: 'MEMBERS_ADDED', count });
    }
    const loss = opp.losses[0];
    await this.observe(opp.companyId, 'PIPELINE', `opportunity:${opp.id}`, 'NONE', loss?.revisitAt ? `Deal lost — revisit date ${day(loss.revisitAt)} tracked` : 'Deal lost — no revisit date', loss?.lostAt ?? this.now);
    if (loss?.revisitAt && loss.revisitAt <= this.now && !loss.reopenedAt) await lostDealRevisitTx(this.tx, this.ctx, { opportunityId: opp.id }, this.now);
    return opp.companyId;
  }

  // ───────────────────────────── discovery ─────────────────────────────

  /** A saved market rescan found a business we did not have: "new to our dataset", never "newly opened" (screen #9 §7). */
  async discovery(missionId: string, companyId: string | null): Promise<string | null> {
    if (!companyId) return this.skip('NO_COMPANY');
    const mission = await this.tx.discoveryMission.findFirst({ where: { id: missionId, workspaceId: this.ws }, include: { market: true } });
    if (!mission) return this.skip('NOT_FOUND');
    const obs = await this.tx.discoveryObservation.findFirst({ where: { workspaceId: this.ws, missionId, companyId, outcome: 'CREATED' }, orderBy: { observedAt: 'asc' } });
    if (!obs) return this.skip('NOT_NEW');
    const earlier = await this.tx.discoveryMission.findFirst({ where: { workspaceId: this.ws, marketId: mission.marketId, id: { not: mission.id }, status: 'COMPLETED', completedAt: { lt: mission.createdAt } }, orderBy: { completedAt: 'desc' } });
    if (!earlier) {
      await this.observe(companyId, 'DISCOVERY', `market:${mission.marketId}`, 'NONE', 'First scan of this market — baseline', obs.observedAt);
      return companyId;
    }
    const evidenceId =
      obs.evidenceId ??
      (await ensureEvidenceTx(this.tx, this.ctx, { companyId, ref: `discovery-observation/${obs.id}`, evidenceType: 'LISTING', sourceType: 'LEAD_SOURCE', sourceName: obs.provider, excerpt: `${obs.name}${obs.category ? ` — ${obs.category}` : ''}${obs.city ? `, ${obs.city}` : ''}`, observedAt: obs.observedAt, confidence: 'MEDIUM' }));
    const r = await this.signal({
      companyId,
      type: 'NEW_TO_DATASET',
      subject: `market:${mission.marketId}`,
      title: `New to our dataset in ${mission.market.name}`.slice(0, 200),
      fact: `A rescan of "${mission.market.name}" found this business; the previous scan (${day(earlier.completedAt!)}) did not — new to our dataset, not necessarily newly opened (source: ${obs.provider}).`,
      sourceKind: 'DISCOVERY',
      evidence: [{ evidenceId, source: obs.provider, observedAt: obs.observedAt }],
      marketId: mission.marketId,
      confidence: 'MEDIUM',
    });
    await this.observe(companyId, 'DISCOVERY', `market:${mission.marketId}`, 'MEDIUM', 'New to our dataset in a rescan', obs.observedAt, r.signal.id);
    return companyId;
  }

  // ───────────────────────────── people (CRM) ─────────────────────────────

  /** A decision maker appeared next to another one, or left: leadership change / new stakeholder. */
  async employment(employmentId: string): Promise<string | null> {
    const emp = await this.tx.employment.findFirst({ where: { id: employmentId, workspaceId: this.ws }, include: { person: true } });
    if (!emp) return this.skip('NOT_FOUND');
    const relevance = roleRelevance(emp.title);
    const at = emp.isCurrent ? emp.createdAt : emp.updatedAt;
    const subject = `person:${emp.personId}`;
    if (relevance !== 'HIGH') {
      await this.observe(emp.companyId, 'CRM', subject, 'NONE', `${emp.isCurrent ? 'Person added' : 'Person left'} — not a decision maker`, at);
      return emp.companyId;
    }
    const others = await this.tx.employment.findMany({ where: { workspaceId: this.ws, companyId: emp.companyId, personId: { not: emp.personId }, createdAt: { lt: emp.createdAt } }, select: { title: true, isCurrent: true } });
    const otherHigh = others.filter((o) => roleRelevance(o.title) === 'HIGH');
    const name = emp.person.fullName;
    const label = `${name}${emp.title ? ` (${emp.title})` : ''}`;
    let type: 'LEADERSHIP_CHANGE' | 'NEW_STAKEHOLDER' | null = null;
    let fact = '';
    if (!emp.isCurrent) {
      type = 'LEADERSHIP_CHANGE';
      fact = `${label} is no longer recorded at the company.`;
    } else if (otherHigh.length) {
      type = otherHigh.some((o) => !o.isCurrent) ? 'LEADERSHIP_CHANGE' : 'NEW_STAKEHOLDER';
      fact = type === 'LEADERSHIP_CHANGE' ? `${label} is now recorded as a decision maker; an earlier decision maker is no longer listed.` : `${label} was found as another decision maker at the company.`;
    }
    if (!type) {
      await this.observe(emp.companyId, 'CRM', subject, 'NONE', 'First decision maker found — baseline', at);
      return emp.companyId;
    }
    const personEvidence = await this.tx.evidence.findFirst({ where: { workspaceId: this.ws, entityType: 'PERSON', entityId: emp.personId }, orderBy: { observedAt: 'desc' } });
    const evidenceId = personEvidence?.id ?? (await ensureEvidenceTx(this.tx, this.ctx, { companyId: emp.companyId, ref: `employment/${emp.id}/${emp.isCurrent ? 'current' : 'ended'}`, evidenceType: 'CRM_RECORD', sourceType: 'CRM', sourceName: 'CRM', excerpt: fact, observedAt: at, confidence: 'MEDIUM' }));
    const r = await this.signal({ companyId: emp.companyId, type, subject, title: type === 'LEADERSHIP_CHANGE' ? `Leadership change: ${label}` : `New stakeholder: ${label}`, fact, sourceKind: 'CRM', evidence: [{ evidenceId, source: personEvidence?.sourceName ?? personEvidence?.sourceType ?? 'crm', observedAt: personEvidence?.observedAt ?? at }], personId: emp.personId, confidence: emp.confidence });
    await this.observe(emp.companyId, 'CRM', subject, 'MEDIUM', fact, at, r.signal.id);
    return emp.companyId;
  }

  // ───────────────────────────── cluster ─────────────────────────────

  /** Several independent growth/digital changes in 90 days → one EXPANSION signal, explicitly an inference (screen #9 §34). */
  async cluster(companyId: string): Promise<void> {
    const open = await this.tx.signal.findMany({ where: { workspaceId: this.ws, companyId, status: { in: OPEN_SIGNAL_STATUSES }, category: { in: ['GROWTH', 'DIGITAL'] } }, select: { id: true, type: true, category: true, detectedAt: true } });
    const types = expansionCluster(open, this.now);
    if (!types.length) return;
    const ids = open.filter((s) => types.includes(s.type)).map((s) => s.id);
    const links = await this.tx.signalEvidence.findMany({ where: { signalId: { in: ids } }, orderBy: { observedAt: 'desc' } });
    const evidence = links.filter((l, i, all) => all.findIndex((x) => x.evidenceId === l.evidenceId) === i).slice(0, 10).map((l) => ({ evidenceId: l.evidenceId, source: l.source, note: 'Part of the pattern', observedAt: l.observedAt }));
    const labels = types.map(typeLabel);
    await this.signal({
      companyId,
      type: 'EXPANSION',
      subject: 'cluster',
      title: `Several changes together: ${labels.join(', ')}`.slice(0, 200),
      fact: `${types.length} independent changes in the last 90 days: ${labels.join(', ')}.`,
      sourceKind: 'WEBSITE',
      evidence,
      interpretation: 'Taken together these changes may suggest the business is expanding — an inference from several observations, not a confirmed fact.',
    });
  }
}

/** A deal lost on timing reached its revisit date → one LOST_DEAL_REVISIT per loss (never twice, whatever its status). */
export async function lostDealRevisitTx(tx: Tx, ctx: ServiceContext, input: { opportunityId: string }, now: Date): Promise<RecordedSignal | null> {
  const opp = await tx.opportunity.findFirst({ where: { id: input.opportunityId, workspaceId: ctx.workspaceId }, include: { losses: { orderBy: { lostAt: 'desc' }, take: 1 } } });
  const loss = opp?.losses[0];
  if (!opp || opp.status !== 'LOST' || !loss?.revisitAt || loss.reopenedAt || loss.revisitAt > now) return null;
  const done = await tx.signal.findFirst({ where: { workspaceId: ctx.workspaceId, type: 'LOST_DEAL_REVISIT', opportunityId: opp.id, effectiveAt: loss.revisitAt }, select: { id: true } });
  if (done) return null;
  const reason = loss.reasonCode.toLowerCase().replace(/_/g, ' ');
  const evidenceId = await ensureEvidenceTx(tx, ctx, { companyId: opp.companyId, ref: `opportunity-loss/${loss.id}`, evidenceType: 'DEAL_LOSS', sourceType: 'PIPELINE', sourceName: 'Pipeline', excerpt: `"${opp.name}" lost on ${day(loss.lostAt)} (${reason}); revisit ${day(loss.revisitAt)}${loss.details ? ` — ${loss.details}` : ''}${loss.evidenceQuote ? ` — "${loss.evidenceQuote}"` : ''}`, observedAt: loss.lostAt });
  const r = await recordSignal(tx, ctx, {
    companyId: opp.companyId,
    type: 'LOST_DEAL_REVISIT',
    subject: `opportunity:${opp.id}`,
    title: `Revisit date reached: ${opp.name}`.slice(0, 200),
    fact: `"${opp.name}" was lost on ${day(loss.lostAt)} (${reason}) with a revisit date of ${day(loss.revisitAt)}`,
    sourceKind: 'PIPELINE',
    evidence: [{ evidenceId, source: 'pipeline', observedAt: loss.lostAt }],
    effectiveAt: loss.revisitAt,
    opportunityId: opp.id,
    now,
  });
  await recordObservationTx(tx, ctx, { companyId: opp.companyId, sourceKind: 'PIPELINE', subject: `opportunity:${opp.id}:revisit`, changeLevel: 'HIGH', detail: 'Lost deal revisit date reached', observedAt: loss.revisitAt, signalId: r.signal.id });
  await writeAudit(tx, ctx, { action: 'signal.revisit_opened', entityType: 'SIGNAL', entityId: r.signal.id, after: { opportunityId: opp.id, revisitAt: loss.revisitAt.toISOString() } });
  return r;
}
