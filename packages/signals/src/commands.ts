import type { PrismaClient, Signal } from '@revenue-os/database';
import { actorUserId, requestResearchTx, writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import {
  BusinessRuleError,
  ConflictError,
  decideStatus,
  NotFoundError,
  OPEN_SIGNAL_STATUSES,
  parseRuleConditions,
  RULE_ACTIONS,
  SIGNAL_FEEDBACK,
  SIGNAL_TYPES,
  ValidationError,
  WATCHLIST_KINDS,
  type Relevance,
  type RuleAction,
  type RuleConditions,
  type SignalFeedbackKey,
  type SignalTypeKey,
  type WatchlistKind,
} from '@revenue-os/shared';
import { companySignalContext } from './context.js';
import { TX, type SignalDeps } from './deps.js';
import { analyzeSignal } from './interpret.js';
import { syncWatchlistTx } from './sweep.js';

export const SIGNAL_ACTIONS = ['RESEARCH', 'ATTACH_TO_DEAL', 'NOTIFY_OWNER', 'RE_ENGAGE', 'CAMPAIGN_CANDIDATE', 'VALIDATE', 'MONITOR'] as const;
export type SignalActionKey = (typeof SIGNAL_ACTIONS)[number];

async function signalOf(db: PrismaClient | Tx, workspaceId: string, id: string): Promise<Signal> {
  const s = await db.signal.findFirst({ where: { id, workspaceId } });
  if (!s) throw new NotFoundError(`Signal ${id} not found`);
  return s;
}

const isOpen = (s: Signal) => (OPEN_SIGNAL_STATUSES as string[]).includes(s.status);

/**
 * A person acts on a signal (screen #9 §20-21, §26-27). Nothing here sends: research is queued, a deal gets the
 * signal attached, the owner is the one who re-engages, and "campaign candidate" only marks a cold, actionable prospect
 * for signal-based campaigns (every campaign check and the Policy Engine still apply). Existing conversations,
 * customers and open deals are protected from cold campaigns.
 */
export async function actOnSignal(db: PrismaClient, ctx: ServiceContext, id: string, input: { action: SignalActionKey; note?: string | null }) {
  const s = await signalOf(db, ctx.workspaceId, id);
  if (!isOpen(s)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `This signal is ${s.status.toLowerCase().replace('_', ' ')} — only an open signal can be acted on`);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const c = await companySignalContext(tx, ctx.workspaceId, s.companyId, now);
    const relevance = s.relevance as unknown as Relevance;
    let status: Signal['status'] = 'ACTED_ON';
    const data: Record<string, unknown> = {};
    let researchRunId: string | null = null;
    switch (input.action) {
      case 'ATTACH_TO_DEAL': {
        const opp = await tx.opportunity.findFirst({ where: { workspaceId: ctx.workspaceId, companyId: s.companyId, status: 'OPEN', ...(s.opportunityId ? { id: s.opportunityId } : {}) } }) ?? (await tx.opportunity.findFirst({ where: { workspaceId: ctx.workspaceId, companyId: s.companyId, status: 'OPEN' }, orderBy: { lastActivityAt: 'desc' } }));
        if (!opp) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'There is no open deal for this company to attach the signal to');
        data.opportunityId = opp.id;
        await tx.opportunity.update({ where: { id: opp.id }, data: { lastActivityAt: now } });
        await writeAudit(tx, ctx, { action: 'opportunity.signal_attached', entityType: 'OPPORTUNITY', entityId: opp.id, after: { signalId: s.id, type: s.type, title: s.title, note: input.note ?? null } });
        break;
      }
      case 'CAMPAIGN_CANDIDATE':
        if (c.relationship !== 'COLD') throw new BusinessRuleError('INVALID_STATE_TRANSITION', `Existing conversation/customer protection: this company is "${c.relationship.toLowerCase().replace('_', ' ')}" — tell the owner instead of a cold campaign`);
        if (s.status !== 'ACTIONABLE') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only an actionable signal (verified, relevant, with a reason to contact now) can become a campaign candidate');
        data.campaignCandidate = true;
        break;
      case 'RESEARCH': {
        const r = await requestResearchTx(tx, ctx, s.companyId);
        researchRunId = r.run.id;
        break;
      }
      case 'VALIDATE': {
        // A person vouches for the evidence: at least medium source reliability, then the usual decision.
        const vouched = { ...relevance, sourceReliability: relevance.sourceReliability === 'LOW' ? ('MEDIUM' as const) : relevance.sourceReliability };
        status = decideStatus(vouched, s.whyNow, SIGNAL_TYPES[s.type as SignalTypeKey]?.negative ?? false) === 'ACTIONABLE' ? 'ACTIONABLE' : 'VALIDATED';
        break;
      }
      case 'MONITOR':
        status = 'MONITOR';
        break;
      default:
        break; // NOTIFY_OWNER / RE_ENGAGE: recorded — the owner reaches out through the normal, policy-checked paths.
    }
    const acted = status === 'ACTED_ON';
    const updated = await tx.signal.update({
      where: { id: s.id },
      data: { ...data, status, statusReason: input.note?.slice(0, 300) ?? null, ...(acted ? { actedAction: input.action, actedAt: now, actedById: actorUserId(ctx) } : {}), version: { increment: 1 } },
    });
    await writeAudit(tx, ctx, { action: acted ? 'signal.acted_on' : `signal.${input.action.toLowerCase()}`, entityType: 'SIGNAL', entityId: s.id, before: { status: s.status }, after: { status, action: input.action, researchRunId, campaignCandidate: updated.campaignCandidate, opportunityId: updated.opportunityId }, reason: input.note ?? undefined });
    if (acted) await recordEvent(tx, ctx, 'SignalActedOn', s.id, { signalId: s.id, companyId: s.companyId, action: input.action });
    if (status !== s.status) await recordEvent(tx, ctx, 'SignalStatusChanged', s.id, { signalId: s.id, from: s.status, to: status, reason: input.note ?? input.action });
    return updated;
  }, TX);
}

/** "Not relevant" with a reason (screen #9 §40): kept for learning, hidden from the queue. */
export async function dismissSignal(db: PrismaClient, ctx: ServiceContext, id: string, input: { feedback: SignalFeedbackKey; note?: string | null }) {
  if (!SIGNAL_FEEDBACK.includes(input.feedback)) throw new ValidationError('Unknown feedback');
  const s = await signalOf(db, ctx.workspaceId, id);
  if (s.status === 'DISMISSED') return s;
  return db.$transaction(async (tx) => {
    const updated = await tx.signal.update({ where: { id: s.id }, data: { status: 'DISMISSED', statusReason: `Dismissed: ${input.feedback.toLowerCase().replace(/_/g, ' ')}`, feedback: input.feedback, feedbackNote: input.note?.slice(0, 500) ?? null, dismissedById: actorUserId(ctx), campaignCandidate: false, priority: false, version: { increment: 1 } } });
    await writeAudit(tx, ctx, { action: 'signal.dismissed', entityType: 'SIGNAL', entityId: s.id, before: { status: s.status }, after: { status: 'DISMISSED', feedback: input.feedback }, reason: input.note ?? undefined });
    await recordEvent(tx, ctx, 'SignalDismissed', s.id, { signalId: s.id, feedback: input.feedback });
    await recordEvent(tx, ctx, 'SignalStatusChanged', s.id, { signalId: s.id, from: s.status, to: 'DISMISSED', reason: input.feedback });
    return updated;
  }, TX);
}

/** "Analyze again": a fresh rule + Signal Agent pass under a new task key. */
export async function reanalyzeSignal(deps: SignalDeps, ctx: ServiceContext, id: string) {
  const s = await signalOf(deps.db, ctx.workspaceId, id);
  if (!isOpen(s)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only an open signal can be analysed again');
  await deps.db.$transaction((tx) => writeAudit(tx, ctx, { action: 'signal.reanalyze_requested', entityType: 'SIGNAL', entityId: s.id }), TX);
  const result = await analyzeSignal(deps, { workspaceId: ctx.workspaceId, signalId: s.id, inputKey: `signal:${s.id}:again:${Date.now()}` });
  return { ...result, signal: await deps.db.signal.findUniqueOrThrow({ where: { id: s.id } }) };
}

/** "Check now": a monitoring research run for one company (website re-read → change detection). */
export async function requestCompanyCheck(db: PrismaClient, ctx: ServiceContext, companyId: string) {
  const company = await db.company.findFirst({ where: { id: companyId, workspaceId: ctx.workspaceId }, select: { id: true, websiteDomain: true } });
  if (!company) throw new NotFoundError('Company not found');
  const now = new Date();
  return db.$transaction(async (tx) => {
    const { run, created } = await requestResearchTx(tx, ctx, companyId, 'MONITOR');
    await tx.signalWatchlistMember.updateMany({ where: { workspaceId: ctx.workspaceId, companyId }, data: { lastCheckedAt: now } });
    await writeAudit(tx, ctx, { action: 'signal.check_requested', entityType: 'COMPANY', entityId: companyId, after: { researchRunId: run.id, created } });
    return { researchRunId: run.id, created, websiteRead: !!company.websiteDomain };
  }, TX);
}

// ───────────────────────────── watchlists ─────────────────────────────

export interface WatchlistInput {
  name: string;
  description?: string | null;
  kind: WatchlistKind;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  marketId?: string | null;
}

async function watchlistOf(db: PrismaClient | Tx, workspaceId: string, id: string) {
  const w = await db.signalWatchlist.findFirst({ where: { id, workspaceId } });
  if (!w) throw new NotFoundError(`Watchlist ${id} not found`);
  return w;
}

/** A named list with a monitoring priority (screen #9 §29-31); market / deal / customer lists fill themselves. */
export async function createWatchlist(db: PrismaClient, ctx: ServiceContext, input: WatchlistInput) {
  if (!WATCHLIST_KINDS.includes(input.kind)) throw new ValidationError('Unknown watchlist kind');
  const name = input.name.trim();
  if (!name) throw new ValidationError('Name the watchlist');
  if (input.kind === 'MARKET') {
    if (!input.marketId) throw new ValidationError('A market watchlist needs a market');
    const market = await db.market.findFirst({ where: { id: input.marketId, workspaceId: ctx.workspaceId }, select: { id: true } });
    if (!market) throw new NotFoundError('Market not found');
  }
  if (await db.signalWatchlist.findFirst({ where: { workspaceId: ctx.workspaceId, name }, select: { id: true } })) throw new ConflictError('ALREADY_EXISTS', `A watchlist called "${name}" already exists`);
  return db.$transaction(async (tx) => {
    const w = await tx.signalWatchlist.create({ data: { workspaceId: ctx.workspaceId, name: name.slice(0, 120), description: input.description?.trim().slice(0, 500) || null, kind: input.kind, priority: input.priority, marketId: input.kind === 'MARKET' ? input.marketId! : null, createdBy: actorUserId(ctx) } });
    await writeAudit(tx, ctx, { action: 'watchlist.created', entityType: 'SIGNAL_WATCHLIST', entityId: w.id, after: { name: w.name, kind: w.kind, priority: w.priority, marketId: w.marketId } });
    await recordEvent(tx, ctx, 'WatchlistChanged', w.id, { watchlistId: w.id, change: 'CREATED', count: 0 });
    await syncWatchlistTx(tx, ctx.workspaceId, w);
    return w;
  }, TX);
}

export async function updateWatchlist(db: PrismaClient, ctx: ServiceContext, id: string, input: { name?: string; description?: string | null; priority?: 'HIGH' | 'NORMAL' | 'LOW' }) {
  const w = await watchlistOf(db, ctx.workspaceId, id);
  if (w.archivedAt) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This watchlist is archived');
  const name = input.name?.trim();
  if (input.name !== undefined && !name) throw new ValidationError('Name the watchlist');
  if (name && name !== w.name && (await db.signalWatchlist.findFirst({ where: { workspaceId: ctx.workspaceId, name }, select: { id: true } }))) throw new ConflictError('ALREADY_EXISTS', `A watchlist called "${name}" already exists`);
  return db.$transaction(async (tx) => {
    const u = await tx.signalWatchlist.update({ where: { id }, data: { ...(name ? { name: name.slice(0, 120) } : {}), ...(input.description !== undefined ? { description: input.description?.trim().slice(0, 500) || null } : {}), ...(input.priority ? { priority: input.priority } : {}), version: { increment: 1 } } });
    await writeAudit(tx, ctx, { action: 'watchlist.updated', entityType: 'SIGNAL_WATCHLIST', entityId: id, before: { name: w.name, priority: w.priority }, after: { name: u.name, priority: u.priority } });
    await recordEvent(tx, ctx, 'WatchlistChanged', id, { watchlistId: id, change: 'UPDATED', count: 0 });
    return u;
  }, TX);
}

export async function archiveWatchlist(db: PrismaClient, ctx: ServiceContext, id: string) {
  const w = await watchlistOf(db, ctx.workspaceId, id);
  if (w.archivedAt) return w;
  return db.$transaction(async (tx) => {
    // The name is freed for a new list; history keeps the archived one.
    const u = await tx.signalWatchlist.update({ where: { id }, data: { archivedAt: new Date(), name: `${w.name} (archived ${new Date().toISOString().slice(0, 10)} ${id.slice(0, 4)})`.slice(0, 160), version: { increment: 1 } } });
    await writeAudit(tx, ctx, { action: 'watchlist.archived', entityType: 'SIGNAL_WATCHLIST', entityId: id, before: { name: w.name } });
    await recordEvent(tx, ctx, 'WatchlistChanged', id, { watchlistId: id, change: 'ARCHIVED', count: 0 });
    return u;
  }, TX);
}

export async function addWatchlistMembers(db: PrismaClient, ctx: ServiceContext, id: string, input: { companyIds: string[]; reason?: string | null }) {
  const w = await watchlistOf(db, ctx.workspaceId, id);
  if (w.archivedAt) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This watchlist is archived');
  const ids = [...new Set(input.companyIds)];
  const found = await db.company.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) throw new NotFoundError('Some companies were not found');
  return db.$transaction(async (tx) => {
    const { count } = await tx.signalWatchlistMember.createMany({ data: ids.map((companyId) => ({ workspaceId: ctx.workspaceId, watchlistId: id, companyId, reason: input.reason?.trim().slice(0, 200) || null, addedBy: actorUserId(ctx) })), skipDuplicates: true });
    await writeAudit(tx, ctx, { action: 'watchlist.members_added', entityType: 'SIGNAL_WATCHLIST', entityId: id, after: { added: count, companyIds: ids.slice(0, 50) } });
    if (count) await recordEvent(tx, ctx, 'WatchlistChanged', id, { watchlistId: id, change: 'MEMBERS_ADDED', count });
    return { added: count };
  }, TX);
}

export async function removeWatchlistMembers(db: PrismaClient, ctx: ServiceContext, id: string, input: { companyIds: string[] }) {
  await watchlistOf(db, ctx.workspaceId, id);
  return db.$transaction(async (tx) => {
    const { count } = await tx.signalWatchlistMember.deleteMany({ where: { workspaceId: ctx.workspaceId, watchlistId: id, companyId: { in: input.companyIds } } });
    await writeAudit(tx, ctx, { action: 'watchlist.members_removed', entityType: 'SIGNAL_WATCHLIST', entityId: id, after: { removed: count, companyIds: input.companyIds.slice(0, 50) } });
    if (count) await recordEvent(tx, ctx, 'WatchlistChanged', id, { watchlistId: id, change: 'MEMBERS_REMOVED', count });
    return { removed: count };
  }, TX);
}

// ───────────────────────────── rules ─────────────────────────────

export interface RuleInput {
  name: string;
  enabled?: boolean;
  conditions: RuleConditions;
  actions: RuleAction[];
}

function cleanActions(actions: string[]): RuleAction[] {
  const out = [...new Set(actions)].filter((a): a is RuleAction => (RULE_ACTIONS as readonly string[]).includes(a));
  if (!out.length) throw new ValidationError('Pick at least one action');
  if (out.includes('IGNORE') && out.length > 1) throw new ValidationError('IGNORE cannot be combined with other actions');
  return out;
}

/** IF … THEN … (screen #9 §22-24). Conditions are AND-ed; actions never send anything. */
export async function createSignalRule(db: PrismaClient, ctx: ServiceContext, input: RuleInput) {
  const name = input.name.trim();
  if (!name) throw new ValidationError('Name the rule');
  const conditions = parseRuleConditions(input.conditions);
  const actions = cleanActions(input.actions);
  return db.$transaction(async (tx) => {
    const last = await tx.signalRule.findFirst({ where: { workspaceId: ctx.workspaceId }, orderBy: { position: 'desc' }, select: { position: true } });
    const rule = await tx.signalRule.create({ data: { workspaceId: ctx.workspaceId, name: name.slice(0, 160), enabled: input.enabled ?? true, conditions: conditions as object, actions, position: (last?.position ?? -1) + 1, createdBy: actorUserId(ctx) } });
    await writeAudit(tx, ctx, { action: 'signal_rule.created', entityType: 'SIGNAL_RULE', entityId: rule.id, after: { name: rule.name, conditions, actions, enabled: rule.enabled } });
    await recordEvent(tx, ctx, 'SignalRuleChanged', rule.id, { ruleId: rule.id, change: 'CREATED' });
    return rule;
  }, TX);
}

export async function updateSignalRule(db: PrismaClient, ctx: ServiceContext, id: string, input: Partial<RuleInput> & { position?: number }) {
  const rule = await db.signalRule.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!rule) throw new NotFoundError(`Rule ${id} not found`);
  const name = input.name?.trim();
  if (input.name !== undefined && !name) throw new ValidationError('Name the rule');
  const conditions = input.conditions ? parseRuleConditions(input.conditions) : undefined;
  const actions = input.actions ? cleanActions(input.actions) : undefined;
  return db.$transaction(async (tx) => {
    const u = await tx.signalRule.update({ where: { id }, data: { ...(name ? { name: name.slice(0, 160) } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), ...(conditions ? { conditions: conditions as object } : {}), ...(actions ? { actions } : {}), ...(input.position !== undefined ? { position: input.position } : {}), version: { increment: 1 } } });
    await writeAudit(tx, ctx, { action: 'signal_rule.updated', entityType: 'SIGNAL_RULE', entityId: id, before: { name: rule.name, enabled: rule.enabled, conditions: rule.conditions, actions: rule.actions }, after: { name: u.name, enabled: u.enabled, conditions: u.conditions, actions: u.actions } });
    await recordEvent(tx, ctx, 'SignalRuleChanged', id, { ruleId: id, change: 'UPDATED' });
    return u;
  }, TX);
}

export async function deleteSignalRule(db: PrismaClient, ctx: ServiceContext, id: string) {
  const rule = await db.signalRule.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!rule) throw new NotFoundError(`Rule ${id} not found`);
  return db.$transaction(async (tx) => {
    await tx.signalRule.delete({ where: { id } });
    await writeAudit(tx, ctx, { action: 'signal_rule.deleted', entityType: 'SIGNAL_RULE', entityId: id, before: { name: rule.name, conditions: rule.conditions, actions: rule.actions } });
    await recordEvent(tx, ctx, 'SignalRuleChanged', id, { ruleId: id, change: 'DELETED' });
    return { deleted: true };
  }, TX);
}
