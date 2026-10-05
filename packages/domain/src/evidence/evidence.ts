import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ConfidenceLevel, Prisma } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import { ValidationError } from '@revenue-os/shared';
import { actorUserId, assertEntityInWorkspace, writeAudit, type ServiceContext, type Tx } from '../context.js';

export interface EvidenceInput {
  entityType: 'COMPANY' | 'PERSON';
  entityId: string;
  evidenceType: string;
  sourceType: string;
  sourceName?: string;
  sourceUrl?: string;
  provider?: string;
  observedAt: Date;
  contentExcerpt?: string;
  confidence?: ConfidenceLevel;
}

export interface FactInput {
  entityType: 'COMPANY' | 'PERSON';
  entityId: string;
  factType: string;
  field: string;
  value: Prisma.InputJsonValue;
  evidenceIds: string[];
  confidence?: ConfidenceLevel;
  /** A deliberate correction: replace the active fact instead of flagging a conflict. */
  supersede?: boolean;
}

export type FactOutcome = 'CREATED' | 'CONFIRMED' | 'CONFLICTED' | 'SUPERSEDED';

/** Stores where a piece of information came from and when it was observed (docs/06 §31-40). */
export async function recordEvidenceTx(tx: Tx, ctx: ServiceContext, input: EvidenceInput) {
  if (input.observedAt.getTime() > Date.now() + 60_000) {
    throw new ValidationError('observedAt cannot be in the future', [{ path: 'observedAt', message: 'future' }]);
  }
  await assertEntityInWorkspace(tx, ctx.workspaceId, input.entityType, input.entityId);
  const evidence = await tx.evidence.create({
    data: {
      workspaceId: ctx.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      evidenceType: input.evidenceType,
      sourceType: input.sourceType,
      sourceName: input.sourceName ?? null,
      sourceUrl: input.sourceUrl ?? null,
      provider: input.provider ?? null,
      observedAt: input.observedAt,
      contentExcerpt: input.contentExcerpt ?? null,
      contentHash: input.contentExcerpt ? createHash('sha256').update(input.contentExcerpt).digest('hex') : null,
      confidence: input.confidence ?? 'MEDIUM',
      createdBy: actorUserId(ctx),
    },
  });
  await writeAudit(tx, ctx, { action: 'evidence.recorded', entityType: 'EVIDENCE', entityId: evidence.id, after: evidence });
  await recordEvent(tx, ctx, 'EvidenceRecorded', evidence.id, {
    evidenceId: evidence.id,
    entityType: evidence.entityType,
    entityId: evidence.entityId,
    sourceType: evidence.sourceType,
  });
  return evidence;
}

/**
 * Evidence → Fact (docs/06 §31-40). Every fact cites evidence about the same entity. A different value for the same
 * field never silently overwrites: both facts become CONFLICTED unless the caller explicitly supersedes.
 */
export async function recordFactTx(
  tx: Tx,
  ctx: ServiceContext,
  input: FactInput,
  /**
   * Evidence the caller just recorded for this same entity in this transaction (e.g. discovery resolution), so the
   * entity/evidence checks needn't be re-read for every fact. Must be exactly the rows behind `evidenceIds`.
   */
  opts: { verifiedEvidence?: { id: string; observedAt: Date; entityType: string; entityId: string }[] } = {},
) {
  const evidenceIds = [...new Set(input.evidenceIds)];
  if (evidenceIds.length === 0) {
    throw new ValidationError('A fact needs at least one piece of evidence', [{ path: 'evidenceIds', message: 'required' }]);
  }
  const verified = opts.verifiedEvidence?.filter((e) => evidenceIds.includes(e.id) && e.entityType === input.entityType && e.entityId === input.entityId);
  let evidence: { id: string; observedAt: Date }[];
  if (verified && verified.length === evidenceIds.length) {
    evidence = verified;
  } else {
    await assertEntityInWorkspace(tx, ctx.workspaceId, input.entityType, input.entityId);
    evidence = await tx.evidence.findMany({
      where: { id: { in: evidenceIds }, workspaceId: ctx.workspaceId, entityType: input.entityType, entityId: input.entityId },
      select: { id: true, observedAt: true },
    });
  }
  if (evidence.length !== evidenceIds.length) {
    throw new ValidationError('Evidence must exist and describe the same entity as the fact', [{ path: 'evidenceIds', message: 'mismatch' }]);
  }
  const observed = evidence.map((e) => e.observedAt.getTime());
  const firstObservedAt = new Date(Math.min(...observed));
  const lastConfirmedAt = new Date(Math.max(...observed));
  const link = (factId: string) =>
    tx.factEvidence.createMany({
      data: evidenceIds.map((evidenceId) => ({ workspaceId: ctx.workspaceId, factId, evidenceId })),
      skipDuplicates: true,
    });

  const current = await tx.fact.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      field: input.field,
      status: { in: ['ACTIVE', 'CONFLICTED'] },
    },
  });

  const same = current.find((f) => isDeepStrictEqual(f.valueJson, input.value));
  const conflicting = current.filter((f) => f.id !== same?.id);

  // Same value already known → confirm it with the new evidence (and, on a correction, retire the rivals).
  if (same) {
    await link(same.id);
    const resolves = input.supersede && conflicting.length > 0;
    const fact = await tx.fact.update({
      where: { id: same.id },
      data: {
        lastConfirmedAt: new Date(Math.max(same.lastConfirmedAt.getTime(), lastConfirmedAt.getTime())),
        ...(resolves ? { status: 'ACTIVE' as const } : {}),
        version: { increment: 1 },
      },
    });
    if (resolves) {
      await tx.fact.updateMany({
        where: { id: { in: conflicting.map((f) => f.id) } },
        data: { status: 'SUPERSEDED', supersededById: same.id, version: { increment: 1 } },
      });
    }
    const outcome: FactOutcome = resolves ? 'SUPERSEDED' : 'CONFIRMED';
    await writeAudit(tx, ctx, { action: `fact.${outcome.toLowerCase()}`, entityType: 'FACT', entityId: fact.id, after: { evidenceIds, status: fact.status } });
    await emitFactEvent(tx, ctx, fact.id, input, outcome, resolves ? conflicting.map((f) => f.id) : []);
    return { fact, outcome };
  }

  const outcome: FactOutcome = conflicting.length === 0 ? 'CREATED' : input.supersede ? 'SUPERSEDED' : 'CONFLICTED';
  const fact = await tx.fact.create({
    data: {
      workspaceId: ctx.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      factType: input.factType,
      field: input.field,
      valueJson: input.value,
      status: outcome === 'CONFLICTED' ? 'CONFLICTED' : 'ACTIVE',
      confidence: input.confidence ?? 'MEDIUM',
      firstObservedAt,
      lastConfirmedAt,
      createdBy: actorUserId(ctx),
    },
  });
  await link(fact.id);

  if (conflicting.length > 0) {
    await tx.fact.updateMany({
      where: { id: { in: conflicting.map((f) => f.id) } },
      data:
        outcome === 'SUPERSEDED'
          ? { status: 'SUPERSEDED', supersededById: fact.id, version: { increment: 1 } }
          : { status: 'CONFLICTED', version: { increment: 1 } },
    });
  }
  await writeAudit(tx, ctx, {
    action: `fact.${outcome.toLowerCase()}`,
    entityType: 'FACT',
    entityId: fact.id,
    before: conflicting.length ? conflicting.map((f) => ({ id: f.id, value: f.valueJson, status: f.status })) : undefined,
    after: fact,
  });
  await emitFactEvent(tx, ctx, fact.id, input, outcome, conflicting.map((f) => f.id));
  return { fact, outcome };
}

function emitFactEvent(tx: Tx, ctx: ServiceContext, factId: string, input: FactInput, outcome: FactOutcome, otherFactIds: string[]) {
  const subject = { factId, entityType: input.entityType, entityId: input.entityId, field: input.field };
  if (outcome === 'CONFLICTED') return recordEvent(tx, ctx, 'FactConflicted', factId, { ...subject, conflictingFactIds: otherFactIds });
  if (outcome === 'SUPERSEDED') return recordEvent(tx, ctx, 'FactSuperseded', factId, { ...subject, supersededFactIds: otherFactIds });
  return recordEvent(tx, ctx, 'FactRecorded', factId, { ...subject, outcome });
}
