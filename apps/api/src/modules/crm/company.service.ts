import { Injectable } from '@nestjs/common';
import {
  MATCH_FIELDS,
  assertCompanyEditable as assertEditable,
  createCompanyTx,
  lockMatchKeys,
  normalizeCompanyInput,
  syncCompanyAliases,
  type CompanyInput,
} from '@revenue-os/domain';
import { BusinessRuleError, ConflictError, NotFoundError } from '@revenue-os/shared';
import { recordEvent } from '@revenue-os/events';
import { PrismaService } from '../../infra/prisma.service.js';
import { actorUserId, writeAudit, type ServiceContext } from '../../domain/service-context.js';
import { EntityResolutionService } from './entity-resolution.service.js';

export type { CompanyInput } from '@revenue-os/domain';

/**
 * Canonical company records (docs/06 §15-21). Creates name/domain/phone aliases and runs entity resolution in the same
 * transaction, so a likely duplicate becomes a review candidate the moment it appears — never a silent merge.
 */
@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolution: EntityResolutionService,
  ) {}

  async create(ctx: ServiceContext, input: CompanyInput) {
    return this.prisma.client.$transaction(async (tx) => (await createCompanyTx(tx, ctx, input)).company);
  }

  async get(ctx: ServiceContext, id: string) {
    const company = await this.prisma.client.company.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!company) throw new NotFoundError(`company ${id} not found`);
    return company;
  }

  /** Optimistic concurrency: the caller sends the version it read; a stale version is a 409, never a silent overwrite. */
  async update(ctx: ServiceContext, id: string, expectedVersion: number, input: Partial<CompanyInput>) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.company.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!before) throw new NotFoundError(`company ${id} not found`);
      assertEditable(before);
      const data = normalizeCompanyInput({ displayName: before.displayName, ...input }, input);
      const rematch = MATCH_FIELDS.some((f) => input[f] !== undefined);
      if (rematch) {
        await lockMatchKeys(tx, ctx.workspaceId, {
          ...before,
          ...data,
          websiteDomain: data.websiteDomain === undefined ? before.websiteDomain : data.websiteDomain,
          phone: data.phone === undefined ? before.phone : data.phone,
        });
      }

      const { count } = await tx.company.updateMany({
        where: { id, workspaceId: ctx.workspaceId, version: expectedVersion },
        data: { ...data, updatedBy: actorUserId(ctx), version: { increment: 1 } },
      });
      if (count === 0) throw new ConflictError('VERSION_CONFLICT', 'Company was changed by someone else — reload and try again');

      const after = await tx.company.findUniqueOrThrow({ where: { id } });
      await syncCompanyAliases(tx, ctx.workspaceId, id, input, data);
      await writeAudit(tx, ctx, { action: 'company.updated', entityType: 'COMPANY', entityId: id, before, after });
      await recordEvent(tx, ctx, 'CompanyUpdated', id, { companyId: id, version: after.version, changedFields: Object.keys(input) });
      if (rematch) await this.resolution.detectForCompany(tx, ctx, id, { autoMerge: false });
      return after;
    });
  }

  /** Hides a company from lists and outreach; nothing is deleted. */
  async archive(ctx: ServiceContext, id: string, expectedVersion: number, reason?: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.company.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!before) throw new NotFoundError(`company ${id} not found`);
      assertEditable(before);
      const { count } = await tx.company.updateMany({
        where: { id, workspaceId: ctx.workspaceId, version: expectedVersion },
        data: { status: 'ARCHIVED', archivedAt: new Date(), updatedBy: actorUserId(ctx), version: { increment: 1 } },
      });
      if (count === 0) throw new ConflictError('VERSION_CONFLICT', 'Company was changed by someone else — reload and try again');
      const after = await tx.company.findUniqueOrThrow({ where: { id } });
      await writeAudit(tx, ctx, { action: 'company.archived', entityType: 'COMPANY', entityId: id, before: { status: before.status }, after: { status: after.status }, reason });
      await recordEvent(tx, ctx, 'CompanyArchived', id, { companyId: id, reason: reason?.trim() || null });
      // An archived record is out of entity resolution; its open duplicate candidates are closed.
      await tx.entityMatchCandidate.updateMany({
        where: { workspaceId: ctx.workspaceId, entityType: 'COMPANY', status: { in: ['PENDING', 'NEEDS_REVIEW'] }, OR: [{ leftId: id }, { rightId: id }] },
        data: { status: 'AUTO_RESOLVED', resolution: `${before.displayName} was archived`, resolvedAt: new Date(), resolvedByType: 'SYSTEM', version: { increment: 1 } },
      });
      return after;
    });
  }

  /** Brings an archived company back (to ACTIVE) and re-checks it for duplicates. A merged record can't be restored. */
  async restore(ctx: ServiceContext, id: string, expectedVersion: number) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.company.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!before) throw new NotFoundError(`company ${id} not found`);
      if (before.mergedIntoId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This company was merged into another record and cannot be restored');
      if (before.status !== 'ARCHIVED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only an archived company can be restored');
      const { count } = await tx.company.updateMany({
        where: { id, workspaceId: ctx.workspaceId, version: expectedVersion },
        data: { status: 'ACTIVE', archivedAt: null, updatedBy: actorUserId(ctx), version: { increment: 1 } },
      });
      if (count === 0) throw new ConflictError('VERSION_CONFLICT', 'Company was changed by someone else — reload and try again');
      const after = await tx.company.findUniqueOrThrow({ where: { id } });
      await writeAudit(tx, ctx, { action: 'company.restored', entityType: 'COMPANY', entityId: id, before: { status: before.status }, after: { status: after.status } });
      await recordEvent(tx, ctx, 'CompanyRestored', id, { companyId: id });
      await this.resolution.detectForCompany(tx, ctx, id, { autoMerge: false });
      return after;
    });
  }

  /** Re-runs duplicate detection on demand ("Find duplicates"). Returns how many open candidates exist. */
  async detectDuplicates(ctx: ServiceContext, id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const company = await tx.company.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!company) throw new NotFoundError(`company ${id} not found`);
      assertEditable(company);
      const { candidates } = await this.resolution.detectForCompany(tx, ctx, id, { autoMerge: false });
      return candidates.filter((c) => c.candidate.status === 'PENDING' || c.candidate.status === 'NEEDS_REVIEW').length;
    });
  }

  /** Throws unless the company exists in this workspace and is neither archived nor merged away. */
  async assertActive(workspaceId: string, id: string) {
    const company = await this.prisma.client.company.findFirst({ where: { id, workspaceId }, select: { mergedIntoId: true, status: true } });
    if (!company) throw new NotFoundError(`company ${id} not found`);
    assertEditable(company);
  }

  /** Normalized values for a not-yet-created company — used by the create form's duplicate preview. */
  matchRecord(input: CompanyInput) {
    const d = normalizeCompanyInput(input);
    return { ...d, websiteDomain: d.websiteDomain ?? null, phone: d.phone ?? null };
  }
}
