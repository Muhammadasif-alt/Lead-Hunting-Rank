import { Injectable } from '@nestjs/common';
import type { ContactPointType } from '@revenue-os/database';
import { ConflictError, ValidationError, normalizeEmail, normalizePhone } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';
import {
  actorUserId,
  assertEntityInWorkspace,
  isUniqueViolation,
  writeAudit,
  type ServiceContext,
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
        if (input.isPrimary) {
          await tx.contactPoint.updateMany({
            where: { workspaceId: ctx.workspaceId, entityType: input.entityType, entityId: input.entityId, type: input.type, isPrimary: true },
            data: { isPrimary: false, version: { increment: 1 } },
          });
        }
        const contactPoint = await tx.contactPoint.create({
          data: {
            workspaceId: ctx.workspaceId,
            entityType: input.entityType,
            entityId: input.entityId,
            type: input.type,
            value: input.value.trim(),
            normalizedValue,
            label: input.label?.trim() || null,
            isPrimary: input.isPrimary ?? false,
            createdBy: actorUserId(ctx),
          },
        });
        await writeAudit(tx, ctx, { action: 'contact_point.added', entityType: 'CONTACT_POINT', entityId: contactPoint.id, after: contactPoint });
        return contactPoint;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('ALREADY_EXISTS', `${normalizedValue} is already recorded for this ${input.entityType.toLowerCase()}`);
      throw err;
    }
  }
}
