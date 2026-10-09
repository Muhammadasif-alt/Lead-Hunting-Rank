import { Prisma, type Conversation, type LossReason, type Opportunity, type PipelineStage, type PrismaClient, type StageSemantic } from '@revenue-os/database';
import { writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { BusinessRuleError, ConflictError, NotFoundError, QUALIFICATION_KEYS, STAGE_SEMANTIC_INFO, ValidationError, type QualificationKey } from '@revenue-os/shared';
import { cancelPendingMessages, LIVE_ENROLLMENT } from './campaigns.js';
import { categorize } from './conversation-rules.js';
import { commercialSignal, mentionedStakeholder, qualificationKeyFor, qualificationStatus, stageRequirements, type DealSnapshot } from './opportunity-rules.js';

const TX = { timeout: 30_000, maxWait: 10_000 } as const;
const system = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'SYSTEM', id: null } });
const DECIDER_TITLE = /\b(owner|founder|co-?founder|ceo|president|principal|managing director|proprietor|partner)\b/i;

// ───────────────────────────── pipeline ─────────────────────────────

/** The workspace's default pipeline and its stages by meaning. */
export async function pipelineStages(db: Tx | PrismaClient, workspaceId: string) {
  const pipeline = await db.pipeline.findFirst({ where: { workspaceId, isDefault: true, archivedAt: null }, include: { stages: { orderBy: { position: 'asc' } } } });
  if (!pipeline) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This workspace has no sales pipeline yet');
  const bySemantic = new Map(pipeline.stages.map((s) => [s.semantic, s]));
  return { pipeline, stages: pipeline.stages, stage: (s: StageSemantic) => bySemantic.get(s) ?? null };
}

async function load(tx: Tx | PrismaClient, ctx: ServiceContext, id: string) {
  const o = await tx.opportunity.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { stage: true } });
  if (!o) throw new NotFoundError('Opportunity not found');
  return o;
}

/** What the guards need to know about a deal. */
export async function snapshotOf(tx: Tx | PrismaClient, o: Opportunity & { stage: PipelineStage }): Promise<DealSnapshot> {
  const [answers, history] = await Promise.all([
    tx.qualificationAnswer.findMany({ where: { qualification: { opportunityId: o.id }, supersededAt: null }, select: { key: true } }),
    tx.opportunityStageHistory.findMany({ where: { opportunityId: o.id }, select: { toSemantic: true } }),
  ]);
  return {
    semantic: o.stage.semantic,
    status: o.status,
    known: new Set(answers.map((a) => a.key)),
    hasPrimaryContact: !!o.primaryPersonId,
    service: o.service,
    amountMinor: o.amountMinor,
    reached: new Set(history.map((h) => h.toSemantic)),
  };
}

async function history(tx: Tx, ctx: ServiceContext, o: { id: string; workspaceId: string }, from: PipelineStage | null, to: PipelineStage, reason: string | null) {
  await tx.opportunityStageHistory.create({
    data: { workspaceId: o.workspaceId, opportunityId: o.id, fromStageId: from?.id ?? null, toStageId: to.id, fromSemantic: from?.semantic ?? null, toSemantic: to.semantic, actorType: ctx.actor.type, actorId: ctx.actor.id, reason: reason?.slice(0, 500) ?? null },
  });
}

// ───────────────────────────── create ─────────────────────────────

export interface CreateOpportunityInput {
  companyId: string;
  name: string;
  service?: string | null;
  amountMinor?: number | null;
  currency?: string;
  primaryPersonId?: string | null;
  ownerUserId?: string | null;
  conversationId?: string | null;
  source?: 'CONVERSATION' | 'MANUAL' | 'REFERRAL';
  originReason?: string | null;
  originQuote?: string | null;
}

/**
 * Creates a deal at New with its qualification. From a conversation, everything the prospect already stated is copied
 * in with their words, the contact becomes the primary stakeholder, and the conversation is linked (one open deal per
 * conversation).
 */
export async function createOpportunityTx(tx: Tx, ctx: ServiceContext, input: CreateOpportunityInput, now = new Date()) {
  const company = await tx.company.findFirst({ where: { id: input.companyId, workspaceId: ctx.workspaceId } });
  if (!company) throw new NotFoundError('Company not found');
  if (company.status === 'ARCHIVED' || company.mergedIntoId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'The company is archived or merged');
  const name = input.name.trim();
  if (!name) throw new ValidationError('Give the opportunity a name', [{ path: 'name', message: 'Required' }]);
  if (input.amountMinor != null && input.amountMinor < 0) throw new ValidationError('The value can not be negative', [{ path: 'amountMinor', message: 'Must be ≥ 0' }]);

  let conv: Conversation | null = null;
  if (input.conversationId) {
    conv = await tx.conversation.findFirst({ where: { id: input.conversationId, workspaceId: ctx.workspaceId } });
    if (!conv) throw new NotFoundError('Conversation not found');
    if (conv.companyId !== company.id) throw new ValidationError('The conversation belongs to another company', [{ path: 'conversationId', message: 'Mismatch' }]);
    if (conv.opportunityId) {
      const open = await tx.opportunity.findFirst({ where: { id: conv.opportunityId, status: 'OPEN' } });
      if (open) throw new ConflictError('ALREADY_EXISTS', 'This conversation already has an open opportunity');
    }
  }
  const primaryPersonId = input.primaryPersonId ?? conv?.personId ?? null;
  if (primaryPersonId && !(await tx.person.findFirst({ where: { id: primaryPersonId, workspaceId: ctx.workspaceId }, select: { id: true } }))) throw new NotFoundError('Contact not found');
  if (input.ownerUserId) {
    const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: input.ownerUserId } } });
    if (!member || member.status !== 'ACTIVE') throw new ValidationError('The owner must be an active member', [{ path: 'ownerUserId', message: 'Unknown member' }]);
  }

  const { pipeline, stage } = await pipelineStages(tx, ctx.workspaceId);
  const first = stage('NEW')!;
  const o = await tx.opportunity.create({
    data: {
      workspaceId: ctx.workspaceId,
      companyId: company.id,
      primaryPersonId,
      name: name.slice(0, 200),
      service: input.service?.trim() || null,
      pipelineId: pipeline.id,
      stageId: first.id,
      amountMinor: input.amountMinor ?? null,
      currency: (input.currency ?? 'USD').toUpperCase(),
      ownerUserId: input.ownerUserId ?? (ctx.actor.type === 'HUMAN' ? ctx.actor.id : null),
      source: input.source ?? (conv ? 'CONVERSATION' : 'MANUAL'),
      conversationId: conv?.id ?? null,
      campaignId: conv?.campaignId ?? null,
      originReason: input.originReason?.slice(0, 300) ?? null,
      originQuote: input.originQuote?.slice(0, 500) ?? null,
      createdByType: ctx.actor.type,
      createdById: ctx.actor.id,
      stageEnteredAt: now,
      lastActivityAt: conv?.lastInboundAt ?? now,
    },
    include: { stage: true },
  });
  await tx.qualification.create({ data: { workspaceId: ctx.workspaceId, opportunityId: o.id } });
  await history(tx, ctx, o, null, first, input.originReason ?? 'Created');

  if (primaryPersonId) {
    const person = await tx.person.findUniqueOrThrow({ where: { id: primaryPersonId } });
    const job = await tx.employment.findFirst({ where: { workspaceId: ctx.workspaceId, personId: primaryPersonId, companyId: company.id, isCurrent: true } });
    await tx.opportunityStakeholder.create({
      data: { workspaceId: ctx.workspaceId, opportunityId: o.id, personId: primaryPersonId, name: person.fullName, title: job?.title ?? null, role: job?.title && DECIDER_TITLE.test(job.title) ? 'DECISION_MAKER' : 'UNKNOWN', status: conv ? 'ENGAGED' : 'KNOWN', source: 'PRIMARY' },
    });
  }
  if (conv) {
    await tx.conversation.update({ where: { id: conv.id }, data: { opportunityId: o.id, commercialSignal: Prisma.DbNull, version: { increment: 1 } } });
    const facts = await tx.extractionCandidate.findMany({ where: { conversationId: conv.id, status: 'APPLIED' }, orderBy: { createdAt: 'asc' } });
    await syncQualificationTx(tx, ctx, o.id, facts.map((f) => ({ field: f.field, value: f.value, quote: f.quote, messageId: f.messageId, confidence: f.confidence })));
  }
  await writeAudit(tx, ctx, { action: 'opportunity.created', entityType: 'OPPORTUNITY', entityId: o.id, after: { companyId: company.id, conversationId: conv?.id ?? null, source: o.source, reason: input.originReason ?? null } });
  await recordEvent(tx, ctx, 'OpportunityCreated', o.id, { opportunityId: o.id, companyId: company.id, conversationId: conv?.id ?? null, source: o.source });
  return o;
}

/** "Create opportunity" from the inbox: named after the company and what the campaign offered. */
export async function createFromConversation(db: PrismaClient, ctx: ServiceContext, conversationId: string, input: { name?: string | null; service?: string | null; amountMinor?: number | null } = {}) {
  return db.$transaction(async (tx) => {
    const conv = await tx.conversation.findFirst({ where: { id: conversationId, workspaceId: ctx.workspaceId } });
    if (!conv) throw new NotFoundError('Conversation not found');
    const [company, campaign] = await Promise.all([
      tx.company.findUniqueOrThrow({ where: { id: conv.companyId }, select: { displayName: true } }),
      conv.campaignId ? tx.campaign.findUnique({ where: { id: conv.campaignId }, select: { offer: true } }) : null,
    ]);
    const signal = (conv.commercialSignal ?? null) as { reason?: string; quote?: string | null } | null;
    const service = input.service?.trim() || shortOffer(campaign?.offer) || null;
    return createOpportunityTx(tx, ctx, {
      companyId: conv.companyId,
      name: input.name?.trim() || `${company.displayName}${service ? ` — ${service}` : ''}`,
      service,
      amountMinor: input.amountMinor ?? null,
      conversationId: conv.id,
      source: 'CONVERSATION',
      originReason: signal?.reason ?? 'Created from the conversation by a person',
      originQuote: signal?.quote ?? null,
    });
  }, TX);
}

/** "We set up online booking for local businesses in a week." → "Online booking" — a short label for what they'd buy. */
export function shortOffer(offer: string | null | undefined): string | null {
  let t = offer?.trim().replace(/[.\s]+$/, '') ?? '';
  if (!t) return null;
  t = t.replace(/^(we|i)\s+(help\s+\S+(\s+like\s+yours)?\s+with|set up|build|create|design|offer|provide|deliver|do|make)\s+/i, '');
  t = t.split(/\s+(for|to|so|in|that|which)\s+/i)[0]!.trim() || t;
  t = `${t[0]!.toUpperCase()}${t.slice(1)}`;
  return t.length <= 60 ? t : `${t.slice(0, 57).replace(/\s+\S*$/, '')}…`;
}

// ───────────────────────────── from the conversation ─────────────────────────────

/**
 * Called inside the conversation engine's transaction after a message was read. With a deal: the stated facts update
 * its qualification and a mentioned decision maker becomes a suggested stakeholder. Without one: strong commercial
 * evidence creates a deal (autonomy L2+); anything weaker is only noted for a person ("Potential opportunity").
 */
export async function opportunityFromConversationTx(tx: Tx, conv: Conversation, facts: { field: string; value: string; quote: string; messageId: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }[], intent: string | null, now = new Date()) {
  const ctx = system(conv.workspaceId);
  if (conv.opportunityId) {
    const o = await tx.opportunity.findFirst({ where: { id: conv.opportunityId } });
    if (!o) return null;
    await tx.opportunity.update({ where: { id: o.id }, data: { lastActivityAt: now } });
    if (o.status === 'OPEN') await syncQualificationTx(tx, ctx, o.id, facts);
    return { opportunityId: o.id, created: false };
  }
  if (conv.stage === 'SUPPRESSED' || conv.stage === 'CLOSED') return null;
  const known = (conv.context ?? {}) as Record<string, { value: string; quote: string }>;
  const signal = commercialSignal(known, intent);
  if (!signal) return null;
  const ws = await tx.workspace.findUniqueOrThrow({ where: { id: conv.workspaceId }, select: { autonomyLevel: true } });
  const auto = signal.strength === 'STRONG' && ws.autonomyLevel !== 'L0' && ws.autonomyLevel !== 'L1';
  if (auto) {
    const [company, campaign] = await Promise.all([
      tx.company.findUniqueOrThrow({ where: { id: conv.companyId }, select: { displayName: true } }),
      conv.campaignId ? tx.campaign.findUnique({ where: { id: conv.campaignId }, select: { offer: true } }) : null,
    ]);
    const service = shortOffer(campaign?.offer);
    const o = await createOpportunityTx(tx, ctx, { companyId: conv.companyId, name: `${company.displayName}${service ? ` — ${service}` : ''}`, service, conversationId: conv.id, source: 'CONVERSATION', originReason: signal.reason, originQuote: signal.quote }, now);
    return { opportunityId: o.id, created: true };
  }
  const previous = conv.commercialSignal as { strength?: string } | null;
  if (previous?.strength === signal.strength) return null;
  await tx.conversation.update({ where: { id: conv.id }, data: { commercialSignal: { ...signal, at: now.toISOString() } } });
  await recordEvent(tx, ctx, 'OpportunityProposed', conv.id, { conversationId: conv.id, companyId: conv.companyId, strength: signal.strength, reason: signal.reason });
  return null;
}

/**
 * Stated facts → qualification answers, with the prospect's words. The latest statement supersedes an earlier one
 * (history kept); an answer a person confirmed is never overwritten by the AI.
 */
export async function syncQualificationTx(tx: Tx, ctx: ServiceContext, opportunityId: string, facts: { field: string; value: string; quote: string; messageId: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }[]) {
  const q = await tx.qualification.findUnique({ where: { opportunityId } });
  if (!q) return { changed: [] as string[] };
  const changed: string[] = [];
  for (const f of facts) {
    const key = qualificationKeyFor(f.field, f.quote);
    if (!key) continue;
    const current = await tx.qualificationAnswer.findFirst({ where: { qualificationId: q.id, key, supersededAt: null } });
    if (current && (current.verified || current.value === f.value || current.sourceMessageId === f.messageId)) continue;
    if (current) await tx.qualificationAnswer.update({ where: { id: current.id }, data: { supersededAt: new Date() } });
    await tx.qualificationAnswer.create({ data: { workspaceId: q.workspaceId, qualificationId: q.id, key, value: f.value.slice(0, 300), confidence: f.confidence, source: 'CONVERSATION', sourceMessageId: f.messageId, quote: f.quote.slice(0, 500) } });
    changed.push(key);
    if (key === 'DECISION_PROCESS') {
      const s = mentionedStakeholder(f.quote);
      if (s && !(await tx.opportunityStakeholder.findFirst({ where: { opportunityId, name: s.name } }))) {
        await tx.opportunityStakeholder.create({ data: { workspaceId: q.workspaceId, opportunityId, name: s.name, role: s.role, status: 'SUGGESTED', source: 'CONVERSATION', quote: f.quote.slice(0, 500), messageId: f.messageId } });
        await recordEvent(tx, ctx, 'OpportunityStakeholderAdded', opportunityId, { opportunityId, name: s.name, role: s.role, source: 'CONVERSATION' });
      }
    }
  }
  if (changed.length) await refreshQualificationTx(tx, ctx, opportunityId, changed);
  return { changed };
}

async function refreshQualificationTx(tx: Tx, ctx: ServiceContext, opportunityId: string, changed: string[]) {
  const q = await tx.qualification.findUniqueOrThrow({ where: { opportunityId } });
  const answers = await tx.qualificationAnswer.findMany({ where: { qualificationId: q.id, supersededAt: null }, select: { key: true } });
  const status = qualificationStatus(new Set(answers.map((a) => a.key)));
  await tx.qualification.update({ where: { id: q.id }, data: { status } });
  await recordEvent(tx, ctx, 'QualificationUpdated', opportunityId, { opportunityId, status, changedKeys: changed });
}

/** A person enters, corrects or clears an answer (clearing = unknown again; history kept). Their answer is verified. */
export async function setQualificationAnswer(db: PrismaClient, ctx: ServiceContext, opportunityId: string, key: QualificationKey, value: string | null) {
  if (!QUALIFICATION_KEYS.includes(key)) throw new ValidationError('Unknown qualification field', [{ path: 'key', message: 'Unknown' }]);
  return db.$transaction(async (tx) => {
    const o = await load(tx, ctx, opportunityId);
    const q = await tx.qualification.findUniqueOrThrow({ where: { opportunityId: o.id } });
    await tx.qualificationAnswer.updateMany({ where: { qualificationId: q.id, key, supersededAt: null }, data: { supersededAt: new Date() } });
    if (value?.trim()) {
      await tx.qualificationAnswer.create({ data: { workspaceId: o.workspaceId, qualificationId: q.id, key, value: value.trim().slice(0, 300), confidence: 'HIGH', source: 'MANUAL', verified: true, verifiedById: ctx.actor.id, createdById: ctx.actor.id } });
    }
    await refreshQualificationTx(tx, ctx, o.id, [key]);
    await writeAudit(tx, ctx, { action: 'opportunity.qualification_set', entityType: 'OPPORTUNITY', entityId: o.id, after: { key, known: !!value?.trim() } });
    return { ok: true };
  }, TX);
}

/** A person confirms an answer the AI read from the conversation. */
export async function confirmQualificationAnswer(db: PrismaClient, ctx: ServiceContext, opportunityId: string, answerId: string) {
  return db.$transaction(async (tx) => {
    const o = await load(tx, ctx, opportunityId);
    const { count } = await tx.qualificationAnswer.updateMany({ where: { id: answerId, qualification: { opportunityId: o.id }, supersededAt: null }, data: { verified: true, verifiedById: ctx.actor.id } });
    if (count !== 1) throw new NotFoundError('Answer not found');
    await writeAudit(tx, ctx, { action: 'opportunity.qualification_confirmed', entityType: 'OPPORTUNITY', entityId: o.id, after: { answerId } });
    return { ok: true };
  }, TX);
}

// ───────────────────────────── stage commands ─────────────────────────────

/**
 * ChangeOpportunityStage (docs/09 §48-55): the board's drag & drop is only a convenience — this command checks the
 * target stage's requirements for forward moves, needs a reason to go back, and writes history. WON and LOST have
 * their own commands.
 */
export async function changeStage(db: PrismaClient, ctx: ServiceContext, opportunityId: string, target: StageSemantic, reason: string | null, expectedVersion?: number) {
  if (target === 'WON' || target === 'LOST') throw new BusinessRuleError('INVALID_STATE_TRANSITION', `Use “Mark ${target === 'WON' ? 'won' : 'lost'}” — it records the ${target === 'WON' ? 'value and confirmation' : 'reason'}`);
  return db.$transaction(async (tx) => {
    const o = await load(tx, ctx, opportunityId);
    if (expectedVersion !== undefined && o.version !== expectedVersion) throw new ConflictError('VERSION_CONFLICT', 'This opportunity changed meanwhile — reload');
    if (o.status !== 'OPEN') throw new BusinessRuleError('INVALID_STATE_TRANSITION', `This opportunity is ${o.status.toLowerCase()} — reopen it first`);
    if (o.stage.semantic === target) return o;
    const { stage } = await pipelineStages(tx, ctx.workspaceId);
    const to = stage(target);
    if (!to) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `The pipeline has no ${STAGE_SEMANTIC_INFO[target].label} stage`);
    const ORDER = ['NEW', 'DISCOVERY', 'QUALIFIED', 'MEETING', 'PROPOSAL', 'NEGOTIATION'];
    const forward = target !== 'NURTURE' && (o.stage.semantic === 'NURTURE' || ORDER.indexOf(target) > ORDER.indexOf(o.stage.semantic));
    if (forward) {
      const missing = stageRequirements(target, await snapshotOf(tx, o));
      if (missing.length) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `Can’t move to ${STAGE_SEMANTIC_INFO[target].label} yet: ${missing.join('; ')}`);
    } else if (!reason?.trim() && target !== 'NURTURE') {
      throw new ValidationError('Say why the deal moves back', [{ path: 'reason', message: 'Required to move back' }]);
    }
    const now = new Date();
    const { count } = await tx.opportunity.updateMany({ where: { id: o.id, version: o.version }, data: { stageId: to.id, stageEnteredAt: now, version: { increment: 1 } } });
    if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This opportunity changed meanwhile — reload');
    await history(tx, ctx, o, o.stage, to, reason?.trim() || null);
    await writeAudit(tx, ctx, { action: 'opportunity.stage_changed', entityType: 'OPPORTUNITY', entityId: o.id, before: { stage: o.stage.semantic }, after: { stage: target }, reason: reason ?? undefined });
    await recordEvent(tx, ctx, 'OpportunityStageChanged', o.id, { opportunityId: o.id, from: o.stage.semantic, to: target, reason: reason?.trim() || null });
    return tx.opportunity.findUniqueOrThrow({ where: { id: o.id } });
  }, TX);
}

/**
 * MarkOpportunityWon (screen #7 §34): explicit, with the value and what confirmed it. The company becomes a customer,
 * every cold sequence to it stops, and it can't be enrolled in prospecting campaigns again.
 */
export async function markWon(db: PrismaClient, ctx: ServiceContext, opportunityId: string, input: { amountMinor: number; currency?: string; note: string }) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new ValidationError('Enter the won value', [{ path: 'amountMinor', message: 'Must be more than 0' }]);
  if (!input.note.trim()) throw new ValidationError('Say what confirmed it (signed proposal, email, call…)', [{ path: 'note', message: 'Required' }]);
  return db.$transaction(async (tx) => {
    const o = await load(tx, ctx, opportunityId);
    if (o.status !== 'OPEN') throw new BusinessRuleError('INVALID_STATE_TRANSITION', `This opportunity is already ${o.status.toLowerCase()}`);
    const { stage } = await pipelineStages(tx, ctx.workspaceId);
    const won = stage('WON')!;
    const now = new Date();
    const { count } = await tx.opportunity.updateMany({
      where: { id: o.id, version: o.version, status: 'OPEN' },
      data: { status: 'WON', stageId: won.id, stageEnteredAt: now, closedAt: now, wonAmountMinor: input.amountMinor, amountMinor: o.amountMinor ?? input.amountMinor, currency: (input.currency ?? o.currency).toUpperCase(), wonNote: input.note.trim().slice(0, 500), nextActionOverride: null, version: { increment: 1 } },
    });
    if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This opportunity changed meanwhile — reload');
    await history(tx, ctx, o, o.stage, won, input.note.trim());

    // Won workflow: customer, no more prospecting outreach.
    const company = await tx.company.findUniqueOrThrow({ where: { id: o.companyId } });
    if (company.status !== 'CUSTOMER') {
      await tx.company.update({ where: { id: company.id }, data: { status: 'CUSTOMER', version: { increment: 1 } } });
      await recordEvent(tx, ctx, 'CompanyUpdated', company.id, { companyId: company.id, version: company.version + 1, changedFields: ['status'] });
    }
    const live = await tx.campaignEnrollment.findMany({ where: { workspaceId: ctx.workspaceId, companyId: o.companyId, status: { in: LIVE_ENROLLMENT } }, select: { id: true, campaignId: true } });
    await cancelPendingMessages(tx, ctx, live.map((e) => e.id), 'Became a customer');
    for (const e of live) {
      await tx.campaignEnrollment.update({ where: { id: e.id }, data: { status: 'REMOVED', statusReason: 'Became a customer', nextStepDueAt: null } });
      await recordEvent(tx, ctx, 'EnrollmentRemoved', e.id, { enrollmentId: e.id, campaignId: e.campaignId, reason: 'Became a customer' });
    }
    await writeAudit(tx, ctx, { action: 'opportunity.won', entityType: 'OPPORTUNITY', entityId: o.id, after: { amountMinor: input.amountMinor, currency: input.currency ?? o.currency, stoppedEnrollments: live.length }, reason: input.note });
    await recordEvent(tx, ctx, 'OpportunityWon', o.id, { opportunityId: o.id, companyId: o.companyId, amountMinor: input.amountMinor, currency: (input.currency ?? o.currency).toUpperCase() });
    return { ok: true, stoppedEnrollments: live.length };
  }, TX);
}

/**
 * MarkOpportunityLost (screen #7 §36-37): a reason is required. A revisit date keeps the relationship: the linked
 * conversation is snoozed until then and comes back to a person.
 */
export async function markLost(db: PrismaClient, ctx: ServiceContext, opportunityId: string, input: { reason: LossReason; details?: string | null; competitor?: string | null; revisitAt?: Date | null; suggested?: boolean; evidenceQuote?: string | null }) {
  if (input.revisitAt && input.revisitAt.getTime() <= Date.now()) throw new ValidationError('The revisit date must be in the future', [{ path: 'revisitAt', message: 'Future date' }]);
  return db.$transaction(async (tx) => {
    const o = await load(tx, ctx, opportunityId);
    if (o.status !== 'OPEN') throw new BusinessRuleError('INVALID_STATE_TRANSITION', `This opportunity is already ${o.status.toLowerCase()}`);
    const { stage } = await pipelineStages(tx, ctx.workspaceId);
    const lost = stage('LOST')!;
    const now = new Date();
    const { count } = await tx.opportunity.updateMany({ where: { id: o.id, version: o.version, status: 'OPEN' }, data: { status: 'LOST', stageId: lost.id, stageEnteredAt: now, closedAt: now, nextActionOverride: null, version: { increment: 1 } } });
    if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This opportunity changed meanwhile — reload');
    await tx.opportunityLoss.create({
      data: { workspaceId: o.workspaceId, opportunityId: o.id, reasonCode: input.reason, details: input.details?.trim().slice(0, 1000) || null, competitor: input.competitor?.trim().slice(0, 200) || null, revisitAt: input.revisitAt ?? null, evidenceQuote: input.evidenceQuote?.slice(0, 500) ?? null, suggested: !!input.suggested, decidedById: ctx.actor.id },
    });
    await history(tx, ctx, o, o.stage, lost, `${input.reason}${input.details ? `: ${input.details}` : ''}`);
    if (input.revisitAt && o.conversationId) {
      const c = await tx.conversation.findFirst({ where: { id: o.conversationId } });
      if (c && c.stage !== 'SUPPRESSED') {
        const state = { stage: 'NURTURE' as const, mode: c.mode, waitingOn: 'NOBODY' as const, needsHuman: false, primaryIntent: c.primaryIntent, snoozedUntil: input.revisitAt, resolvedAt: null };
        await tx.conversation.update({ where: { id: c.id }, data: { ...state, category: categorize(state, now), escalationReason: null, version: { increment: 1 } } });
      }
    }
    await writeAudit(tx, ctx, { action: 'opportunity.lost', entityType: 'OPPORTUNITY', entityId: o.id, after: { reason: input.reason, revisitAt: input.revisitAt?.toISOString() ?? null, suggested: !!input.suggested }, reason: input.details ?? undefined });
    await recordEvent(tx, ctx, 'OpportunityLost', o.id, { opportunityId: o.id, companyId: o.companyId, reason: input.reason, revisitAt: input.revisitAt?.toISOString() ?? null });
    return { ok: true };
  }, TX);
}

/** Reopen a won or lost deal: explicit, with a reason, back to the stage it was in — never a silent status flip. */
export async function reopenOpportunity(db: PrismaClient, ctx: ServiceContext, opportunityId: string, reason: string) {
  if (!reason.trim()) throw new ValidationError('Say why the deal is reopened', [{ path: 'reason', message: 'Required' }]);
  return db.$transaction(async (tx) => {
    const o = await load(tx, ctx, opportunityId);
    if (o.status !== 'WON' && o.status !== 'LOST') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only a won or lost deal can be reopened');
    const last = await tx.opportunityStageHistory.findFirst({ where: { opportunityId: o.id, toSemantic: o.stage.semantic }, orderBy: { changedAt: 'desc' } });
    const { stage } = await pipelineStages(tx, ctx.workspaceId);
    const back = (last?.fromSemantic && last.fromSemantic !== 'WON' && last.fromSemantic !== 'LOST' ? stage(last.fromSemantic) : null) ?? stage('DISCOVERY')!;
    const { count } = await tx.opportunity.updateMany({ where: { id: o.id, version: o.version }, data: { status: 'OPEN', stageId: back.id, stageEnteredAt: new Date(), closedAt: null, version: { increment: 1 } } });
    if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This opportunity changed meanwhile — reload');
    await tx.opportunityLoss.updateMany({ where: { opportunityId: o.id, reopenedAt: null }, data: { reopenedAt: new Date() } });
    await history(tx, ctx, o, o.stage, back, `Reopened: ${reason.trim()}`);
    await writeAudit(tx, ctx, { action: 'opportunity.reopened', entityType: 'OPPORTUNITY', entityId: o.id, before: { status: o.status }, after: { status: 'OPEN', stage: back.semantic }, reason });
    await recordEvent(tx, ctx, 'OpportunityReopened', o.id, { opportunityId: o.id, from: o.status, to: back.semantic, reason: reason.trim() });
    return { ok: true };
  }, TX);
}

// ───────────────────────────── edits + stakeholders ─────────────────────────────

export interface OpportunityPatch {
  name?: string;
  service?: string | null;
  amountMinor?: number | null;
  currency?: string;
  ownerUserId?: string | null;
  primaryPersonId?: string | null;
  nextActionOverride?: string | null;
  nextActionDueAt?: Date | null;
}

export async function updateOpportunity(db: PrismaClient, ctx: ServiceContext, opportunityId: string, patch: OpportunityPatch, expectedVersion?: number) {
  return db.$transaction(async (tx) => {
    const o = await load(tx, ctx, opportunityId);
    if (expectedVersion !== undefined && o.version !== expectedVersion) throw new ConflictError('VERSION_CONFLICT', 'This opportunity changed meanwhile — reload');
    if (patch.amountMinor != null && patch.amountMinor < 0) throw new ValidationError('The value can not be negative', [{ path: 'amountMinor', message: 'Must be ≥ 0' }]);
    if (patch.ownerUserId) {
      const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: patch.ownerUserId } } });
      if (!member || member.status !== 'ACTIVE') throw new ValidationError('The owner must be an active member', [{ path: 'ownerUserId', message: 'Unknown member' }]);
    }
    if (patch.primaryPersonId && !(await tx.person.findFirst({ where: { id: patch.primaryPersonId, workspaceId: ctx.workspaceId }, select: { id: true } }))) throw new NotFoundError('Contact not found');
    const data: Prisma.OpportunityUpdateManyMutationInput & { primaryPersonId?: string | null; ownerUserId?: string | null } = {};
    if (patch.name !== undefined) data.name = patch.name.trim().slice(0, 200) || o.name;
    if (patch.service !== undefined) data.service = patch.service?.trim() || null;
    if (patch.amountMinor !== undefined) data.amountMinor = patch.amountMinor;
    if (patch.currency !== undefined) data.currency = patch.currency.toUpperCase();
    if (patch.ownerUserId !== undefined) data.ownerUserId = patch.ownerUserId;
    if (patch.primaryPersonId !== undefined) data.primaryPersonId = patch.primaryPersonId;
    if (patch.nextActionOverride !== undefined) data.nextActionOverride = patch.nextActionOverride?.trim().slice(0, 300) || null;
    if (patch.nextActionDueAt !== undefined) data.nextActionDueAt = patch.nextActionDueAt;
    const changed = Object.keys(data);
    if (!changed.length) return o;
    const { count } = await tx.opportunity.updateMany({ where: { id: o.id, version: o.version }, data: { ...data, version: { increment: 1 } } });
    if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This opportunity changed meanwhile — reload');
    await writeAudit(tx, ctx, { action: 'opportunity.updated', entityType: 'OPPORTUNITY', entityId: o.id, after: { changedFields: changed } });
    await recordEvent(tx, ctx, 'OpportunityUpdated', o.id, { opportunityId: o.id, changedFields: changed });
    return tx.opportunity.findUniqueOrThrow({ where: { id: o.id } });
  }, TX);
}

export async function addStakeholder(db: PrismaClient, ctx: ServiceContext, opportunityId: string, input: { personId?: string | null; name?: string | null; title?: string | null; role?: 'DECISION_MAKER' | 'INFLUENCER' | 'USER' | 'CHAMPION' | 'UNKNOWN'; influence?: string }) {
  return db.$transaction(async (tx) => {
    const o = await load(tx, ctx, opportunityId);
    let name = input.name?.trim() ?? '';
    if (input.personId) {
      const p = await tx.person.findFirst({ where: { id: input.personId, workspaceId: ctx.workspaceId } });
      if (!p) throw new NotFoundError('Person not found');
      name = p.fullName;
      if (await tx.opportunityStakeholder.findFirst({ where: { opportunityId: o.id, personId: p.id } })) throw new ConflictError('ALREADY_EXISTS', `${p.fullName} is already a stakeholder`);
    }
    if (!name) throw new ValidationError('Name the stakeholder', [{ path: 'name', message: 'Required' }]);
    const s = await tx.opportunityStakeholder.create({ data: { workspaceId: o.workspaceId, opportunityId: o.id, personId: input.personId ?? null, name: name.slice(0, 200), title: input.title?.trim() || null, role: input.role ?? 'UNKNOWN', influence: input.influence ?? 'UNKNOWN', status: 'KNOWN', source: 'MANUAL' } });
    await recordEvent(tx, ctx, 'OpportunityStakeholderAdded', o.id, { opportunityId: o.id, name: s.name, role: s.role, source: 'MANUAL' });
    return s;
  }, TX);
}

export async function updateStakeholder(db: PrismaClient, ctx: ServiceContext, opportunityId: string, stakeholderId: string, patch: { role?: 'DECISION_MAKER' | 'INFLUENCER' | 'USER' | 'CHAMPION' | 'UNKNOWN'; influence?: string; status?: 'SUGGESTED' | 'KNOWN' | 'ENGAGED' | 'NOT_CONTACTED'; name?: string; title?: string | null }) {
  const o = await load(db, ctx, opportunityId);
  const { count } = await db.opportunityStakeholder.updateMany({
    where: { id: stakeholderId, opportunityId: o.id },
    data: { ...(patch.role ? { role: patch.role } : {}), ...(patch.influence ? { influence: patch.influence } : {}), ...(patch.status ? { status: patch.status } : {}), ...(patch.name?.trim() ? { name: patch.name.trim().slice(0, 200) } : {}), ...(patch.title !== undefined ? { title: patch.title?.trim() || null } : {}) },
  });
  if (count !== 1) throw new NotFoundError('Stakeholder not found');
  return { ok: true };
}

export async function removeStakeholder(db: PrismaClient, ctx: ServiceContext, opportunityId: string, stakeholderId: string) {
  const o = await load(db, ctx, opportunityId);
  const { count } = await db.opportunityStakeholder.deleteMany({ where: { id: stakeholderId, opportunityId: o.id, source: { not: 'PRIMARY' } } });
  if (count !== 1) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'The primary contact stays — change the primary contact instead');
  return { ok: true };
}
