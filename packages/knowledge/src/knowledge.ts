import { createHash } from 'node:crypto';
import { Prisma, type KnowledgeItem, type KnowledgeOrigin, type KnowledgeRevision, type PrismaClient } from '@revenue-os/database';
import { actorUserId, isUniqueViolation, writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import {
  answerQuestion,
  BusinessRuleError,
  chunkKnowledge,
  ForbiddenError,
  knowledgeControlsOf,
  knowledgeTitle,
  KNOWLEDGE_TYPE_INFO,
  moneyAmountsIn,
  NotFoundError,
  questionKey,
  renderKnowledgeText,
  splitQuestions,
  textTokens,
  validateKnowledge,
  ValidationError,
  type ApprovedKnowledge,
  type Candidate,
  type KnowledgeAnswer,
  type KnowledgeContent,
  type KnowledgeControls,
  type KnowledgeType,
  type QuestionTopic,
} from '@revenue-os/shared';
import { DAY, nowOf, systemCtx, TX, type BrainDeps } from './deps.js';

const hashOf = (s: string) => createHash('sha256').update(s).digest('hex');
const OPEN_DRAFT = ['DRAFT', 'IN_REVIEW'] as const;

// ───────────────────────────── drafts ─────────────────────────────

export interface KnowledgeInput {
  type: KnowledgeType;
  title?: string;
  content: KnowledgeContent;
  serviceItemId?: string | null;
  ownerUserId?: string | null;
  reviewIntervalDays?: number | null;
  effectiveFrom?: Date | null;
  changeNote?: string | null;
  origin?: KnowledgeOrigin;
  sourceIds?: string[];
  gapId?: string | null;
  submit?: boolean;
}

function prepared(type: KnowledgeType, content: KnowledgeContent, title?: string) {
  const { content: clean, errors } = validateKnowledge(type, content);
  const name = (title?.trim() || knowledgeTitle(type, clean, title) || KNOWLEDGE_TYPE_INFO[type].label).slice(0, 300);
  const text = renderKnowledgeText(type, clean);
  return { content: clean, errors, title: name, text, contentHash: hashOf(`${type}\n${JSON.stringify(clean)}`) };
}

async function nextCode(tx: Tx, workspaceId: string, type: KnowledgeType): Promise<string> {
  const prefix = `KB-${KNOWLEDGE_TYPE_INFO[type].code}-`;
  const last = await tx.knowledgeItem.findFirst({ where: { workspaceId, code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } });
  const n = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

/**
 * A new knowledge item with its first (draft) revision (docs/13 §30-42): never AI authority until a person approves it.
 * The business profile is one item per workspace — a second "create" drafts a new version of it.
 */
export async function createKnowledge(db: PrismaClient, ctx: ServiceContext, input: KnowledgeInput): Promise<{ item: KnowledgeItem; revision: KnowledgeRevision; errors: string[] }> {
  if (input.type === 'PROFILE') {
    const existing = await db.knowledgeItem.findFirst({ where: { workspaceId: ctx.workspaceId, type: 'PROFILE', archivedAt: null } });
    if (existing) {
      const r = await saveDraft(db, ctx, existing.id, input);
      return { item: r.item, revision: r.revision, errors: r.errors };
    }
  }
  if (input.serviceItemId) await assertService(db, ctx.workspaceId, input.serviceItemId);
  const p = prepared(input.type, input.content, input.title);
  if (input.submit && p.errors.length) throw new ValidationError(p.errors.join('; '), p.errors.map((message) => ({ message })));
  const info = KNOWLEDGE_TYPE_INFO[input.type];
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const item = await tx.knowledgeItem.create({
          data: {
            workspaceId: ctx.workspaceId,
            code: await nextCode(tx, ctx.workspaceId, input.type),
            type: input.type,
            title: p.title,
            status: input.submit ? 'IN_REVIEW' : 'DRAFT',
            authorityLevel: info.authority,
            serviceItemId: input.serviceItemId ?? null,
            ownerUserId: input.ownerUserId ?? actorUserId(ctx),
            reviewIntervalDays: input.reviewIntervalDays ?? info.reviewDays,
            createdById: actorUserId(ctx),
          },
        });
        const revision = await tx.knowledgeRevision.create({
          data: {
            workspaceId: ctx.workspaceId,
            itemId: item.id,
            version: 1,
            title: p.title,
            content: p.content as Prisma.InputJsonValue,
            text: p.text,
            contentHash: p.contentHash,
            status: input.submit ? 'IN_REVIEW' : 'DRAFT',
            origin: input.origin ?? 'HUMAN',
            effectiveFrom: input.effectiveFrom ?? null,
            sourceIds: input.sourceIds ?? [],
            gapId: input.gapId ?? null,
            changeNote: input.changeNote ?? null,
            createdByType: ctx.actor.type,
            createdById: ctx.actor.id,
            submittedAt: input.submit ? new Date() : null,
          },
        });
        await recordEvent(tx, ctx, 'KnowledgeDraftCreated', item.id, { itemId: item.id, revisionId: revision.id, type: item.type, version: 1, origin: revision.origin });
        if (input.submit) await recordEvent(tx, ctx, 'KnowledgeReviewRequested', item.id, { itemId: item.id, revisionId: revision.id, version: 1 });
        await writeAudit(tx, ctx, { action: 'knowledge.created', entityType: 'KNOWLEDGE_ITEM', entityId: item.id, after: { code: item.code, type: item.type, title: item.title, origin: revision.origin } });
        return { item, revision, errors: p.errors };
      }, TX);
    } catch (err) {
      // Two drafts racing for the same code: take the next number.
      if (isUniqueViolation(err) && attempt < 3) continue;
      throw err;
    }
  }
}

async function assertService(db: PrismaClient | Tx, workspaceId: string, id: string) {
  const s = await db.knowledgeItem.findFirst({ where: { id, workspaceId, type: 'SERVICE' }, select: { id: true } });
  if (!s) throw new NotFoundError(`Service ${id} not found`);
}

async function itemOf(db: PrismaClient | Tx, workspaceId: string, itemId: string) {
  const item = await db.knowledgeItem.findFirst({ where: { id: itemId, workspaceId } });
  if (!item) throw new NotFoundError(`Knowledge item ${itemId} not found`);
  return item;
}

/**
 * Edits continue the one open draft (never the approved version — that is history). With no open draft, a new
 * version is started from the given content; the live version keeps answering until the new one is approved.
 */
export async function saveDraft(db: PrismaClient, ctx: ServiceContext, itemId: string, input: Partial<KnowledgeInput> & { content: KnowledgeContent }) {
  const item = await itemOf(db, ctx.workspaceId, itemId);
  if (item.status === 'ARCHIVED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Archived knowledge cannot be edited');
  if (input.serviceItemId) await assertService(db, ctx.workspaceId, input.serviceItemId);
  const p = prepared(item.type, input.content, input.title);
  if (input.submit && p.errors.length) throw new ValidationError(p.errors.join('; '), p.errors.map((message) => ({ message })));
  return db.$transaction(async (tx) => {
    const open = await tx.knowledgeRevision.findFirst({ where: { itemId, status: { in: [...OPEN_DRAFT] } } });
    const status = input.submit ? 'IN_REVIEW' : 'DRAFT';
    const data = {
      title: p.title,
      content: p.content as Prisma.InputJsonValue,
      text: p.text,
      contentHash: p.contentHash,
      status,
      effectiveFrom: input.effectiveFrom === undefined ? (open?.effectiveFrom ?? null) : input.effectiveFrom,
      changeNote: input.changeNote ?? open?.changeNote ?? null,
      submittedAt: input.submit ? new Date() : null,
    } as const;
    let revision: KnowledgeRevision;
    if (open) revision = await tx.knowledgeRevision.update({ where: { id: open.id }, data });
    else {
      const last = await tx.knowledgeRevision.findFirst({ where: { itemId }, orderBy: { version: 'desc' }, select: { version: true } });
      revision = await tx.knowledgeRevision.create({
        data: { ...data, workspaceId: ctx.workspaceId, itemId, version: (last?.version ?? 0) + 1, origin: input.origin ?? 'HUMAN', sourceIds: input.sourceIds ?? [], gapId: input.gapId ?? null, createdByType: ctx.actor.type, createdById: ctx.actor.id },
      });
      await recordEvent(tx, ctx, 'KnowledgeDraftCreated', item.id, { itemId, revisionId: revision.id, type: item.type, version: revision.version, origin: revision.origin });
    }
    const updated = await tx.knowledgeItem.update({
      where: { id: itemId },
      data: {
        ...(item.currentRevisionId ? {} : { title: p.title, status: status === 'IN_REVIEW' ? 'IN_REVIEW' : 'DRAFT' }),
        ...(input.serviceItemId !== undefined ? { serviceItemId: input.serviceItemId } : {}),
        ...(input.reviewIntervalDays !== undefined ? { reviewIntervalDays: input.reviewIntervalDays } : {}),
        ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
        version: { increment: 1 },
      },
    });
    if (input.submit) await recordEvent(tx, ctx, 'KnowledgeReviewRequested', item.id, { itemId, revisionId: revision.id, version: revision.version });
    await writeAudit(tx, ctx, { action: 'knowledge.draft_saved', entityType: 'KNOWLEDGE_ITEM', entityId: itemId, after: { version: revision.version, status } });
    return { item: updated, revision, errors: p.errors };
  }, TX);
}

export async function submitForReview(db: PrismaClient, ctx: ServiceContext, itemId: string) {
  const item = await itemOf(db, ctx.workspaceId, itemId);
  const open = await db.knowledgeRevision.findFirst({ where: { itemId, status: 'DRAFT' } });
  if (!open) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'No draft to submit');
  const { errors } = validateKnowledge(item.type, open.content as KnowledgeContent);
  if (errors.length) throw new ValidationError(errors.join('; '), errors.map((message) => ({ message })));
  return db.$transaction(async (tx) => {
    const revision = await tx.knowledgeRevision.update({ where: { id: open.id }, data: { status: 'IN_REVIEW', submittedAt: new Date() } });
    if (!item.currentRevisionId) await tx.knowledgeItem.update({ where: { id: itemId }, data: { status: 'IN_REVIEW', version: { increment: 1 } } });
    await recordEvent(tx, ctx, 'KnowledgeReviewRequested', itemId, { itemId, revisionId: revision.id, version: revision.version });
    await writeAudit(tx, ctx, { action: 'knowledge.submitted', entityType: 'KNOWLEDGE_ITEM', entityId: itemId, after: { version: revision.version } });
    return revision;
  }, TX);
}

// ───────────────────────────── approve / publish ─────────────────────────────

export interface ApproveOptions {
  /** knowledge.approve_commercial — pricing, policies and claims (screen #13 §59). */
  canApproveCommercial: boolean;
  now?: Date;
}

function assertCanApprove(type: KnowledgeType, opts: ApproveOptions) {
  if (KNOWLEDGE_TYPE_INFO[type].commercial && !opts.canApproveCommercial) {
    throw new ForbiddenError(`${KNOWLEDGE_TYPE_INFO[type].plural} need commercial approval (owner) before the AI may use them`);
  }
}

/**
 * Approve the open draft (docs/13 §30-42, screen #13 §59-60). Live now, or scheduled: a future effective date keeps the
 * current version answering until then. Conflicts with other approved knowledge are recorded — the AI won't answer
 * from either side until a person resolves them.
 */
export async function approveKnowledge(db: PrismaClient, ctx: ServiceContext, itemId: string, opts: ApproveOptions) {
  const now = opts.now ?? new Date();
  const item = await itemOf(db, ctx.workspaceId, itemId);
  assertCanApprove(item.type, opts);
  if (ctx.actor.type !== 'HUMAN' || !ctx.actor.id) throw new ForbiddenError('Only a person approves knowledge — AI-created knowledge starts as a draft');
  const open = await db.knowledgeRevision.findFirst({ where: { itemId, status: { in: [...OPEN_DRAFT] } } });
  if (!open) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Nothing to approve — no open draft');
  const { errors } = validateKnowledge(item.type, open.content as KnowledgeContent);
  if (errors.length) throw new ValidationError(errors.join('; '), errors.map((message) => ({ message })));

  return db.$transaction(async (tx) => {
    const scheduled = open.effectiveFrom && open.effectiveFrom > now;
    const approved = await tx.knowledgeRevision.update({ where: { id: open.id }, data: { status: 'APPROVED', approvedById: ctx.actor.id, approvedAt: now } });
    await recordEvent(tx, ctx, 'KnowledgeApproved', itemId, { itemId, revisionId: approved.id, version: approved.version, effectiveFrom: scheduled ? open.effectiveFrom!.toISOString() : null });
    await writeAudit(tx, ctx, { action: 'knowledge.approved', entityType: 'KNOWLEDGE_ITEM', entityId: itemId, after: { version: approved.version, effectiveFrom: open.effectiveFrom?.toISOString() ?? null } });
    if (scheduled) return { item: await tx.knowledgeItem.findUniqueOrThrow({ where: { id: itemId } }), revision: approved, scheduled: true, conflicts: 0 };
    const published = await publishTx(tx, ctx, item, approved, now);
    return { ...published, scheduled: false };
  }, TX);
}

/** Makes an approved revision the current truth: the old one becomes history, chunks are cut, the embed job follows. */
export async function publishTx(tx: Tx, ctx: ServiceContext, item: KnowledgeItem, rev: KnowledgeRevision, now: Date) {
  const previous = item.currentRevisionId;
  if (previous && previous !== rev.id) await tx.knowledgeRevision.updateMany({ where: { id: previous, status: 'APPROVED' }, data: { status: 'SUPERSEDED', supersededAt: now } });
  // A scheduled older version that never went live is history too once a newer one is published.
  await tx.knowledgeRevision.updateMany({ where: { itemId: item.id, status: 'APPROVED', publishedAt: null, version: { lt: rev.version }, id: { not: rev.id } }, data: { status: 'SUPERSEDED', supersededAt: now } });
  const revision = await tx.knowledgeRevision.update({ where: { id: rev.id }, data: { publishedAt: now } });
  const interval = item.reviewIntervalDays ?? KNOWLEDGE_TYPE_INFO[item.type].reviewDays;
  const updated = await tx.knowledgeItem.update({
    where: { id: item.id },
    data: { currentRevisionId: rev.id, status: 'APPROVED', title: rev.title, lastReviewedAt: now, nextReviewAt: new Date(now.getTime() + interval * DAY), needsReview: false, needsReviewReason: null, version: { increment: 1 } },
  });
  const chunks = chunkKnowledge(item.type, rev.title, rev.content as KnowledgeContent);
  if (chunks.length) {
    await tx.knowledgeChunk.createMany({
      data: chunks.map((c) => ({ workspaceId: item.workspaceId, itemId: item.id, revisionId: rev.id, chunkIndex: c.index, heading: c.heading, content: c.content, contentHash: hashOf(c.content) })),
      skipDuplicates: true,
    });
  }
  const conflicts = await detectConflictsTx(tx, ctx, updated, revision, now);
  // A gap this draft was written for is resolved by its approval.
  if (rev.gapId) await resolveGapTx(tx, ctx, rev.gapId, item.id, now);
  await recordEvent(tx, ctx, 'KnowledgePublished', item.id, { itemId: item.id, revisionId: rev.id, version: rev.version, previousRevisionId: previous ?? null });
  return { item: updated, revision, conflicts };
}

const normName = (s: string) => textTokens(s).join(' ');

/**
 * Knowledge that disagrees with other approved knowledge (docs/13 §47-57): the same FAQ answered two ways, the same
 * system with two support statuses, a price in an FAQ that the price list contradicts.
 */
async function detectConflictsTx(tx: Tx, ctx: ServiceContext, item: KnowledgeItem, rev: KnowledgeRevision, now: Date): Promise<number> {
  const others = await tx.knowledgeItem.findMany({ where: { workspaceId: item.workspaceId, id: { not: item.id }, archivedAt: null, currentRevisionId: { not: null }, status: { in: ['APPROVED', 'STALE', 'CONFLICT'] } } });
  if (!others.length) return 0;
  const revs = await tx.knowledgeRevision.findMany({ where: { id: { in: others.map((o) => o.currentRevisionId!) } } });
  const byItem = new Map(revs.map((r) => [r.itemId, r]));
  const c = rev.content as KnowledgeContent;
  const found: { other: KnowledgeItem; otherRev: KnowledgeRevision; type: string; topic: string; detail: string }[] = [];
  for (const o of others) {
    const orev = byItem.get(o.id);
    if (!orev) continue;
    const oc = orev.content as KnowledgeContent;
    if (o.type === item.type && item.type === 'FAQ' && questionKey(String(oc.question)) === questionKey(String(c.question)) && String(oc.answer).trim() !== String(c.answer).trim()) {
      found.push({ other: o, otherRev: orev, type: 'DUPLICATE', topic: String(c.question).slice(0, 200), detail: `${o.code} answers the same question differently` });
    }
    if (o.type === item.type && item.type === 'INTEGRATION' && normName(String(oc.name)) === normName(String(c.name)) && oc.status !== c.status) {
      found.push({ other: o, otherRev: orev, type: 'VALUE_CONFLICT', topic: `${c.name} integration`, detail: `${o.code} says "${String(oc.status).toLowerCase()}", ${item.code} says "${String(c.status).toLowerCase()}"` });
    }
    if (o.type === item.type && item.type === 'PRICING' && normName(String(oc.name)) === normName(String(c.name)) && (oc.price !== c.price || oc.priceType !== c.priceType)) {
      found.push({ other: o, otherRev: orev, type: 'VALUE_CONFLICT', topic: `${c.name} pricing`, detail: `${o.code} and ${item.code} price ${c.name} differently` });
    }
    // A price named in text that the price list contradicts (pricing table $4,500 vs FAQ $3,900).
    const pricing = item.type === 'PRICING' ? { p: item, pr: rev, t: o, tr: orev } : o.type === 'PRICING' ? { p: o, pr: orev, t: item, tr: rev } : null;
    if (pricing && pricing.t.type !== 'PRICING') {
      const pc = pricing.pr.content as KnowledgeContent;
      const name = String(pc.name ?? '');
      if (name && pricing.tr.text.toLowerCase().includes(name.toLowerCase())) {
        const allowed = new Set([pc.price, pc.maxPrice, pc.perExtraUnit, ...(((pc.addOns as { price: number | null }[]) ?? []).map((a) => a.price))].filter((x): x is number => typeof x === 'number'));
        const stated = moneyAmountsIn(pricing.tr.text).filter((a) => !allowed.has(a));
        if (stated.length && allowed.size) found.push({ other: o, otherRev: orev, type: 'VALUE_CONFLICT', topic: `${name} pricing`, detail: `${pricing.t.code} states ${stated.map((s) => `$${s}`).join(', ')} for ${name}; the approved price list (${pricing.p.code}) says otherwise` });
      }
    }
  }
  for (const f of found) {
    const conflict = await tx.knowledgeConflict.create({
      data: { workspaceId: item.workspaceId, itemId: item.id, revisionId: rev.id, otherItemId: f.other.id, otherRevisionId: f.otherRev.id, topic: f.topic, conflictType: f.type, detail: f.detail.slice(0, 500), detectedAt: now },
    });
    await tx.knowledgeItem.updateMany({ where: { id: { in: [item.id, f.other.id] } }, data: { status: 'CONFLICT' } });
    await recordEvent(tx, ctx, 'KnowledgeConflictDetected', item.id, { conflictId: conflict.id, itemId: item.id, conflictType: f.type });
  }
  return found.length;
}

export async function rejectKnowledge(db: PrismaClient, ctx: ServiceContext, itemId: string, reason: string) {
  const item = await itemOf(db, ctx.workspaceId, itemId);
  const open = await db.knowledgeRevision.findFirst({ where: { itemId, status: { in: [...OPEN_DRAFT] } } });
  if (!open) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Nothing to reject — no open draft');
  return db.$transaction(async (tx) => {
    const revision = await tx.knowledgeRevision.update({ where: { id: open.id }, data: { status: 'REJECTED', rejectedReason: reason.slice(0, 500) } });
    if (!item.currentRevisionId) await tx.knowledgeItem.update({ where: { id: itemId }, data: { status: 'REJECTED', version: { increment: 1 } } });
    if (open.gapId) await tx.knowledgeGap.updateMany({ where: { id: open.gapId, status: { in: ['DRAFTED', 'IN_REVIEW'] } }, data: { status: 'OPEN', draftItemId: null } });
    await recordEvent(tx, ctx, 'KnowledgeRejected', itemId, { itemId, revisionId: revision.id, version: revision.version });
    await writeAudit(tx, ctx, { action: 'knowledge.rejected', entityType: 'KNOWLEDGE_ITEM', entityId: itemId, after: { version: revision.version }, reason });
    return revision;
  }, TX);
}

/** "Restore v4" (screen #13 §58): a new current version is made from v4 — history is never rewritten. */
export async function restoreVersion(db: PrismaClient, ctx: ServiceContext, itemId: string, version: number, opts: ApproveOptions) {
  const now = opts.now ?? new Date();
  const item = await itemOf(db, ctx.workspaceId, itemId);
  assertCanApprove(item.type, opts);
  if (ctx.actor.type !== 'HUMAN' || !ctx.actor.id) throw new ForbiddenError('Only a person restores knowledge');
  const source = await db.knowledgeRevision.findFirst({ where: { itemId, version } });
  if (!source) throw new NotFoundError(`Version ${version} not found`);
  if (source.id === item.currentRevisionId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `v${version} is already the current version`);
  if (await db.knowledgeRevision.findFirst({ where: { itemId, status: { in: [...OPEN_DRAFT] } }, select: { id: true } })) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'An open draft exists — approve or reject it first');
  return db.$transaction(async (tx) => {
    const last = await tx.knowledgeRevision.findFirst({ where: { itemId }, orderBy: { version: 'desc' }, select: { version: true } });
    const rev = await tx.knowledgeRevision.create({
      data: {
        workspaceId: ctx.workspaceId,
        itemId,
        version: (last?.version ?? 0) + 1,
        title: source.title,
        content: source.content as Prisma.InputJsonValue,
        text: source.text,
        contentHash: source.contentHash,
        status: 'APPROVED',
        origin: 'ROLLBACK',
        changeNote: `Restored from v${version}`,
        createdByType: ctx.actor.type,
        createdById: ctx.actor.id,
        approvedById: ctx.actor.id,
        approvedAt: now,
      },
    });
    await recordEvent(tx, ctx, 'KnowledgeDraftCreated', itemId, { itemId, revisionId: rev.id, type: item.type, version: rev.version, origin: 'ROLLBACK' });
    await recordEvent(tx, ctx, 'KnowledgeApproved', itemId, { itemId, revisionId: rev.id, version: rev.version, effectiveFrom: null });
    await writeAudit(tx, ctx, { action: 'knowledge.restored', entityType: 'KNOWLEDGE_ITEM', entityId: itemId, after: { from: version, version: rev.version } });
    return publishTx(tx, ctx, item, rev, now);
  }, TX);
}

/** Re-checked without changes (the "Last verified" date moves; a stale item is fresh again). */
export async function markReviewed(db: PrismaClient, ctx: ServiceContext, itemId: string, opts: ApproveOptions) {
  const now = opts.now ?? new Date();
  const item = await itemOf(db, ctx.workspaceId, itemId);
  assertCanApprove(item.type, opts);
  if (!item.currentRevisionId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Nothing approved to re-check yet');
  const interval = item.reviewIntervalDays ?? KNOWLEDGE_TYPE_INFO[item.type].reviewDays;
  return db.$transaction(async (tx) => {
    const updated = await tx.knowledgeItem.update({
      where: { id: itemId },
      data: { lastReviewedAt: now, nextReviewAt: new Date(now.getTime() + interval * DAY), status: item.status === 'STALE' ? 'APPROVED' : item.status, needsReview: false, needsReviewReason: null, version: { increment: 1 } },
    });
    const rev = await tx.knowledgeRevision.findUniqueOrThrow({ where: { id: item.currentRevisionId! } });
    await recordEvent(tx, ctx, 'KnowledgeApproved', itemId, { itemId, revisionId: rev.id, version: rev.version, effectiveFrom: null });
    await writeAudit(tx, ctx, { action: 'knowledge.reviewed', entityType: 'KNOWLEDGE_ITEM', entityId: itemId, after: { nextReviewAt: updated.nextReviewAt?.toISOString() } });
    return updated;
  }, TX);
}

/** Emergency disable (screen #13 §91): unavailable to the AI immediately; questions it answered go to a person. */
export async function setKnowledgeDisabled(db: PrismaClient, ctx: ServiceContext, itemId: string, disabled: boolean, reason?: string) {
  const item = await itemOf(db, ctx.workspaceId, itemId);
  if (disabled && !reason?.trim()) throw new ValidationError('Say why the item is disabled');
  return db.$transaction(async (tx) => {
    const updated = await tx.knowledgeItem.update({
      where: { id: itemId },
      data: disabled ? { aiDisabled: true, aiDisabledReason: reason!.trim().slice(0, 300), aiDisabledAt: new Date(), aiDisabledById: actorUserId(ctx), version: { increment: 1 } } : { aiDisabled: false, aiDisabledReason: null, aiDisabledAt: null, aiDisabledById: null, version: { increment: 1 } },
    });
    await recordEvent(tx, ctx, disabled ? 'KnowledgeDisabled' : 'KnowledgeEnabled', itemId, { itemId });
    await writeAudit(tx, ctx, { action: disabled ? 'knowledge.disabled' : 'knowledge.enabled', entityType: 'KNOWLEDGE_ITEM', entityId: itemId, before: { aiDisabled: item.aiDisabled }, after: { aiDisabled: disabled }, reason });
    return updated;
  }, TX);
}

export async function archiveKnowledge(db: PrismaClient, ctx: ServiceContext, itemId: string, reason: string) {
  await itemOf(db, ctx.workspaceId, itemId);
  return db.$transaction(async (tx) => {
    const updated = await tx.knowledgeItem.update({ where: { id: itemId }, data: { status: 'ARCHIVED', archivedAt: new Date(), version: { increment: 1 } } });
    await tx.knowledgeRevision.updateMany({ where: { itemId, status: { in: [...OPEN_DRAFT] } }, data: { status: 'REJECTED', rejectedReason: 'Item archived' } });
    await recordEvent(tx, ctx, 'KnowledgeArchived', itemId, { itemId });
    await writeAudit(tx, ctx, { action: 'knowledge.archived', entityType: 'KNOWLEDGE_ITEM', entityId: itemId, reason });
    return updated;
  }, TX);
}

/** Granular kill rules (screen #13 §92): "Disable AI pricing answers" without shutting the AI down. */
export async function setKnowledgeControls(db: PrismaClient, ctx: ServiceContext, input: Partial<KnowledgeControls>) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { knowledgeControls: true } });
  const before = knowledgeControlsOf(ws.knowledgeControls);
  const after = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === 'boolean')) } as KnowledgeControls;
  const changed = (Object.keys(after) as (keyof KnowledgeControls)[]).filter((k) => after[k] !== before[k]);
  if (!changed.length) return after;
  await db.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id: ctx.workspaceId }, data: { knowledgeControls: after as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
    await recordEvent(tx, ctx, 'KnowledgeControlsChanged', ctx.workspaceId, { changedFields: changed });
    await writeAudit(tx, ctx, { action: 'knowledge.controls_changed', entityType: 'WORKSPACE', entityId: ctx.workspaceId, before, after });
  }, TX);
  return after;
}

const NEGATIVE = ['OUTDATED', 'INCORRECT', 'INCOMPLETE'];

/** [Helpful] [Outdated] [Incorrect] [Incomplete] — repeated negative reports put the item up for review (screen #13 §56). */
export async function recordKnowledgeFeedback(db: PrismaClient, ctx: ServiceContext, itemId: string, input: { kind: string; note?: string | null }) {
  const item = await itemOf(db, ctx.workspaceId, itemId);
  return db.$transaction(async (tx) => {
    await tx.knowledgeFeedback.create({ data: { workspaceId: ctx.workspaceId, itemId, revisionId: item.currentRevisionId, kind: input.kind, note: input.note?.slice(0, 500) ?? null, userId: actorUserId(ctx) } });
    let flagged = false;
    if (NEGATIVE.includes(input.kind)) {
      const since = item.lastReviewedAt ?? item.createdAt;
      const count = await tx.knowledgeFeedback.count({ where: { itemId, kind: { in: NEGATIVE }, createdAt: { gte: since } } });
      if (count >= 2 && !item.needsReview) {
        flagged = true;
        await tx.knowledgeItem.update({ where: { id: itemId }, data: { needsReview: true, needsReviewReason: `${count} people reported it as outdated, incorrect or incomplete`, version: { increment: 1 } } });
        await recordEvent(tx, ctx, 'KnowledgeStale', itemId, { itemId, reason: 'Repeated negative feedback' });
      }
    }
    await recordEvent(tx, ctx, 'KnowledgeFeedbackRecorded', itemId, { itemId, kind: input.kind });
    return { flagged };
  }, TX);
}

export async function resolveKnowledgeConflict(db: PrismaClient, ctx: ServiceContext, conflictId: string, input: { resolution: 'RESOLVED' | 'DISMISSED'; note?: string | null }) {
  const conflict = await db.knowledgeConflict.findFirst({ where: { id: conflictId, workspaceId: ctx.workspaceId } });
  if (!conflict) throw new NotFoundError(`Conflict ${conflictId} not found`);
  if (conflict.status !== 'OPEN') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Conflict already handled');
  return db.$transaction(async (tx) => {
    const updated = await tx.knowledgeConflict.update({ where: { id: conflictId }, data: { status: input.resolution, resolution: input.note?.slice(0, 500) ?? input.resolution.toLowerCase(), resolvedById: actorUserId(ctx), resolvedAt: new Date() } });
    // Items with no other open conflict answer again.
    for (const id of [conflict.itemId, conflict.otherItemId].filter((x): x is string => !!x)) {
      const open = await tx.knowledgeConflict.count({ where: { status: 'OPEN', OR: [{ itemId: id }, { otherItemId: id }] } });
      if (!open) await tx.knowledgeItem.updateMany({ where: { id, status: 'CONFLICT', currentRevisionId: { not: null } }, data: { status: 'APPROVED' } });
    }
    await recordEvent(tx, ctx, 'KnowledgeConflictResolved', conflict.itemId, { conflictId, itemId: conflict.itemId, resolution: input.resolution });
    await writeAudit(tx, ctx, { action: 'knowledge.conflict_resolved', entityType: 'KNOWLEDGE_ITEM', entityId: conflict.itemId, after: { conflictId, resolution: input.resolution }, reason: input.note ?? undefined });
    return updated;
  }, TX);
}

// ───────────────────────────── gaps ─────────────────────────────

/**
 * Questions the AI could not answer from approved knowledge (screen #13 §47-50): one gap per normalised question,
 * counting how often and in which conversations it was asked. A resolved gap asked again (still unanswerable) reopens.
 */
export async function recordGapsTx(tx: Tx, ctx: ServiceContext, input: { questions: { question: string; topic: QuestionTopic }[]; conversationId: string | null; companyId: string | null; now: Date }) {
  const ids: string[] = [];
  for (const q of input.questions) {
    const key = questionKey(q.question);
    const existing = await tx.knowledgeGap.findUnique({ where: { workspaceId_key: { workspaceId: ctx.workspaceId, key } } });
    if (existing) {
      const conversationIds = input.conversationId && !existing.conversationIds.includes(input.conversationId) ? [...existing.conversationIds, input.conversationId] : existing.conversationIds;
      const companyIds = input.companyId && !existing.companyIds.includes(input.companyId) ? [...existing.companyIds, input.companyId] : existing.companyIds;
      const reopened = existing.status === 'RESOLVED' || existing.status === 'DISMISSED';
      const gap = await tx.knowledgeGap.update({
        where: { id: existing.id },
        data: { occurrences: { increment: 1 }, conversationIds, companyIds, lastSeenAt: input.now, priority: (existing.occurrences + 1) * 10 + conversationIds.length * 5, ...(reopened ? { status: 'OPEN', resolvedAt: null, resolvedItemId: null } : {}) },
      });
      if (reopened) await recordEvent(tx, ctx, 'KnowledgeGapDetected', gap.id, { gapId: gap.id, topic: gap.topic, occurrences: gap.occurrences });
      ids.push(gap.id);
    } else {
      const gap = await tx.knowledgeGap.create({
        data: { workspaceId: ctx.workspaceId, key, question: q.question.slice(0, 500), topic: q.topic, conversationIds: input.conversationId ? [input.conversationId] : [], companyIds: input.companyId ? [input.companyId] : [], priority: 15, firstSeenAt: input.now, lastSeenAt: input.now },
      });
      await recordEvent(tx, ctx, 'KnowledgeGapDetected', gap.id, { gapId: gap.id, topic: gap.topic, occurrences: 1 });
      ids.push(gap.id);
    }
  }
  return ids;
}

async function resolveGapTx(tx: Tx, ctx: ServiceContext, gapId: string, itemId: string | null, now: Date) {
  const { count } = await tx.knowledgeGap.updateMany({ where: { id: gapId, status: { in: ['OPEN', 'DRAFTED', 'IN_REVIEW'] } }, data: { status: 'RESOLVED', resolvedItemId: itemId, resolvedAt: now } });
  if (count) await recordEvent(tx, ctx, 'KnowledgeGapResolved', gapId, { gapId, itemId, status: 'RESOLVED' });
}

/** A person answers a gap → an FAQ draft linked to it (the Knowledge Improvement Loop, screen #13 §50). */
export async function answerGap(db: PrismaClient, ctx: ServiceContext, gapId: string, input: { answer: string; question?: string; category?: string; submit?: boolean }) {
  const gap = await db.knowledgeGap.findFirst({ where: { id: gapId, workspaceId: ctx.workspaceId } });
  if (!gap) throw new NotFoundError(`Gap ${gapId} not found`);
  if (gap.status === 'RESOLVED' || gap.status === 'DISMISSED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This gap is already closed');
  if (gap.draftItemId) {
    const r = await saveDraft(db, ctx, gap.draftItemId, { content: { question: input.question ?? gap.question, answer: input.answer, category: input.category ?? 'GENERAL' }, origin: 'HUMAN_ANSWER', gapId, submit: input.submit });
    return r;
  }
  const r = await createKnowledge(db, ctx, { type: 'FAQ', content: { question: input.question ?? gap.question, answer: input.answer, category: input.category ?? 'GENERAL' }, origin: 'HUMAN_ANSWER', gapId, submit: input.submit, changeNote: 'Answer to a knowledge gap' });
  await db.knowledgeGap.update({ where: { id: gapId }, data: { status: input.submit ? 'IN_REVIEW' : 'DRAFTED', draftItemId: r.item.id } });
  return r;
}

export async function dismissGap(db: PrismaClient, ctx: ServiceContext, gapId: string, reason: string) {
  const gap = await db.knowledgeGap.findFirst({ where: { id: gapId, workspaceId: ctx.workspaceId } });
  if (!gap) throw new NotFoundError(`Gap ${gapId} not found`);
  await db.$transaction(async (tx) => {
    await tx.knowledgeGap.update({ where: { id: gapId }, data: { status: 'DISMISSED', resolvedAt: new Date() } });
    await recordEvent(tx, ctx, 'KnowledgeGapResolved', gapId, { gapId, itemId: null, status: 'DISMISSED' });
    await writeAudit(tx, ctx, { action: 'knowledge.gap_dismissed', entityType: 'KNOWLEDGE_GAP', entityId: gapId, reason });
  }, TX);
}

/** After new knowledge goes live: open gaps the engine can now answer are resolved by it. */
export async function resolveAnsweredGaps(deps: BrainDeps, workspaceId: string): Promise<number> {
  const gaps = await deps.db.knowledgeGap.findMany({ where: { workspaceId, status: { in: ['OPEN', 'DRAFTED', 'IN_REVIEW'] } }, take: 200 });
  if (!gaps.length) return 0;
  const { answers } = await answerQuestions(deps, workspaceId, gaps.map((g) => g.question));
  let resolved = 0;
  await deps.db.$transaction(async (tx) => {
    for (const [i, a] of answers.entries()) {
      if (a.decision !== 'ANSWER') continue;
      await resolveGapTx(tx, systemCtx(workspaceId), gaps[i]!.id, a.used[0]?.itemId ?? null, nowOf(deps));
      resolved++;
    }
  }, TX);
  return resolved;
}

// ───────────────────────────── retrieval ─────────────────────────────

/**
 * Approved, current, enabled knowledge of one workspace (docs/13 §100-113 hard filters before ranking): workspace,
 * status, not disabled, not archived. A scheduled revision whose effective date has come is used even before the sweep
 * formally publishes it; a future one never is.
 */
export async function approvedKnowledge(db: PrismaClient | Tx, workspaceId: string, now = new Date()): Promise<ApprovedKnowledge[]> {
  const items = await db.knowledgeItem.findMany({ where: { workspaceId, archivedAt: null, aiDisabled: false, currentRevisionId: { not: null }, status: { in: ['APPROVED', 'STALE', 'CONFLICT'] } }, take: 1000 });
  if (!items.length) return [];
  const [current, due, conflicts] = await Promise.all([
    db.knowledgeRevision.findMany({ where: { id: { in: items.map((i) => i.currentRevisionId!) } } }),
    db.knowledgeRevision.findMany({ where: { workspaceId, itemId: { in: items.map((i) => i.id) }, status: 'APPROVED', publishedAt: null, effectiveFrom: { lte: now } }, orderBy: { version: 'desc' } }),
    db.knowledgeConflict.findMany({ where: { workspaceId, status: 'OPEN' }, select: { itemId: true, otherItemId: true } }),
  ]);
  // A conflict blocks only when both sides are live knowledge. A document candidate disagreeing with the approved price
  // is a review item — current approved structured knowledge keeps its authority (docs/13 §47-57).
  const live = new Set(items.map((i) => i.id));
  const conflicted = new Set(conflicts.filter((c) => live.has(c.itemId) && (!c.otherItemId || live.has(c.otherItemId))).flatMap((c) => [c.itemId, c.otherItemId].filter((x): x is string => !!x)));
  const byItem = new Map(current.map((r) => [r.itemId, r]));
  for (const r of due) {
    const cur = byItem.get(r.itemId);
    if (!cur || r.version > cur.version) byItem.set(r.itemId, r);
  }
  return items.flatMap((i) => {
    const r = byItem.get(i.id);
    if (!r) return [];
    return [
      {
        itemId: i.id,
        revisionId: r.id,
        code: i.code,
        type: i.type as KnowledgeType,
        title: r.title,
        version: r.version,
        content: r.content as KnowledgeContent,
        text: r.text,
        stale: i.status === 'STALE' || i.needsReview || (i.nextReviewAt !== null && i.nextReviewAt < now),
        conflicted: i.status === 'CONFLICT' || conflicted.has(i.id),
        serviceItemId: i.serviceItemId,
        authorityLevel: i.authorityLevel,
      },
    ];
  });
}

const vectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;

/**
 * Best vector similarity per item for each question (pgvector cosine, only over chunks of the given current revisions
 * and the same embedding model). null when no embeddings provider is connected — retrieval then uses keywords and
 * structured records only (vector search is support, never truth).
 */
export async function semanticScores(deps: BrainDeps, workspaceId: string, questions: string[], revisionIds: string[]): Promise<Map<string, number>[] | null> {
  if (!questions.length || !revisionIds.length) return null;
  let embedded;
  try {
    embedded = await deps.providers.call({ workspaceId, capability: 'EMBEDDINGS', operation: 'knowledge.embed_query', timeoutMs: 20_000 }, (adapter, options) => adapter.embed({ texts: questions, purpose: 'QUERY' }, options));
  } catch {
    return null;
  }
  const { vectors, model } = embedded.value;
  const out: Map<string, number>[] = [];
  for (const v of vectors) {
    const rows = await deps.db.$queryRaw<{ itemId: string; sim: number }[]>(Prisma.sql`
      SELECT "itemId", MAX(1 - ("embedding" <=> ${vectorLiteral(v)}::vector)) AS sim
      FROM "KnowledgeChunk"
      WHERE "workspaceId" = ${workspaceId}::uuid AND "embeddingModel" = ${model} AND "embedding" IS NOT NULL
        AND "revisionId" = ANY(${revisionIds}::uuid[])
      GROUP BY "itemId"`);
    out.push(new Map(rows.map((r) => [r.itemId, Number(r.sim)])));
  }
  return out;
}

export interface AnswerSet {
  answers: KnowledgeAnswer[];
  items: ApprovedKnowledge[];
  controls: KnowledgeControls;
  semantic: boolean;
}

/** The Answer Engine over this workspace's approved knowledge, one answer per question (structured first, hybrid next). */
export async function answerQuestions(deps: BrainDeps, workspaceId: string, questions: string[], opts: { now?: Date } = {}): Promise<AnswerSet> {
  const now = opts.now ?? nowOf(deps);
  const [items, ws] = await Promise.all([approvedKnowledge(deps.db, workspaceId, now), deps.db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { knowledgeControls: true } })]);
  const controls = knowledgeControlsOf(ws.knowledgeControls);
  if (!questions.length) return { answers: [], items, controls, semantic: false };
  const sims = items.length ? await semanticScores(deps, workspaceId, questions, items.map((i) => i.revisionId)) : null;
  const answers = questions.map((q, i) => {
    const candidates: Candidate[] = items.map((k) => ({ k, semantic: sims ? (sims[i]!.get(k.itemId) ?? 0) : null }));
    return answerQuestion(q, candidates, controls);
  });
  return { answers, items, controls, semantic: sims !== null };
}

/**
 * The AI Answer Simulator (screen #13 §51, docs/13 §95-99 "Ask as prospect"): what the AI would answer, which knowledge
 * it would use, what is missing or conflicting — without sending anything or counting as usage.
 */
export async function simulateAnswer(deps: BrainDeps, workspaceId: string, text: string) {
  const questions = splitQuestions(text);
  const set = await answerQuestions(deps, workspaceId, questions.length ? questions : [text.trim()]);
  const answeredCount = set.answers.filter((a) => a.decision === 'ANSWER').length;
  const outcome = answeredCount === set.answers.length ? 'ANSWER' : answeredCount === 0 ? 'ESCALATE' : 'PARTIAL';
  return {
    outcome,
    answers: set.answers,
    proposed: set.answers.filter((a) => a.decision === 'ANSWER').map((a) => a.answer).join(' ') || null,
    escalate: set.answers.filter((a) => a.decision === 'ESCALATE').map((a) => ({ question: a.question, reason: a.reason })),
    gaps: set.answers.filter((a) => a.gap).map((a) => a.question),
    conflicts: [...new Set(set.answers.flatMap((a) => a.conflicts))],
    semantic: set.semantic,
    controls: set.controls,
    approvedItems: set.items.length,
  };
}

/** "Message 123 used Pricing v7" — one row per revision per answer (idempotent per reply). */
export async function recordUsageTx(tx: Tx, workspaceId: string, input: { usedByType: 'REPLY' | 'BRIEF'; usedById: string; conversationId: string | null; uses: { itemId: string; revisionId: string; version: number; question?: string }[] }) {
  if (!input.uses.length) return 0;
  const { count } = await tx.knowledgeUsage.createMany({
    data: input.uses.map((u) => ({ workspaceId, itemId: u.itemId, revisionId: u.revisionId, version: u.version, usedByType: input.usedByType, usedById: input.usedById, conversationId: input.conversationId, question: u.question?.slice(0, 300) ?? null })),
    skipDuplicates: true,
  });
  if (count) {
    for (const itemId of new Set(input.uses.map((u) => u.itemId))) await tx.knowledgeItem.update({ where: { id: itemId }, data: { usageCount: { increment: 1 } } });
  }
  return count;
}

// ───────────────────────────── embeddings ─────────────────────────────

/**
 * Vectors for a published revision's chunks (docs/13 §114-120): a chunk whose exact text was already embedded with the
 * same model (an unchanged FAQ in a new version) reuses that vector; only changed text is sent to the provider.
 */
export async function embedRevision(deps: BrainDeps, job: { workspaceId: string; revisionId: string }): Promise<{ embedded: number; reused: number; skipped?: string }> {
  const pending = await deps.db.knowledgeChunk.findMany({ where: { workspaceId: job.workspaceId, revisionId: job.revisionId, embeddedAt: null }, orderBy: { chunkIndex: 'asc' } });
  if (!pending.length) return { embedded: 0, reused: 0 };
  let reused = 0;
  const left: typeof pending = [];
  for (const c of pending) {
    const n = await deps.db.$executeRaw(Prisma.sql`
      UPDATE "KnowledgeChunk" AS t SET "embedding" = s."embedding", "embeddingModel" = s."embeddingModel", "embeddedAt" = now()
      FROM (SELECT "embedding", "embeddingModel" FROM "KnowledgeChunk" WHERE "workspaceId" = ${job.workspaceId}::uuid AND "contentHash" = ${c.contentHash} AND "embedding" IS NOT NULL AND "id" <> ${c.id}::uuid ORDER BY "embeddedAt" DESC LIMIT 1) AS s
      WHERE t."id" = ${c.id}::uuid`);
    if (n) reused++;
    else left.push(c);
  }
  if (!left.length) return { embedded: 0, reused };
  let result;
  try {
    result = await deps.providers.call({ workspaceId: job.workspaceId, capability: 'EMBEDDINGS', operation: 'knowledge.embed_chunks', timeoutMs: 60_000 }, (adapter, options) => adapter.embed({ texts: left.map((c) => c.content), purpose: 'DOCUMENT' }, options));
  } catch (err) {
    // No embeddings connected: keyword + structured retrieval still works; the sweep embeds later once one is connected.
    if ((err as { providerErrorKind?: string }).providerErrorKind === 'AUTH_REQUIRED') return { embedded: 0, reused, skipped: 'NO_EMBEDDINGS' };
    throw err;
  }
  const { vectors, model } = result.value;
  for (const [i, c] of left.entries()) {
    await deps.db.$executeRaw(Prisma.sql`UPDATE "KnowledgeChunk" SET "embedding" = ${vectorLiteral(vectors[i]!)}::vector, "embeddingModel" = ${model}, "embeddedAt" = now() WHERE "id" = ${c.id}::uuid`);
  }
  return { embedded: left.length, reused };
}

// ───────────────────────────── sweep ─────────────────────────────

/** Scheduled versions go live; overdue reviews turn STALE; chunks still missing a vector are embedded. */
export async function knowledgeSweep(deps: BrainDeps, opts: { limit?: number } = {}) {
  const now = nowOf(deps);
  const limit = opts.limit ?? 100;
  let published = 0;
  const due = await deps.db.knowledgeRevision.findMany({ where: { status: 'APPROVED', publishedAt: null, effectiveFrom: { lte: now } }, orderBy: { effectiveFrom: 'asc' }, take: limit });
  const workspaces = new Set<string>();
  for (const r of due) {
    await deps.db.$transaction(async (tx) => {
      const item = await tx.knowledgeItem.findUniqueOrThrow({ where: { id: r.itemId } });
      const fresh = await tx.knowledgeRevision.findUniqueOrThrow({ where: { id: r.id } });
      if (fresh.status !== 'APPROVED' || fresh.publishedAt || item.archivedAt) return;
      await publishTx(tx, systemCtx(r.workspaceId), item, fresh, now);
      published++;
      workspaces.add(r.workspaceId);
    }, TX);
  }
  const overdue = await deps.db.knowledgeItem.findMany({ where: { status: 'APPROVED', nextReviewAt: { lt: now }, archivedAt: null }, take: limit, select: { id: true, workspaceId: true } });
  for (const i of overdue) {
    await deps.db.$transaction(async (tx) => {
      const { count } = await tx.knowledgeItem.updateMany({ where: { id: i.id, status: 'APPROVED' }, data: { status: 'STALE' } });
      if (count) await recordEvent(tx, systemCtx(i.workspaceId), 'KnowledgeStale', i.id, { itemId: i.id, reason: 'Past its review date' });
    }, TX);
  }
  // Chunks of live revisions still without a vector (e.g. embeddings were connected later).
  const missing = await deps.db.$queryRaw<{ workspaceId: string; revisionId: string }[]>(Prisma.sql`
    SELECT DISTINCT c."workspaceId", c."revisionId" FROM "KnowledgeChunk" c JOIN "KnowledgeItem" i ON i."currentRevisionId" = c."revisionId"
    WHERE c."embeddedAt" IS NULL LIMIT 20`);
  let embedded = 0;
  for (const m of missing) {
    const r = await embedRevision(deps, { workspaceId: m.workspaceId, revisionId: m.revisionId }).catch(() => ({ embedded: 0, reused: 0, skipped: 'ERROR' }));
    embedded += r.embedded + r.reused;
  }
  for (const w of workspaces) await resolveAnsweredGaps(deps, w).catch(() => 0);
  return { published, stale: overdue.length, embedded };
}
