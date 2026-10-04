import { Injectable } from '@nestjs/common';
import type { CompanyStatus } from '@revenue-os/database';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
  normalizeCompanyName,
  normalizeDomain,
  normalizePhone,
} from '@revenue-os/shared';
import { recordEvent } from '@revenue-os/events';
import { PrismaService } from '../../infra/prisma.service.js';
import { actorUserId, writeAudit, type ServiceContext, type Tx } from '../../domain/service-context.js';
import { EntityResolutionService, lockMatchKeys } from './entity-resolution.service.js';

export interface CompanyInput {
  displayName: string;
  legalName?: string;
  website?: string;
  phone?: string;
  status?: CompanyStatus;
  industry?: string;
  addressLine?: string;
  city?: string;
  region?: string;
  country?: string;
  postalCode?: string;
}

/** Fields whose change can make (or unmake) a duplicate. */
const MATCH_FIELDS: (keyof CompanyInput)[] = ['displayName', 'website', 'phone', 'addressLine', 'city', 'region', 'country', 'postalCode'];

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
    const data = this.normalize(input);
    return this.prisma.client.$transaction(async (tx) => {
      await lockMatchKeys(tx, ctx.workspaceId, { ...data, websiteDomain: data.websiteDomain ?? null, phone: data.phone ?? null });
      const company = await tx.company.create({
        data: { ...data, workspaceId: ctx.workspaceId, createdBy: actorUserId(ctx), updatedBy: actorUserId(ctx) },
      });
      await this.syncAliases(tx, ctx.workspaceId, company.id, input, data);
      await writeAudit(tx, ctx, { action: 'company.created', entityType: 'COMPANY', entityId: company.id, after: company });
      await recordEvent(tx, ctx, 'CompanyCreated', company.id, {
        companyId: company.id,
        displayName: company.displayName,
        websiteDomain: company.websiteDomain,
      });
      const { autoMerged } = await this.resolution.detectForCompany(tx, ctx, company.id);
      // A system-created record that was folded into an existing company comes back as its archived self.
      return autoMerged ? tx.company.findUniqueOrThrow({ where: { id: company.id } }) : company;
    });
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
      const data = this.normalize({ displayName: before.displayName, ...input }, input);
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
      await this.syncAliases(tx, ctx.workspaceId, id, input, data);
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
    const d = this.normalize(input);
    return { ...d, websiteDomain: d.websiteDomain ?? null, phone: d.phone ?? null };
  }

  /** Maps input to columns. With `only`, returns just the fields present in it (for partial updates). */
  private normalize(input: CompanyInput, only?: Partial<CompanyInput>) {
    const displayName = input.displayName.trim();
    if (!displayName) throw new ValidationError('Company name is required', [{ path: 'displayName', message: 'required' }]);

    let websiteDomain: string | null | undefined;
    if (input.website !== undefined) {
      websiteDomain = input.website.trim() ? normalizeDomain(input.website) : null;
      if (input.website.trim() && !websiteDomain) throw new ValidationError('Invalid website', [{ path: 'website', message: 'invalid' }]);
    }
    let phone: string | null | undefined;
    if (input.phone !== undefined) {
      phone = input.phone.trim() ? normalizePhone(input.phone) : null;
      if (input.phone.trim() && !phone) throw new ValidationError('Invalid phone number', [{ path: 'phone', message: 'invalid' }]);
    }
    const country = input.country?.trim().toUpperCase();
    if (country && !/^[A-Z]{2}$/.test(country)) throw new ValidationError('Country must be an ISO-3166 alpha-2 code', [{ path: 'country', message: 'invalid' }]);

    const all = {
      displayName,
      normalizedName: normalizeCompanyName(displayName),
      legalName: input.legalName?.trim() || null,
      websiteDomain,
      phone,
      status: input.status,
      industry: input.industry?.trim() || null,
      addressLine: input.addressLine?.trim() || null,
      city: input.city?.trim() || null,
      region: input.region?.trim() || null,
      country: country || null,
      postalCode: input.postalCode?.trim() || null,
    };
    if (!only) return all;

    const keyFor: Record<string, keyof typeof all | (keyof typeof all)[]> = {
      displayName: ['displayName', 'normalizedName'],
      website: 'websiteDomain',
    };
    const picked: Partial<typeof all> = {};
    for (const key of Object.keys(only)) {
      const cols = keyFor[key] ?? (key as keyof typeof all);
      for (const col of Array.isArray(cols) ? cols : [cols]) (picked as Record<string, unknown>)[col] = all[col];
    }
    return picked as typeof all;
  }

  private async syncAliases(
    tx: Tx,
    workspaceId: string,
    companyId: string,
    input: Partial<CompanyInput>,
    data: { displayName?: string; normalizedName?: string; websiteDomain?: string | null; phone?: string | null },
  ) {
    const aliases = [
      input.displayName !== undefined && data.normalizedName
        ? { aliasType: 'NAME' as const, value: data.displayName!, normalizedValue: data.normalizedName }
        : null,
      input.website !== undefined && data.websiteDomain
        ? { aliasType: 'DOMAIN' as const, value: input.website!, normalizedValue: data.websiteDomain }
        : null,
      input.phone !== undefined && data.phone ? { aliasType: 'PHONE' as const, value: input.phone!, normalizedValue: data.phone } : null,
    ].filter((a) => a !== null);
    if (aliases.length === 0) return;
    await tx.companyAlias.createMany({
      data: aliases.map((a) => ({ ...a, workspaceId, companyId, source: 'manual' })),
      skipDuplicates: true,
    });
  }
}

function assertEditable(company: { mergedIntoId: string | null; status: CompanyStatus }) {
  if (company.mergedIntoId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This company was merged into another record — edit the surviving company');
  if (company.status === 'ARCHIVED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This company is archived — restore it first');
}
