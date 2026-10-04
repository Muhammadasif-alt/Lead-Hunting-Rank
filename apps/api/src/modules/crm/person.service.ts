import { Injectable } from '@nestjs/common';
import type { ConfidenceLevel } from '@revenue-os/database';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@revenue-os/shared';
import { recordEvent } from '@revenue-os/events';
import { PrismaService } from '../../infra/prisma.service.js';
import { actorUserId, writeAudit, type ServiceContext, type Tx } from '../../domain/service-context.js';

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

export type RoleInput = Pick<EmploymentInput, 'title' | 'department' | 'seniority'>;

/** People and their employment history. A person never has a company_id — Employment links them (docs/06 §22-26). */
@Injectable()
export class PersonService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ctx: ServiceContext, input: PersonInput) {
    return this.prisma.client.$transaction((tx) => this.createTx(tx, ctx, input));
  }

  /** New person who works at `companyId`, in one transaction (Company 360 → People → Add person). */
  async addToCompany(ctx: ServiceContext, companyId: string, input: PersonInput & RoleInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const company = await tx.company.findFirst({ where: { id: companyId, workspaceId: ctx.workspaceId }, select: { id: true, mergedIntoId: true, status: true } });
      if (!company) throw new NotFoundError(`company ${companyId} not found`);
      if (company.mergedIntoId || company.status === 'ARCHIVED') {
        throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'People can only be added to an active company record');
      }
      const { fullName } = personName(input);
      const existing = await tx.employment.findFirst({
        where: { workspaceId: ctx.workspaceId, companyId, isCurrent: true, person: { fullName: { equals: fullName, mode: 'insensitive' } } },
        select: { personId: true },
      });
      if (existing) throw new ConflictError('ALREADY_EXISTS', `${fullName} already works at this company`);

      const person = await this.createTx(tx, ctx, input);
      const employment = await this.attachTx(tx, ctx, { personId: person.id, companyId, title: input.title, department: input.department, seniority: input.seniority });
      return { person, employment };
    });
  }

  async update(ctx: ServiceContext, id: string, expectedVersion: number, input: PersonInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.person.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!before) throw new NotFoundError(`person ${id} not found`);
      const names = input.firstName !== undefined || input.lastName !== undefined || input.fullName !== undefined
        ? personName({ firstName: input.firstName ?? before.firstName ?? undefined, lastName: input.lastName ?? before.lastName ?? undefined, fullName: input.fullName })
        : {};
      const data = {
        ...names,
        ...(input.linkedinUrl !== undefined ? { linkedinUrl: input.linkedinUrl.trim() || null } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone.trim() || null } : {}),
        ...(input.language !== undefined ? { language: input.language.trim() || null } : {}),
      };
      const { count } = await tx.person.updateMany({
        where: { id, workspaceId: ctx.workspaceId, version: expectedVersion },
        data: { ...data, updatedBy: actorUserId(ctx), version: { increment: 1 } },
      });
      if (count === 0) throw new ConflictError('VERSION_CONFLICT', 'This person was changed by someone else — reload and try again');
      const after = await tx.person.findUniqueOrThrow({ where: { id } });
      await writeAudit(tx, ctx, { action: 'person.updated', entityType: 'PERSON', entityId: id, before, after });
      await recordEvent(tx, ctx, 'PersonUpdated', id, { personId: id, version: after.version, changedFields: Object.keys(input) });
      return after;
    });
  }

  async attachEmployment(ctx: ServiceContext, input: EmploymentInput) {
    return this.prisma.client.$transaction((tx) => this.attachTx(tx, ctx, input));
  }

  /** "No longer works here" — the employment row stays as history (Contact History Across Companies, screen #4 §30). */
  async endEmployment(ctx: ServiceContext, employmentId: string, endedAt: Date = new Date()) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.employment.findFirst({ where: { id: employmentId, workspaceId: ctx.workspaceId } });
      if (!before) throw new NotFoundError(`employment ${employmentId} not found`);
      if (!before.isCurrent) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This employment has already ended');
      if (before.startedAt && endedAt < before.startedAt) throw new ValidationError('End date is before start date', [{ path: 'endedAt', message: 'before startedAt' }]);
      const after = await tx.employment.update({ where: { id: employmentId }, data: { isCurrent: false, endedAt, version: { increment: 1 } } });
      await writeAudit(tx, ctx, { action: 'employment.ended', entityType: 'EMPLOYMENT', entityId: employmentId, before, after });
      await recordEvent(tx, ctx, 'EmploymentEnded', employmentId, { employmentId, personId: after.personId, companyId: after.companyId });
      return after;
    });
  }

  private async createTx(tx: Tx, ctx: ServiceContext, input: PersonInput) {
    const { firstName, lastName, fullName } = personName(input);
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
  }

  private async attachTx(tx: Tx, ctx: ServiceContext, input: EmploymentInput) {
    if (input.startedAt && input.endedAt && input.endedAt < input.startedAt) {
      throw new ValidationError('End date is before start date', [{ path: 'endedAt', message: 'before startedAt' }]);
    }
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
  }
}

function personName(input: PersonInput) {
  const firstName = input.firstName?.trim() || null;
  const lastName = input.lastName?.trim() || null;
  const fullName = input.fullName?.trim() || [firstName, lastName].filter(Boolean).join(' ');
  if (!fullName) throw new ValidationError('A name is required', [{ path: 'fullName', message: 'required' }]);
  return { firstName, lastName, fullName };
}
