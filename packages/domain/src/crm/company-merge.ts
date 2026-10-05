import { isDeepStrictEqual } from 'node:util';
import type { Company, Fact, MergeMode, Prisma } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@revenue-os/shared';
import { actorUserId, writeAudit, type ServiceContext, type Tx } from '../context.js';

export interface MergeInput {
  sourceId: string;
  targetId: string;
  mode: MergeMode;
  candidateId?: string | null;
  reason?: string;
}

/** Profile fields a merge may fill on the target when the target has no value. Never overwritten. */
const FILLABLE = [
  'legalName',
  'websiteDomain',
  'phone',
  'companyType',
  'addressLine',
  'city',
  'region',
  'country',
  'postalCode',
  'latitude',
  'longitude',
  'industry',
  'employeeRange',
  'revenueRange',
  'foundedYear',
] as const satisfies readonly (keyof Company)[];

/**
 * Merges `sourceId` into `targetId` inside the caller's transaction (docs/17 §40-45, docs/07 §82 "company merge" lock).
 *
 * Nothing is destroyed: people, contact points, evidence, facts and provider mappings move to the target; the target's
 * empty profile fields are filled (never overwritten); facts that now disagree become CONFLICTED instead of one value
 * silently winning; the source row stays, ARCHIVED with `mergedIntoId`, and an append-only EntityMerge keeps its
 * snapshot and every id that moved.
 */
export async function mergeCompaniesTx(tx: Tx, ctx: ServiceContext, input: MergeInput) {
  const { sourceId, targetId } = input;
  if (sourceId === targetId) throw new ValidationError('A company cannot be merged into itself', [{ path: 'targetId', message: 'same as source' }]);

  // Lock both rows in a stable order so two merges touching the same companies can't deadlock or interleave.
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Company" WHERE "workspaceId" = ${ctx.workspaceId}::uuid AND id IN (${sourceId}::uuid, ${targetId}::uuid)
    ORDER BY id FOR UPDATE`;
  if (locked.length !== 2) throw new NotFoundError('company not found');

  const [source, target] = await Promise.all([
    tx.company.findUniqueOrThrow({ where: { id: sourceId }, include: { aliases: true } }),
    tx.company.findUniqueOrThrow({ where: { id: targetId } }),
  ]);
  for (const c of [source, target]) {
    if (c.mergedIntoId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `${c.displayName} was already merged into another company`);
  }
  if (target.status === 'ARCHIVED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', `${target.displayName} is archived — restore it before merging into it`);

  const ws = ctx.workspaceId;
  const now = new Date();

  // People: employment history moves as-is.
  const employments = await tx.employment.findMany({ where: { workspaceId: ws, companyId: sourceId }, select: { id: true } });
  await tx.employment.updateMany({ where: { workspaceId: ws, companyId: sourceId }, data: { companyId: targetId, version: { increment: 1 } } });

  // Contact points: an identical value already on the target is kept there; the source copy is archived, not lost.
  const [sourcePoints, targetPoints] = await Promise.all([
    tx.contactPoint.findMany({ where: { workspaceId: ws, entityType: 'COMPANY', entityId: sourceId } }),
    tx.contactPoint.findMany({ where: { workspaceId: ws, entityType: 'COMPANY', entityId: targetId } }),
  ]);
  const targetKeys = new Set(targetPoints.map((p) => `${p.type}:${p.normalizedValue}`));
  const targetPrimary = new Set(targetPoints.filter((p) => p.isPrimary && !p.archivedAt).map((p) => p.type));
  const movedPoints: string[] = [];
  const duplicatePoints: string[] = [];
  for (const p of sourcePoints) {
    if (targetKeys.has(`${p.type}:${p.normalizedValue}`)) {
      duplicatePoints.push(p.id);
      await tx.contactPoint.update({ where: { id: p.id }, data: { archivedAt: p.archivedAt ?? now, isPrimary: false, version: { increment: 1 } } });
    } else {
      movedPoints.push(p.id);
      await tx.contactPoint.update({
        where: { id: p.id },
        data: { entityId: targetId, isPrimary: p.isPrimary && !targetPrimary.has(p.type), version: { increment: 1 } },
      });
      if (p.isPrimary && !p.archivedAt) targetPrimary.add(p.type);
    }
  }

  // Evidence keeps its original source, provider and observed_at — only the subject changes.
  const evidence = await tx.evidence.findMany({ where: { workspaceId: ws, entityType: 'COMPANY', entityId: sourceId }, select: { id: true } });
  await tx.evidence.updateMany({ where: { workspaceId: ws, entityType: 'COMPANY', entityId: sourceId }, data: { entityId: targetId } });

  const mappings = await tx.externalEntityMapping.findMany({ where: { workspaceId: ws, entityType: 'COMPANY', entityId: sourceId }, select: { id: true } });
  await tx.externalEntityMapping.updateMany({ where: { workspaceId: ws, entityType: 'COMPANY', entityId: sourceId }, data: { entityId: targetId } });

  const facts = await reconcileFacts(tx, ws, sourceId, targetId);

  // Names, domains and phones the source was known by keep resolving to the surviving record.
  await tx.companyAlias.createMany({
    data: source.aliases.map((a) => ({ workspaceId: ws, companyId: targetId, aliasType: a.aliasType, value: a.value, normalizedValue: a.normalizedValue, source: `merge:${sourceId}` })),
    skipDuplicates: true,
  });

  // Earlier merges into the source now point at the survivor, so the chain stays one hop.
  await tx.company.updateMany({ where: { workspaceId: ws, mergedIntoId: sourceId }, data: { mergedIntoId: targetId } });

  const filled: Partial<Record<(typeof FILLABLE)[number], unknown>> = {};
  for (const field of FILLABLE) {
    if ((target[field] === null || target[field] === undefined) && source[field] !== null && source[field] !== undefined) filled[field] = source[field];
  }
  const filledFields = Object.keys(filled);

  const targetAfter = await tx.company.update({
    where: { id: targetId },
    data: { ...(filled as Prisma.CompanyUpdateInput), updatedBy: actorUserId(ctx), version: { increment: 1 } },
  });
  await tx.company.update({
    where: { id: sourceId },
    data: { status: 'ARCHIVED', archivedAt: source.archivedAt ?? now, mergedIntoId: targetId, mergedAt: now, updatedBy: actorUserId(ctx), version: { increment: 1 } },
  });

  const { aliases, ...sourceRow } = source;
  const merge = await tx.entityMerge.create({
    data: {
      workspaceId: ws,
      entityType: 'COMPANY',
      sourceId,
      targetId,
      candidateId: input.candidateId ?? null,
      mode: input.mode,
      reason: input.reason?.trim() || null,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      sourceSnapshot: JSON.parse(JSON.stringify({ company: sourceRow, aliases })) as Prisma.InputJsonValue,
      moved: {
        employments: employments.map((e) => e.id),
        contactPoints: movedPoints,
        contactPointsArchivedAsDuplicate: duplicatePoints,
        evidence: evidence.map((e) => e.id),
        facts: facts.moved,
        factsSupersededAsDuplicate: facts.superseded,
        factsNowConflicted: facts.conflicted,
        externalMappings: mappings.map((m) => m.id),
      },
      filledFields,
      mergedAt: now,
    },
  });

  // The pair's candidate is MERGED; every other open candidate about the source is closed (the survivor is re-checked).
  if (input.candidateId) {
    const { count } = await tx.entityMatchCandidate.updateMany({
      where: { id: input.candidateId, workspaceId: ws, status: { in: ['PENDING', 'NEEDS_REVIEW'] } },
      data: { status: 'MERGED', mergeId: merge.id, resolvedAt: now, resolvedByType: ctx.actor.type, resolvedById: ctx.actor.id, resolution: input.reason?.trim() || null, version: { increment: 1 } },
    });
    if (count === 0) throw new ConflictError('VERSION_CONFLICT', 'This duplicate was just resolved by someone else — reload');
  }
  await tx.entityMatchCandidate.updateMany({
    where: { workspaceId: ws, entityType: 'COMPANY', status: { in: ['PENDING', 'NEEDS_REVIEW'] }, OR: [{ leftId: sourceId }, { rightId: sourceId }] },
    data: { status: 'AUTO_RESOLVED', resolution: `Merged into ${target.displayName}`, resolvedAt: now, resolvedByType: 'SYSTEM', version: { increment: 1 } },
  });

  await writeAudit(tx, ctx, {
    action: input.mode === 'AUTO' ? 'company.auto_merged' : 'company.merged',
    entityType: 'COMPANY',
    entityId: targetId,
    before: target,
    after: { ...targetAfter, mergeId: merge.id, mergedFrom: sourceId, filledFields },
    reason: input.reason,
  });
  await writeAudit(tx, ctx, { action: 'company.merged_away', entityType: 'COMPANY', entityId: sourceId, before: sourceRow, after: { mergedIntoId: targetId, mergeId: merge.id }, reason: input.reason });
  await recordEvent(tx, ctx, 'CompaniesMerged', targetId, { mergeId: merge.id, sourceCompanyId: sourceId, targetCompanyId: targetId, mode: input.mode, candidateId: input.candidateId ?? null });

  return { merge, target: targetAfter };
}

/**
 * Moves the source's facts to the target. Same field + same value → one fact (the duplicate is SUPERSEDED and its
 * evidence linked to the kept one). Same field + different values → all of them CONFLICTED for a human to resolve.
 */
async function reconcileFacts(tx: Tx, ws: string, sourceId: string, targetId: string) {
  const moving = await tx.fact.findMany({ where: { workspaceId: ws, entityType: 'COMPANY', entityId: sourceId }, select: { id: true } });
  await tx.fact.updateMany({ where: { workspaceId: ws, entityType: 'COMPANY', entityId: sourceId }, data: { entityId: targetId, version: { increment: 1 } } });

  // The survivor's own facts come first, so when both sides know the same value the target's fact id is kept.
  const fromSource = new Set(moving.map((f) => f.id));
  const live = (
    await tx.fact.findMany({
      where: { workspaceId: ws, entityType: 'COMPANY', entityId: targetId, status: { in: ['ACTIVE', 'CONFLICTED'] } },
      orderBy: { firstObservedAt: 'asc' },
    })
  ).sort((a, b) => Number(fromSource.has(a.id)) - Number(fromSource.has(b.id)));
  const byField = new Map<string, Fact[]>();
  for (const f of live) byField.set(f.field, [...(byField.get(f.field) ?? []), f]);

  const superseded: string[] = [];
  const conflicted: string[] = [];
  for (const group of byField.values()) {
    const kept: Fact[] = [];
    for (const fact of group) {
      const same = kept.find((k) => isDeepStrictEqual(k.valueJson, fact.valueJson));
      if (!same) {
        kept.push(fact);
        continue;
      }
      const evidence = await tx.factEvidence.findMany({ where: { factId: fact.id }, select: { evidenceId: true } });
      await tx.factEvidence.createMany({ data: evidence.map((e) => ({ workspaceId: ws, factId: same.id, evidenceId: e.evidenceId })), skipDuplicates: true });
      await tx.fact.update({
        where: { id: same.id },
        data: {
          firstObservedAt: fact.firstObservedAt < same.firstObservedAt ? fact.firstObservedAt : same.firstObservedAt,
          lastConfirmedAt: fact.lastConfirmedAt > same.lastConfirmedAt ? fact.lastConfirmedAt : same.lastConfirmedAt,
          version: { increment: 1 },
        },
      });
      await tx.fact.update({ where: { id: fact.id }, data: { status: 'SUPERSEDED', supersededById: same.id, version: { increment: 1 } } });
      superseded.push(fact.id);
    }
    if (kept.length > 1) {
      const ids = kept.filter((k) => k.status !== 'CONFLICTED').map((k) => k.id);
      if (ids.length) await tx.fact.updateMany({ where: { id: { in: ids } }, data: { status: 'CONFLICTED', version: { increment: 1 } } });
      conflicted.push(...ids);
    } else if (kept[0]?.status === 'CONFLICTED') {
      // Every rival value turned out identical — nothing left to disagree with.
      await tx.fact.update({ where: { id: kept[0]!.id }, data: { status: 'ACTIVE', version: { increment: 1 } } });
    }
  }
  return { moved: moving.map((f) => f.id), superseded, conflicted };
}
