import { Injectable } from '@nestjs/common';
import type { CompanyStatus } from '@revenue-os/database';
import {
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

/** Canonical company records (docs/06 §15-21). Creates name/domain/phone aliases for later entity resolution. */
@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ctx: ServiceContext, input: CompanyInput) {
    const data = this.normalize(input);
    return this.prisma.client.$transaction(async (tx) => {
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
      return company;
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
      const data = this.normalize({ displayName: before.displayName, ...input }, input);

      const { count } = await tx.company.updateMany({
        where: { id, workspaceId: ctx.workspaceId, version: expectedVersion },
        data: { ...data, updatedBy: actorUserId(ctx), version: { increment: 1 } },
      });
      if (count === 0) throw new ConflictError('VERSION_CONFLICT', 'Company was changed by someone else — reload and try again');

      const after = await tx.company.findUniqueOrThrow({ where: { id } });
      await this.syncAliases(tx, ctx.workspaceId, id, input, data);
      await writeAudit(tx, ctx, { action: 'company.updated', entityType: 'COMPANY', entityId: id, before, after });
      await recordEvent(tx, ctx, 'CompanyUpdated', id, { companyId: id, version: after.version, changedFields: Object.keys(input) });
      return after;
    });
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
