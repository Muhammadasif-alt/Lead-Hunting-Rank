import { Injectable } from '@nestjs/common';
import { recordEvent } from '@revenue-os/events';
import {
  OPEN_CANDIDATE,
  detectCompanyDuplicates,
  findCompanyMatches,
  mergeCompaniesTx,
  writeAudit,
  type MatchResult,
  type ServiceContext,
  type Tx,
} from '@revenue-os/domain';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError, type CompanyMatchRecord } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';

export { OPEN_CANDIDATE, findCompanyMatches, lockMatchKeys, toMatchRecord, type MatchResult } from '@revenue-os/domain';

/**
 * Entity resolution for companies (docs/17 §40-45). Finds likely duplicates through normalized domain / phone / name
 * aliases and trigram name similarity, scores them deterministically (`scoreCompanyMatch`) and records an
 * EntityMatchCandidate. Medium and low confidence always wait for a human; only a HIGH, conflict-free match on a
 * record created by the system (never by a person) is merged automatically.
 */
@Injectable()
export class EntityResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Possible matches for a company that doesn't exist yet (create form preflight). No writes. */
  async preview(workspaceId: string, record: CompanyMatchRecord): Promise<MatchResult[]> {
    return findCompanyMatches(this.prisma.client, workspaceId, record);
  }

  /**
   * Re-evaluates duplicates for one company inside the caller's transaction: creates/updates candidates, closes the
   * ones that no longer match, and (for system-created records only) auto-merges a safe HIGH match.
   */
  async detectForCompany(tx: Tx, ctx: ServiceContext, companyId: string, opts: { autoMerge?: boolean } = {}) {
    return detectCompanyDuplicates(tx, ctx, companyId, opts);
  }

  /** Human merge from the review queue: `targetId` (one side of the pair) survives. */
  async mergeCandidate(ctx: ServiceContext, candidateId: string, input: { targetId: string; version: number; reason?: string }) {
    return this.prisma.client.$transaction(async (tx) => {
      const candidate = await this.openCandidate(tx, ctx, candidateId, input.version);
      if (input.targetId !== candidate.leftId && input.targetId !== candidate.rightId) {
        throw new ValidationError('The surviving company must be one of the pair', [{ path: 'targetId', message: 'not in pair' }]);
      }
      const sourceId = input.targetId === candidate.leftId ? candidate.rightId : candidate.leftId;
      const result = await mergeCompaniesTx(tx, ctx, { sourceId, targetId: input.targetId, mode: 'MANUAL', candidateId, reason: input.reason });
      await this.detectForCompany(tx, ctx, input.targetId, { autoMerge: false });
      return result;
    });
  }

  /** "Not the same business" — the pair is never proposed again. */
  async rejectCandidate(ctx: ServiceContext, candidateId: string, input: { version: number; reason?: string }) {
    return this.prisma.client.$transaction(async (tx) => {
      const candidate = await this.openCandidate(tx, ctx, candidateId, input.version);
      const { count } = await tx.entityMatchCandidate.updateMany({
        where: { id: candidate.id, version: input.version, status: { in: OPEN_CANDIDATE } },
        data: {
          status: 'REJECTED',
          resolution: input.reason?.trim() || 'Not the same business',
          resolvedAt: new Date(),
          resolvedByType: ctx.actor.type,
          resolvedById: ctx.actor.id,
          version: { increment: 1 },
        },
      });
      if (count === 0) throw new ConflictError('VERSION_CONFLICT', 'This duplicate was just resolved by someone else — reload');
      const after = await tx.entityMatchCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
      await writeAudit(tx, ctx, { action: 'duplicate.rejected', entityType: 'ENTITY_MATCH_CANDIDATE', entityId: candidate.id, before: { status: candidate.status }, after: { status: after.status, resolution: after.resolution } });
      await recordEvent(tx, ctx, 'DuplicateCandidateRejected', candidate.id, { candidateId: candidate.id, entityType: 'COMPANY', leftId: candidate.leftId, rightId: candidate.rightId });
      return after;
    });
  }

  private async openCandidate(tx: Tx, ctx: ServiceContext, candidateId: string, version: number) {
    const candidate = await tx.entityMatchCandidate.findFirst({ where: { id: candidateId, workspaceId: ctx.workspaceId, entityType: 'COMPANY' } });
    if (!candidate) throw new NotFoundError(`duplicate candidate ${candidateId} not found`);
    if (!OPEN_CANDIDATE.includes(candidate.status)) {
      throw new BusinessRuleError('INVALID_STATE_TRANSITION', `This duplicate was already resolved (${candidate.status.toLowerCase().replace('_', ' ')})`);
    }
    if (candidate.version !== version) throw new ConflictError('VERSION_CONFLICT', 'This duplicate changed since you opened it — reload');
    return candidate;
  }
}
