import { Injectable } from '@nestjs/common';
import type { ConfidenceLevel } from '@revenue-os/database';
import { NotFoundError, ValidationError } from '@revenue-os/shared';
import { recordEvent } from '@revenue-os/events';
import { PrismaService } from '../../infra/prisma.service.js';
import { actorUserId, writeAudit, type ServiceContext } from '../../domain/service-context.js';

export interface PersonInput {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  linkedinUrl?: string;
  timezone?: string;
  language?: string;
}

export interface EmploymentInput {
  personId: string;
  companyId: string;
  title?: string;
  department?: string;
  seniority?: string;
  isCurrent?: boolean;
  startedAt?: Date;
  endedAt?: Date;
  confidence?: ConfidenceLevel;
}

/** People and their employment history. A person never has a company_id — Employment links them (docs/06 §22-26). */
@Injectable()
export class PersonService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ctx: ServiceContext, input: PersonInput) {
    const firstName = input.firstName?.trim() || null;
    const lastName = input.lastName?.trim() || null;
    const fullName = input.fullName?.trim() || [firstName, lastName].filter(Boolean).join(' ');
    if (!fullName) throw new ValidationError('A name is required', [{ path: 'fullName', message: 'required' }]);

    return this.prisma.client.$transaction(async (tx) => {
      const person = await tx.person.create({
        data: {
          workspaceId: ctx.workspaceId,
          firstName,
          lastName,
          fullName,
          linkedinUrl: input.linkedinUrl?.trim() || null,
          timezone: input.timezone ?? null,
          language: input.language ?? null,
          createdBy: actorUserId(ctx),
          updatedBy: actorUserId(ctx),
        },
      });
      await writeAudit(tx, ctx, { action: 'person.created', entityType: 'PERSON', entityId: person.id, after: person });
      await recordEvent(tx, ctx, 'PersonCreated', person.id, { personId: person.id });
      return person;
    });
  }

  async attachEmployment(ctx: ServiceContext, input: EmploymentInput) {
    if (input.startedAt && input.endedAt && input.endedAt < input.startedAt) {
      throw new ValidationError('End date is before start date', [{ path: 'endedAt', message: 'before startedAt' }]);
    }
    return this.prisma.client.$transaction(async (tx) => {
      const where = { workspaceId: ctx.workspaceId };
      const [person, company] = await Promise.all([
        tx.person.findFirst({ where: { ...where, id: input.personId }, select: { id: true } }),
        tx.company.findFirst({ where: { ...where, id: input.companyId }, select: { id: true } }),
      ]);
      if (!person) throw new NotFoundError(`person ${input.personId} not found`);
      if (!company) throw new NotFoundError(`company ${input.companyId} not found`);

      const isCurrent = input.isCurrent ?? !input.endedAt;
      const employment = await tx.employment.create({
        data: {
          workspaceId: ctx.workspaceId,
          personId: input.personId,
          companyId: input.companyId,
          title: input.title?.trim() || null,
          department: input.department?.trim() || null,
          seniority: input.seniority?.trim() || null,
          isCurrent,
          startedAt: input.startedAt ?? null,
          endedAt: input.endedAt ?? null,
          confidence: input.confidence ?? 'MEDIUM',
          createdBy: actorUserId(ctx),
        },
      });
      await writeAudit(tx, ctx, { action: 'employment.attached', entityType: 'EMPLOYMENT', entityId: employment.id, after: employment });
      await recordEvent(tx, ctx, 'EmploymentAttached', employment.id, {
        employmentId: employment.id,
        personId: employment.personId,
        companyId: employment.companyId,
      });
      return employment;
    });
  }
}
