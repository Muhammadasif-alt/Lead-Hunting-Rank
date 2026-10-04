import { Injectable } from '@nestjs/common';
import type { ContactPointType, EntityType } from '@revenue-os/database';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError, normalizeEmail, normalizePhone } from '@revenue-os/shared';
import { recordEvent } from '@revenue-os/events';
import { PrismaService } from '../../infra/prisma.service.js';
import {
  actorUserId,
  assertEntityInWorkspace,
  isUniqueViolation,
  writeAudit,
  type ServiceContext,
  type Tx,
} from '../../domain/service-context.js';

export interface ContactPointInput {
  entityType: 'COMPANY' | 'PERSON';
  entityId: string;
  type: ContactPointType;
  value: string;
  label?: string;
  isPrimary?: boolean;
}

/**
 * Emails/phones for a company or person. New contact points are UNVERIFIED with LOW confidence — only a
 * ContactVerification (Phase 8) may mark them verified; a guessed email is never shown as verified.
 * Removing one archives it: the row stays so history (and any send that used it) remains explainable.
 */
@Injectable()
export class ContactPointService {
  constructor(private readonly prisma: PrismaService) {}

  async add(ctx: ServiceContext, input: ContactPointInput) {
    const normalizedValue = input.type === 'EMAIL' ? normalizeEmail(input.value) : input.type === 'OTHER' ? input.value.trim() : normalizePhone(input.value);
    if (!normalizedValue) throw new ValidationError(`Invalid ${input.type.toLowerCase()}`, [{ path: 'value', message: 'invalid' }]);

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        await assertEntityInWorkspace(tx, ctx.workspaceId, input.entityType, input.entityId);
        if (input.entityType === 'COMPANY') await assertCompanyActive(tx, ctx.workspaceId, input.entityId);
        const scope = { workspaceId: ctx.workspaceId, entityType: input.entityType, entityId: input.entityId };

        // Re-adding a value that was removed earlier brings the old row back (keeps its first_seen and verifications).
        const archived = await tx.contactPoint.findFirst({ where: { ...scope, type: input.type, normalizedValue, archivedAt: { not: null } } });
        if (input.isPrimary) await this.clearPrimary(tx, scope, input.type);

        const contactPoint = archived
          ? await tx.contactPoint.update({
              where: { id: archived.id },
              data: { archivedAt: null, value: input.value.trim(), label: input.label?.trim() || archived.label, isPrimary: input.isPrimary ?? false, version: { increment: 1 } },
            })
          : await tx.contactPoint.create({
              data: {
                ...scope,
                type: input.type,
                value: input.value.trim(),
                normalizedValue,
                label: input.label?.trim() || null,
                isPrimary: input.isPrimary ?? false,
                createdBy: actorUserId(ctx),
              },
            });
        await writeAudit(tx, ctx, { action: archived ? 'contact_point.restored' : 'contact_point.added', entityType: 'CONTACT_POINT', entityId: contactPoint.id, after: contactPoint });
        await recordEvent(tx, ctx, 'ContactPointAdded', contactPoint.id, {
          contactPointId: contactPoint.id,
          entityType: contactPoint.entityType,
          entityId: contactPoint.entityId,
          type: contactPoint.type,
        });
        return contactPoint;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('ALREADY_EXISTS', `${normalizedValue} is already recorded for this ${input.entityType.toLowerCase()}`);
      throw err;
    }
  }

  /** Makes this the primary email/phone of its kind for the entity. */
  async makePrimary(ctx: ServiceContext, id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await this.live(tx, ctx, id);
      if (before.isPrimary) return before;
      await this.clearPrimary(tx, { workspaceId: ctx.workspaceId, entityType: before.entityType, entityId: before.entityId }, before.type);
      const after = await tx.contactPoint.update({ where: { id }, data: { isPrimary: true, version: { increment: 1 } } });
      await writeAudit(tx, ctx, { action: 'contact_point.made_primary', entityType: 'CONTACT_POINT', entityId: id, before: { isPrimary: false }, after: { isPrimary: true } });
      await recordEvent(tx, ctx, 'ContactPointUpdated', id, { contactPointId: id, entityType: after.entityType, entityId: after.entityId, changedFields: ['isPrimary'] });
      return after;
    });
  }

  async archive(ctx: ServiceContext, id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await this.live(tx, ctx, id);
      const after = await tx.contactPoint.update({ where: { id }, data: { archivedAt: new Date(), isPrimary: false, version: { increment: 1 } } });
      await writeAudit(tx, ctx, { action: 'contact_point.archived', entityType: 'CONTACT_POINT', entityId: id, before, after: { archivedAt: after.archivedAt } });
      await recordEvent(tx, ctx, 'ContactPointArchived', id, { contactPointId: id, entityType: after.entityType, entityId: after.entityId });
      return after;
    });
  }

  private async live(tx: Tx, ctx: ServiceContext, id: string) {
    const cp = await tx.contactPoint.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!cp) throw new NotFoundError(`contact point ${id} not found`);
    if (cp.archivedAt) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This contact point was removed');
    if (cp.entityType === 'COMPANY') await assertCompanyActive(tx, ctx.workspaceId, cp.entityId);
    return cp;
  }

  private clearPrimary(tx: Tx, scope: { workspaceId: string; entityType: EntityType; entityId: string }, type: ContactPointType) {
    return tx.contactPoint.updateMany({
      where: { workspaceId: scope.workspaceId, entityType: scope.entityType, entityId: scope.entityId, type, isPrimary: true },
      data: { isPrimary: false, version: { increment: 1 } },
    });
  }
}

async function assertCompanyActive(tx: Tx, workspaceId: string, companyId: string) {
  const company = await tx.company.findFirst({ where: { id: companyId, workspaceId }, select: { mergedIntoId: true, status: true } });
  if (company?.mergedIntoId || company?.status === 'ARCHIVED') {
    throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Contact details can only change on an active company record');
  }
}
