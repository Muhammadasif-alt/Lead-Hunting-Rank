import { Injectable } from '@nestjs/common';
import type { ConfidenceLevel, Prisma } from '@revenue-os/database';
import { recordEvidenceTx, recordFactTx, type EvidenceInput, type FactInput } from '@revenue-os/domain';
import { BusinessRuleError, NotFoundError } from '@revenue-os/shared';
import { recordEvent } from '@revenue-os/events';
import { PrismaService } from '../../infra/prisma.service.js';
import { writeAudit, type ServiceContext } from '../../domain/service-context.js';

export type { EvidenceInput, FactInput, FactOutcome } from '@revenue-os/domain';

/** A human (or later an agent tool) records "I saw X at this source on this date" — evidence and fact together. */
export interface ObservationInput {
  entityType: 'COMPANY' | 'PERSON';
  entityId: string;
  field: string;
  factType?: string;
  value: Prisma.InputJsonValue;
  source: { sourceType: string; sourceName?: string; sourceUrl?: string; observedAt: Date; excerpt?: string };
  confidence?: ConfidenceLevel;
  supersede?: boolean;
}

/**
 * Evidence → Fact (docs/06 §31-40). Every fact cites evidence about the same entity. A different value for the same
 * field never silently overwrites: both facts become CONFLICTED unless the caller explicitly supersedes.
 */
@Injectable()
export class EvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async recordEvidence(ctx: ServiceContext, input: EvidenceInput) {
    return this.prisma.client.$transaction((tx) => recordEvidenceTx(tx, ctx, input));
  }

  async recordFact(ctx: ServiceContext, input: FactInput) {
    return this.prisma.client.$transaction((tx) => recordFactTx(tx, ctx, input));
  }

  /** Evidence + fact in one transaction: a fact never exists without its source, and a source isn't left orphaned. */
  async recordObservation(ctx: ServiceContext, input: ObservationInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const evidence = await recordEvidenceTx(tx, ctx, {
        entityType: input.entityType,
        entityId: input.entityId,
        evidenceType: 'OBSERVATION',
        sourceType: input.source.sourceType,
        sourceName: input.source.sourceName,
        sourceUrl: input.source.sourceUrl,
        observedAt: input.source.observedAt,
        contentExcerpt: input.source.excerpt,
        confidence: input.confidence,
      });
      const result = await recordFactTx(tx, ctx, {
        entityType: input.entityType,
        entityId: input.entityId,
        factType: input.factType ?? 'PROFILE',
        field: input.field,
        value: input.value,
        evidenceIds: [evidence.id],
        confidence: input.confidence,
        supersede: input.supersede,
      });
      return { evidence, ...result };
    });
  }

  /**
   * A human picks the right value among CONFLICTED facts: it becomes ACTIVE, its rivals SUPERSEDED (history kept, the
   * evidence behind every value stays visible).
   */
  async resolveConflict(ctx: ServiceContext, factId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const chosen = await tx.fact.findFirst({ where: { id: factId, workspaceId: ctx.workspaceId } });
      if (!chosen) throw new NotFoundError(`fact ${factId} not found`);
      if (chosen.status !== 'CONFLICTED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only a conflicted fact can be chosen as the correct value');
      const rivals = await tx.fact.findMany({
        where: { workspaceId: ctx.workspaceId, entityType: chosen.entityType, entityId: chosen.entityId, field: chosen.field, status: 'CONFLICTED', id: { not: chosen.id } },
      });
      const fact = await tx.fact.update({ where: { id: chosen.id }, data: { status: 'ACTIVE', version: { increment: 1 } } });
      await tx.fact.updateMany({ where: { id: { in: rivals.map((r) => r.id) } }, data: { status: 'SUPERSEDED', supersededById: chosen.id, version: { increment: 1 } } });
      await writeAudit(tx, ctx, {
        action: 'fact.conflict_resolved',
        entityType: 'FACT',
        entityId: fact.id,
        before: rivals.map((r) => ({ id: r.id, value: r.valueJson })),
        after: { id: fact.id, value: fact.valueJson, status: fact.status },
      });
      await recordEvent(tx, ctx, 'FactSuperseded', fact.id, {
        factId: fact.id,
        entityType: fact.entityType,
        entityId: fact.entityId,
        field: fact.field,
        supersededFactIds: rivals.map((r) => r.id),
      });
      return fact;
    });
  }
}
