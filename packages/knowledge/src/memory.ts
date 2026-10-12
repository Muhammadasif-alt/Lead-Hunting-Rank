import type { CommitmentDirection, ConfidenceLevel, Memory, MemoryCandidate, MemoryOrigin, MemoryScope, PrismaClient } from '@revenue-os/database';
import { actorUserId, writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import {
  BusinessRuleError,
  businessDaysAhead,
  candidateDecision,
  memoryKeyInfo,
  memoryTiming,
  MEMORY_KEYS,
  NotFoundError,
  promisesIn,
  sameMemoryValue,
  ValidationError,
  type MemoryProposal,
} from '@revenue-os/shared';
import { nowOf, systemCtx, TX, type BrainDeps } from './deps.js';

/** The records one source can attach memory to — anything else is out of scope (contamination protection). */
export interface MemoryScopeIds {
  companyId: string;
  personId: string | null;
  conversationId: string | null;
  opportunityId: string | null;
}

function entityFor(scope: MemoryProposal['scope'], ids: MemoryScopeIds): { entityType: MemoryScope; entityId: string } {
  if (scope === 'PERSON' && ids.personId) return { entityType: 'PERSON', entityId: ids.personId };
  if (scope === 'OPPORTUNITY' && ids.opportunityId) return { entityType: 'OPPORTUNITY', entityId: ids.opportunityId };
  if ((scope === 'CONVERSATION' || scope === 'PERSON' || scope === 'OPPORTUNITY') && ids.conversationId) return { entityType: 'CONVERSATION', entityId: ids.conversationId };
  if (scope === 'OPPORTUNITY' || scope === 'CONVERSATION') return ids.opportunityId ? { entityType: 'OPPORTUNITY', entityId: ids.opportunityId } : { entityType: 'COMPANY', entityId: ids.companyId };
  return { entityType: 'COMPANY', entityId: ids.companyId };
}

interface MemoryWrite {
  companyId: string;
  entityType: MemoryScope;
  entityId: string;
  memoryType: MemoryCandidate['memoryType'];
  key: string;
  value: string;
  summary: string;
  origin: MemoryOrigin;
  confidence: ConfidenceLevel;
  sourceType: string;
  sourceId: string | null;
  quote: string | null;
  observedAt: Date;
}

/**
 * Applies one accepted memory (docs/13 §18-22): the same value confirms what we knew; a different value for a
 * single-valued key either supersedes it (newer direct statement wins — the old one stays as history) or, for budget
 * and authority, puts both into a visible conflict for a person. Never a silent overwrite.
 */
async function applyMemoryTx(tx: Tx, ctx: ServiceContext, m: MemoryWrite, now: Date): Promise<{ memory: Memory; outcome: 'CREATED' | 'CONFIRMED' | 'SUPERSEDED' | 'CONFLICT' }> {
  const info = memoryKeyInfo(m.key);
  const timing = memoryTiming(m.key, m.observedAt, m.value);
  const current = await tx.memory.findMany({ where: { workspaceId: ctx.workspaceId, entityType: m.entityType, entityId: m.entityId, key: m.key, status: { in: ['ACTIVE', 'STALE', 'CONFLICTED'] } }, orderBy: { observedAt: 'desc' } });
  const same = current.find((x) => sameMemoryValue(x.value, m.value));
  const evidence = (memoryId: string) => tx.memoryEvidence.create({ data: { workspaceId: ctx.workspaceId, memoryId, sourceType: m.sourceType, sourceId: m.sourceId, quote: m.quote?.slice(0, 400) ?? null, observedAt: m.observedAt } });
  if (same) {
    const memory = await tx.memory.update({ where: { id: same.id }, data: { lastConfirmedAt: now, status: same.status === 'STALE' ? 'ACTIVE' : same.status, recheckAfter: timing.recheckAfter, version: { increment: 1 } } });
    await evidence(same.id);
    await recordEvent(tx, ctx, 'MemoryVerified', same.id, { memoryId: same.id, key: m.key });
    return { memory, outcome: 'CONFIRMED' };
  }
  const human = m.origin === 'HUMAN_CORRECTION';
  const rivals = info.single ? current : [];
  const conflict = rivals.length > 0 && info.onConflict === 'REVIEW' && !human;
  const memory = await tx.memory.create({
    data: {
      workspaceId: ctx.workspaceId,
      companyId: m.companyId,
      entityType: m.entityType,
      entityId: m.entityId,
      memoryType: m.memoryType,
      key: m.key,
      value: m.value.slice(0, 500),
      summary: m.summary.slice(0, 300),
      origin: m.origin,
      confidence: m.confidence,
      status: conflict ? 'CONFLICTED' : 'ACTIVE',
      sensitivity: info.outreach ? 'NORMAL' : 'RESTRICTED',
      useInOutreach: info.outreach && m.origin !== 'AI_INFERENCE' && m.origin !== 'HUMAN_NOTE',
      observedAt: m.observedAt,
      validFrom: m.observedAt < now ? m.observedAt : now,
      validUntil: timing.validUntil && timing.validUntil > m.observedAt ? timing.validUntil : null,
      lastConfirmedAt: now,
      recheckAfter: timing.recheckAfter,
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      createdByType: ctx.actor.type,
      createdById: ctx.actor.id,
    },
  });
  await evidence(memory.id);
  for (const old of rivals) {
    if (conflict) {
      await tx.memory.update({ where: { id: old.id }, data: { status: 'CONFLICTED', version: { increment: 1 } } });
      const c = await tx.memoryConflict.create({ data: { workspaceId: ctx.workspaceId, companyId: m.companyId, memoryAId: old.id, memoryBId: memory.id, key: m.key, conflictType: 'VALUE', detectedAt: now } });
      await recordEvent(tx, ctx, 'MemoryConflictDetected', memory.id, { conflictId: c.id, memoryAId: old.id, memoryBId: memory.id, key: m.key });
    } else {
      // The newer, direct statement wins; the old value stays as history (THEN vs NOW, screen #12 §68).
      await tx.memory.update({ where: { id: old.id }, data: { status: 'SUPERSEDED', supersededById: memory.id, statusReason: human ? 'Corrected by a person' : 'Replaced by a newer statement', ...(now > old.validFrom ? { validUntil: now } : {}), version: { increment: 1 } } });
      await tx.memoryConflict.create({ data: { workspaceId: ctx.workspaceId, companyId: m.companyId, memoryAId: old.id, memoryBId: memory.id, key: m.key, conflictType: 'TEMPORAL', status: 'RESOLVED', resolution: 'NEWER_WINS', resolvedAt: now, detectedAt: now } });
      await tx.memoryConflict.updateMany({ where: { status: 'OPEN', OR: [{ memoryAId: old.id }, { memoryBId: old.id }] }, data: { status: 'RESOLVED', resolution: 'NEWER_WINS', resolvedAt: now } });
      await recordEvent(tx, ctx, 'MemorySuperseded', old.id, { memoryId: old.id, supersededById: memory.id, key: m.key });
    }
  }
  return { memory, outcome: conflict ? 'CONFLICT' : rivals.length ? 'SUPERSEDED' : 'CREATED' };
}

/**
 * Proposes memories from one source (docs/13 §4-6: Raw Event → Extraction → Candidate → Entity → Evidence → Conflict →
 * Freshness → Memory). Clear low-risk statements are accepted on their own; budget, authority and unsure readings wait
 * for a person. Idempotent per source + record + key.
 */
export async function proposeMemoriesTx(
  tx: Tx,
  ctx: ServiceContext,
  input: { ids: MemoryScopeIds; proposals: MemoryProposal[]; origin: MemoryOrigin; confidence: ConfidenceLevel; sourceType: 'MESSAGE' | 'MEETING'; sourceId: string; meetingId?: string | null; observedAt: Date; now: Date },
): Promise<{ accepted: number; review: number }> {
  let accepted = 0;
  let review = 0;
  for (const p of input.proposals) {
    const { entityType, entityId } = entityFor(p.scope, input.ids);
    const decision = candidateDecision(p.key, input.confidence, input.origin);
    const { count } = await tx.memoryCandidate.createMany({
      data: [
        {
          workspaceId: ctx.workspaceId,
          companyId: input.ids.companyId,
          entityType,
          entityId,
          memoryType: p.memoryType,
          key: p.key,
          value: p.value,
          summary: p.summary,
          quote: p.quote,
          origin: input.origin,
          confidence: input.confidence,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          conversationId: input.ids.conversationId,
          meetingId: input.meetingId ?? null,
          status: decision.accept ? 'AUTO_ACCEPTED' : 'NEEDS_REVIEW',
          reason: decision.reason,
        },
      ],
      skipDuplicates: true,
    });
    if (!count) continue;
    const cand = await tx.memoryCandidate.findUniqueOrThrow({ where: { workspaceId_sourceId_entityId_key: { workspaceId: ctx.workspaceId, sourceId: input.sourceId, entityId, key: p.key } } });
    await recordEvent(tx, ctx, 'MemoryCandidateCreated', cand.id, { candidateId: cand.id, companyId: cand.companyId, key: cand.key, status: cand.status });
    if (decision.accept) {
      const { memory } = await applyMemoryTx(tx, ctx, { ...cand, sourceId: cand.sourceId, quote: cand.quote, observedAt: input.observedAt }, input.now);
      await tx.memoryCandidate.update({ where: { id: cand.id }, data: { memoryId: memory.id, decidedAt: input.now } });
      await recordEvent(tx, ctx, 'MemoryAccepted', memory.id, { memoryId: memory.id, companyId: memory.companyId, entityType: memory.entityType, key: memory.key, via: 'AUTO' });
      accepted++;
    } else review++;
  }
  return { accepted, review };
}

/** A person confirms (optionally editing the value) or rejects a proposed memory (screen #12 §36). */
export async function reviewMemoryCandidate(db: PrismaClient, ctx: ServiceContext, candidateId: string, input: { action: 'ACCEPT' | 'REJECT'; value?: string | null }) {
  const cand = await db.memoryCandidate.findFirst({ where: { id: candidateId, workspaceId: ctx.workspaceId } });
  if (!cand) throw new NotFoundError(`Memory candidate ${candidateId} not found`);
  if (cand.status !== 'NEEDS_REVIEW' && cand.status !== 'PENDING') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Already decided');
  const now = new Date();
  return db.$transaction(async (tx) => {
    if (input.action === 'REJECT') {
      const c = await tx.memoryCandidate.update({ where: { id: cand.id }, data: { status: 'REJECTED', decidedById: actorUserId(ctx), decidedAt: now } });
      await recordEvent(tx, ctx, 'MemoryCandidateRejected', cand.id, { candidateId: cand.id, key: cand.key });
      return { candidate: c, memory: null };
    }
    const value = input.value?.trim() || cand.value;
    const label = memoryKeyInfo(cand.key).label;
    const { memory } = await applyMemoryTx(tx, ctx, { ...cand, value, summary: value === cand.value ? cand.summary : `${label}: ${value}`, confidence: 'HIGH', observedAt: cand.createdAt }, now);
    const c = await tx.memoryCandidate.update({ where: { id: cand.id }, data: { status: 'ACCEPTED', memoryId: memory.id, decidedById: actorUserId(ctx), decidedAt: now } });
    await recordEvent(tx, ctx, 'MemoryAccepted', memory.id, { memoryId: memory.id, companyId: memory.companyId, entityType: memory.entityType, key: memory.key, via: 'PERSON' });
    await writeAudit(tx, ctx, { action: 'memory.confirmed', entityType: 'MEMORY', entityId: memory.id, after: { key: cand.key, edited: value !== cand.value } });
    return { candidate: c, memory };
  }, TX);
}

async function memoryOf(db: PrismaClient | Tx, workspaceId: string, id: string) {
  const m = await db.memory.findFirst({ where: { id, workspaceId } });
  if (!m) throw new NotFoundError(`Memory ${id} not found`);
  return m;
}

/** "[Correct]" (screen #12 §37): the corrected value becomes current, the AI's extraction stays as history with the source. */
export async function correctMemory(db: PrismaClient, ctx: ServiceContext, memoryId: string, input: { value: string; reason?: string | null }) {
  const old = await memoryOf(db, ctx.workspaceId, memoryId);
  if (!input.value.trim()) throw new ValidationError('The corrected value is empty');
  if (old.status === 'SUPERSEDED' || old.status === 'INVALIDATED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only a current memory can be corrected');
  const now = new Date();
  return db.$transaction(async (tx) => {
    const label = memoryKeyInfo(old.key).label;
    const memory = await tx.memory.create({
      data: {
        workspaceId: ctx.workspaceId,
        companyId: old.companyId,
        entityType: old.entityType,
        entityId: old.entityId,
        memoryType: old.memoryType,
        key: old.key,
        value: input.value.trim().slice(0, 500),
        summary: `${label}: ${input.value.trim()}`.slice(0, 300),
        origin: 'HUMAN_CORRECTION',
        confidence: 'HIGH',
        sensitivity: old.sensitivity,
        useInOutreach: old.useInOutreach,
        observedAt: now,
        validFrom: now,
        validUntil: old.validUntil && old.validUntil > now ? old.validUntil : null,
        lastConfirmedAt: now,
        recheckAfter: memoryTiming(old.key, now).recheckAfter,
        sourceType: 'HUMAN',
        sourceId: actorUserId(ctx),
        createdByType: ctx.actor.type,
        createdById: ctx.actor.id,
      },
    });
    await tx.memoryEvidence.create({ data: { workspaceId: ctx.workspaceId, memoryId: memory.id, sourceType: 'HUMAN', sourceId: actorUserId(ctx), quote: input.reason?.slice(0, 400) ?? null, observedAt: now } });
    await tx.memory.update({ where: { id: old.id }, data: { status: 'SUPERSEDED', supersededById: memory.id, statusReason: `Corrected by a person${input.reason ? `: ${input.reason.slice(0, 200)}` : ''}`, ...(now > old.validFrom ? { validUntil: now } : {}), version: { increment: 1 } } });
    await tx.memoryConflict.updateMany({ where: { status: 'OPEN', OR: [{ memoryAId: old.id }, { memoryBId: old.id }] }, data: { status: 'RESOLVED', resolution: 'CORRECTED', resolvedById: actorUserId(ctx), resolvedAt: now } });
    await recordEvent(tx, ctx, 'MemoryCorrected', memory.id, { memoryId: memory.id, replacedMemoryId: old.id, companyId: old.companyId, key: old.key });
    await writeAudit(tx, ctx, { action: 'memory.corrected', entityType: 'MEMORY', entityId: memory.id, before: { value: old.value, origin: old.origin }, after: { value: memory.value }, reason: input.reason ?? undefined });
    return memory;
  }, TX);
}

/** "[Mark Incorrect]" (screen #12 §39): the AI stops using it; history keeps it with the reason. */
export async function invalidateMemory(db: PrismaClient, ctx: ServiceContext, memoryId: string, reason: string) {
  const m = await memoryOf(db, ctx.workspaceId, memoryId);
  if (!reason.trim()) throw new ValidationError('Say why it is incorrect');
  if (m.status === 'INVALIDATED') return m;
  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.memory.update({ where: { id: m.id }, data: { status: 'INVALIDATED', statusReason: reason.trim().slice(0, 300), version: { increment: 1 } } });
    // Its conflict partners stand on their own again.
    const open = await tx.memoryConflict.findMany({ where: { status: 'OPEN', OR: [{ memoryAId: m.id }, { memoryBId: m.id }] } });
    for (const c of open) {
      const other = c.memoryAId === m.id ? c.memoryBId : c.memoryAId;
      await tx.memoryConflict.update({ where: { id: c.id }, data: { status: 'RESOLVED', resolution: other === c.memoryAId ? 'KEEP_A' : 'KEEP_B', resolvedById: actorUserId(ctx), resolvedAt: now } });
      await tx.memory.updateMany({ where: { id: other, status: 'CONFLICTED' }, data: { status: 'ACTIVE' } });
    }
    await recordEvent(tx, ctx, 'MemoryInvalidated', m.id, { memoryId: m.id, key: m.key });
    await writeAudit(tx, ctx, { action: 'memory.invalidated', entityType: 'MEMORY', entityId: m.id, before: { status: m.status }, after: { status: 'INVALIDATED' }, reason });
    return updated;
  }, TX);
}

/** Still true — confirmed again (fresh). */
export async function verifyMemory(db: PrismaClient, ctx: ServiceContext, memoryId: string) {
  const m = await memoryOf(db, ctx.workspaceId, memoryId);
  if (!['ACTIVE', 'STALE'].includes(m.status)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only an active or stale memory can be confirmed');
  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.memory.update({ where: { id: m.id }, data: { status: 'ACTIVE', lastConfirmedAt: now, recheckAfter: memoryTiming(m.key, now).recheckAfter, version: { increment: 1 } } });
    await tx.memoryEvidence.create({ data: { workspaceId: ctx.workspaceId, memoryId: m.id, sourceType: 'HUMAN', sourceId: actorUserId(ctx), quote: 'Confirmed by a person', observedAt: now } });
    await recordEvent(tx, ctx, 'MemoryVerified', m.id, { memoryId: m.id, key: m.key });
    return updated;
  }, TX);
}

/**
 * A colleague's note (screen #12 §7): shown as a human note, never as a verified prospect fact. With a key (e.g. ROLE)
 * it is structured memory from a person; without one it's a free note.
 */
export async function addMemoryNote(db: PrismaClient, ctx: ServiceContext, input: { companyId: string; entityType: MemoryScope; entityId: string; text: string; key?: string | null }) {
  if (!input.text.trim()) throw new ValidationError('The note is empty');
  const company = await db.company.findFirst({ where: { id: input.companyId, workspaceId: ctx.workspaceId }, select: { id: true } });
  if (!company) throw new NotFoundError('Company not found');
  // The record must belong to this company — notes never leak across companies.
  const belongs =
    input.entityType === 'COMPANY'
      ? input.entityId === input.companyId
      : input.entityType === 'OPPORTUNITY'
        ? !!(await db.opportunity.findFirst({ where: { id: input.entityId, workspaceId: ctx.workspaceId, companyId: input.companyId }, select: { id: true } }))
        : input.entityType === 'CONVERSATION'
          ? !!(await db.conversation.findFirst({ where: { id: input.entityId, workspaceId: ctx.workspaceId, companyId: input.companyId }, select: { id: true } }))
          : !!(await db.employment.findFirst({ where: { personId: input.entityId, workspaceId: ctx.workspaceId, companyId: input.companyId }, select: { id: true } }));
  if (!belongs) throw new ValidationError('That record does not belong to this company');
  const key = input.key && MEMORY_KEYS[input.key] ? input.key : 'NOTE';
  const info = memoryKeyInfo(key);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const { memory } = await applyMemoryTx(
      tx,
      ctx,
      { companyId: input.companyId, entityType: input.entityType, entityId: input.entityId, memoryType: info.memoryType, key, value: input.text.trim(), summary: key === 'NOTE' ? input.text.trim() : `${info.label}: ${input.text.trim()}`, origin: 'HUMAN_NOTE', confidence: 'MEDIUM', sourceType: 'HUMAN', sourceId: actorUserId(ctx), quote: null, observedAt: now },
      now,
    );
    await recordEvent(tx, ctx, 'MemoryAccepted', memory.id, { memoryId: memory.id, companyId: memory.companyId, entityType: memory.entityType, key, via: 'NOTE' });
    await writeAudit(tx, ctx, { action: 'memory.note_added', entityType: 'MEMORY', entityId: memory.id, after: { key, entityType: input.entityType } });
    return memory;
  }, TX);
}

/** A person decides between two disagreeing memories — or that both hold (different scopes or times). */
export async function resolveMemoryConflict(db: PrismaClient, ctx: ServiceContext, conflictId: string, input: { keep: 'A' | 'B' | 'BOTH'; note?: string | null }) {
  const c = await db.memoryConflict.findFirst({ where: { id: conflictId, workspaceId: ctx.workspaceId } });
  if (!c) throw new NotFoundError(`Conflict ${conflictId} not found`);
  if (c.status !== 'OPEN') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Conflict already resolved');
  const now = new Date();
  return db.$transaction(async (tx) => {
    if (input.keep === 'BOTH') await tx.memory.updateMany({ where: { id: { in: [c.memoryAId, c.memoryBId] }, status: 'CONFLICTED' }, data: { status: 'ACTIVE' } });
    else {
      const [keep, drop] = input.keep === 'A' ? [c.memoryAId, c.memoryBId] : [c.memoryBId, c.memoryAId];
      await tx.memory.updateMany({ where: { id: keep }, data: { status: 'ACTIVE', lastConfirmedAt: now } });
      await tx.memory.updateMany({ where: { id: drop }, data: { status: 'SUPERSEDED', supersededById: keep, statusReason: `A person kept the other value${input.note ? `: ${input.note.slice(0, 200)}` : ''}` } });
    }
    const updated = await tx.memoryConflict.update({ where: { id: c.id }, data: { status: 'RESOLVED', resolution: input.keep === 'BOTH' ? 'BOTH_VALID' : `KEEP_${input.keep}`, note: input.note?.slice(0, 300) ?? null, resolvedById: actorUserId(ctx), resolvedAt: now } });
    await recordEvent(tx, ctx, 'MemoryConflictResolved', c.memoryBId, { conflictId: c.id, resolution: updated.resolution! });
    await writeAudit(tx, ctx, { action: 'memory.conflict_resolved', entityType: 'MEMORY', entityId: c.memoryBId, after: { conflictId: c.id, resolution: updated.resolution }, reason: input.note ?? undefined });
    return updated;
  }, TX);
}

// ───────────────────────────── commitments (docs/13 §23-27) ─────────────────────────────

export interface CommitmentInput {
  companyId: string;
  conversationId?: string | null;
  opportunityId?: string | null;
  meetingId?: string | null;
  personId?: string | null;
  direction: CommitmentDirection;
  title: string;
  detail?: string | null;
  dueAt?: Date | null;
  ownerUserId?: string | null;
  origin: 'EXTRACTED' | 'AI_REPLY' | 'HUMAN';
  sourceType: string;
  sourceId?: string | null;
  quote?: string | null;
  dedupeKey?: string | null;
}

/** Records a promise once (the dedupe key makes a retried job a no-op). */
export async function createCommitmentTx(tx: Tx, ctx: ServiceContext, input: CommitmentInput): Promise<string | null> {
  const { count } = await tx.commitment.createMany({
    data: [
      {
        workspaceId: ctx.workspaceId,
        companyId: input.companyId,
        conversationId: input.conversationId ?? null,
        opportunityId: input.opportunityId ?? null,
        meetingId: input.meetingId ?? null,
        personId: input.personId ?? null,
        direction: input.direction,
        title: input.title.slice(0, 200),
        detail: input.detail?.slice(0, 1000) ?? null,
        dueAt: input.dueAt ?? null,
        ownerUserId: input.ownerUserId ?? null,
        origin: input.origin,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        quote: input.quote?.slice(0, 400) ?? null,
        dedupeKey: input.dedupeKey ?? null,
        createdByType: ctx.actor.type,
        createdById: ctx.actor.id,
      },
    ],
    skipDuplicates: true,
  });
  if (!count) return null;
  const c = input.dedupeKey
    ? await tx.commitment.findUniqueOrThrow({ where: { workspaceId_dedupeKey: { workspaceId: ctx.workspaceId, dedupeKey: input.dedupeKey } } })
    : await tx.commitment.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId, companyId: input.companyId, title: input.title.slice(0, 200) }, orderBy: { createdAt: 'desc' } });
  await recordEvent(tx, ctx, 'CommitmentCreated', c.id, { commitmentId: c.id, companyId: c.companyId, direction: c.direction, origin: c.origin, dueAt: c.dueAt?.toISOString() ?? null });
  return c.id;
}

/** Promises in a message — ours in what we sent, theirs in what they wrote — become commitments with the exact words. */
export async function commitmentsFromMessageTx(
  tx: Tx,
  ctx: ServiceContext,
  input: { text: string; side: 'OURS' | 'THEIRS'; ids: MemoryScopeIds; sourceType: string; sourceId: string; ownerUserId: string | null; now: Date },
): Promise<number> {
  let n = 0;
  for (const [i, p] of promisesIn(input.text, input.side, input.now).entries()) {
    const id = await createCommitmentTx(tx, ctx, {
      companyId: input.ids.companyId,
      conversationId: input.ids.conversationId,
      opportunityId: input.ids.opportunityId,
      personId: input.ids.personId,
      direction: input.side === 'OURS' ? 'WE_PROMISED' : 'PROSPECT_PROMISED',
      title: p.title,
      // Our promises always get a due date — the AI cannot forget them (docs/13 §23-27).
      dueAt: p.dueAt ?? (input.side === 'OURS' ? businessDaysAhead(input.now, 2) : null),
      ownerUserId: input.side === 'OURS' ? input.ownerUserId : null,
      origin: 'EXTRACTED',
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      quote: p.quote,
      dedupeKey: `${input.sourceType.toLowerCase()}:${input.sourceId}:${i}`,
    });
    if (id) n++;
  }
  return n;
}

async function commitmentOf(db: PrismaClient | Tx, workspaceId: string, id: string) {
  const c = await db.commitment.findFirst({ where: { id, workspaceId } });
  if (!c) throw new NotFoundError(`Commitment ${id} not found`);
  return c;
}

const OPEN_COMMITMENT = ['OPEN', 'WAITING', 'DUE'] as const;

export async function completeCommitment(db: PrismaClient, ctx: ServiceContext, id: string, evidence: string) {
  const c = await commitmentOf(db, ctx.workspaceId, id);
  if (!OPEN_COMMITMENT.includes(c.status as (typeof OPEN_COMMITMENT)[number])) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Not open');
  return db.$transaction(async (tx) => {
    const u = await tx.commitment.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), completionEvidence: (evidence.trim() || 'Marked done by a person').slice(0, 500), version: { increment: 1 } } });
    await recordEvent(tx, ctx, 'CommitmentCompleted', id, { commitmentId: id, companyId: c.companyId });
    await writeAudit(tx, ctx, { action: 'commitment.completed', entityType: 'COMMITMENT', entityId: id, after: { evidence: u.completionEvidence } });
    return u;
  }, TX);
}

export async function closeCommitment(db: PrismaClient, ctx: ServiceContext, id: string, input: { status: 'CANCELLED' | 'BROKEN' | 'WAITING' | 'OPEN'; reason?: string | null; dueAt?: Date | null }) {
  const c = await commitmentOf(db, ctx.workspaceId, id);
  if (!OPEN_COMMITMENT.includes(c.status as (typeof OPEN_COMMITMENT)[number])) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Not open');
  return db.$transaction(async (tx) => {
    const u = await tx.commitment.update({ where: { id }, data: { status: input.status, statusReason: input.reason?.slice(0, 300) ?? null, ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}), version: { increment: 1 } } });
    if (input.status === 'CANCELLED') await recordEvent(tx, ctx, 'CommitmentCancelled', id, { commitmentId: id, companyId: c.companyId });
    if (input.status === 'BROKEN') await recordEvent(tx, ctx, 'CommitmentBroken', id, { commitmentId: id, companyId: c.companyId });
    await writeAudit(tx, ctx, { action: `commitment.${input.status.toLowerCase()}`, entityType: 'COMMITMENT', entityId: id, after: { status: input.status, dueAt: u.dueAt?.toISOString() ?? null }, reason: input.reason ?? undefined });
    return u;
  }, TX);
}

export async function createCommitment(db: PrismaClient, ctx: ServiceContext, input: Omit<CommitmentInput, 'origin' | 'sourceType'>) {
  const company = await db.company.findFirst({ where: { id: input.companyId, workspaceId: ctx.workspaceId }, select: { id: true } });
  if (!company) throw new NotFoundError('Company not found');
  if (!input.title.trim()) throw new ValidationError('What was promised?');
  return db.$transaction(async (tx) => {
    const id = await createCommitmentTx(tx, ctx, { ...input, origin: 'HUMAN', sourceType: 'HUMAN', sourceId: actorUserId(ctx), ownerUserId: input.ownerUserId ?? (input.direction === 'WE_PROMISED' ? actorUserId(ctx) : null) });
    return tx.commitment.findUniqueOrThrow({ where: { id: id! } });
  }, TX);
}

/**
 * A promise kept by what we just sent (screen #12 §24): our open "come back with an answer" promises in this
 * conversation are completed by a reply that answers, with the reply as evidence.
 */
export async function completeAnswerPromisesTx(tx: Tx, ctx: ServiceContext, input: { conversationId: string; answeredQuestions: string[]; byPerson: boolean; evidence: string; now: Date }) {
  const open = await tx.commitment.findMany({ where: { workspaceId: ctx.workspaceId, conversationId: input.conversationId, direction: 'WE_PROMISED', origin: 'AI_REPLY', status: { in: [...OPEN_COMMITMENT] } } });
  let done = 0;
  for (const c of open) {
    const q = c.detail ?? '';
    const answered = input.byPerson || input.answeredQuestions.some((a) => sameMemoryValue(a, q));
    if (!answered) continue;
    await tx.commitment.update({ where: { id: c.id }, data: { status: 'COMPLETED', completedAt: input.now, completionEvidence: input.evidence.slice(0, 500), version: { increment: 1 } } });
    await recordEvent(tx, ctx, 'CommitmentCompleted', c.id, { commitmentId: c.id, companyId: c.companyId });
    done++;
  }
  return done;
}

// ───────────────────────────── relationships (docs/13 §28-29) ─────────────────────────────

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** "Talk to Sarah, she handles this" → a suggested referral edge with the words it came from (screen #12 §19). */
export async function relationshipFromReferralTx(tx: Tx, ctx: ServiceContext, input: { companyId: string; fromPersonId: string | null; referral: string; quote: string; context: string | null; sourceId: string }) {
  const email = EMAIL.exec(input.referral)?.[0]?.toLowerCase() ?? null;
  const name = /\b(?:talk to|speak (?:to|with)|contact|email|reach out to|ask)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/.exec(input.quote)?.[1] ?? null;
  const label = (email ?? name ?? input.referral).slice(0, 120);
  let toId: string | null = null;
  if (email) {
    const point = await tx.contactPoint.findFirst({ where: { workspaceId: ctx.workspaceId, type: 'EMAIL', normalizedValue: email, entityType: 'PERSON', archivedAt: null }, select: { entityId: true } });
    toId = point?.entityId ?? null;
  }
  const fromType = input.fromPersonId ? 'PERSON' : 'COMPANY';
  const fromId = input.fromPersonId ?? input.companyId;
  const { count } = await tx.relationship.createMany({
    data: [{ workspaceId: ctx.workspaceId, companyId: input.companyId, fromType, fromId, type: 'REFERRED_BY', toType: 'PERSON', toId, toLabel: label, context: input.context?.slice(0, 200) ?? null, status: 'SUGGESTED', confidence: email ? 'HIGH' : 'MEDIUM', sourceType: 'MESSAGE', sourceId: input.sourceId, quote: input.quote.slice(0, 400) }],
    skipDuplicates: true,
  });
  if (!count) return null;
  const r = await tx.relationship.findUniqueOrThrow({ where: { workspaceId_fromId_type_toLabel: { workspaceId: ctx.workspaceId, fromId, type: 'REFERRED_BY', toLabel: label } } });
  await recordEvent(tx, ctx, 'RelationshipCreated', r.id, { relationshipId: r.id, companyId: r.companyId, type: r.type, status: r.status });
  return r.id;
}

export async function setRelationshipStatus(db: PrismaClient, ctx: ServiceContext, id: string, status: 'ACTIVE' | 'ENDED' | 'INVALIDATED') {
  const r = await db.relationship.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!r) throw new NotFoundError(`Relationship ${id} not found`);
  return db.$transaction(async (tx) => {
    const u = await tx.relationship.update({ where: { id }, data: { status, confirmedById: status === 'ACTIVE' ? actorUserId(ctx) : r.confirmedById } });
    await recordEvent(tx, ctx, 'RelationshipUpdated', id, { relationshipId: id, status });
    await writeAudit(tx, ctx, { action: 'relationship.updated', entityType: 'RELATIONSHIP', entityId: id, before: { status: r.status }, after: { status } });
    return u;
  }, TX);
}

// ───────────────────────────── sweep ─────────────────────────────

/** Memory decay (docs/13 §77-82): re-check dates pass → STALE; validity ends → ARCHIVED. Promises fall due. */
export async function memorySweep(deps: BrainDeps, opts: { limit?: number } = {}) {
  const now = nowOf(deps);
  const limit = opts.limit ?? 500;
  const stale = await deps.db.memory.findMany({ where: { status: 'ACTIVE', recheckAfter: { lt: now } }, take: limit, select: { id: true, workspaceId: true, key: true } });
  const expired = await deps.db.memory.findMany({ where: { status: { in: ['ACTIVE', 'STALE'] }, validUntil: { lt: now } }, take: limit, select: { id: true, workspaceId: true, key: true } });
  const due = await deps.db.commitment.findMany({ where: { status: { in: ['OPEN', 'WAITING'] }, dueAt: { lte: now } }, take: limit, select: { id: true, workspaceId: true, companyId: true, direction: true } });
  await deps.db.$transaction(async (tx) => {
    for (const m of expired) {
      await tx.memory.update({ where: { id: m.id }, data: { status: 'ARCHIVED', statusReason: 'No longer valid (time-limited)' } });
      await recordEvent(tx, systemCtx(m.workspaceId), 'MemoryExpired', m.id, { memoryId: m.id, key: m.key, status: 'ARCHIVED' });
    }
    for (const m of stale.filter((s) => !expired.some((e) => e.id === s.id))) {
      await tx.memory.update({ where: { id: m.id }, data: { status: 'STALE' } });
      await recordEvent(tx, systemCtx(m.workspaceId), 'MemoryExpired', m.id, { memoryId: m.id, key: m.key, status: 'STALE' });
    }
    for (const c of due) {
      await tx.commitment.update({ where: { id: c.id }, data: { status: 'DUE' } });
      await recordEvent(tx, systemCtx(c.workspaceId), 'CommitmentDue', c.id, { commitmentId: c.id, companyId: c.companyId, direction: c.direction });
    }
  }, TX);
  return { stale: stale.length, archived: expired.length, due: due.length };
}
