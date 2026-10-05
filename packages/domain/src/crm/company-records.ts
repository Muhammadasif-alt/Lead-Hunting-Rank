import type { CompanyStatus } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import { BusinessRuleError, ValidationError, normalizeCompanyName, normalizeDomain, normalizePhone } from '@revenue-os/shared';
import { actorUserId, writeAudit, type ServiceContext, type Tx } from '../context.js';
import { detectCompanyDuplicates, lockMatchKeys } from './entity-resolution.js';

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

export type CompanyColumns = ReturnType<typeof normalizeCompanyInput>;

/** Fields whose change can make (or unmake) a duplicate. */
export const MATCH_FIELDS: (keyof CompanyInput)[] = ['displayName', 'website', 'phone', 'addressLine', 'city', 'region', 'country', 'postalCode'];

/** Maps input to columns. With `only`, returns just the fields present in it (for partial updates). */
export function normalizeCompanyInput(input: CompanyInput, only?: Partial<CompanyInput>) {
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

/** Names, domains and phones a company is known by — what entity resolution looks up later. */
export async function syncCompanyAliases(
  tx: Tx,
  workspaceId: string,
  companyId: string,
  input: Partial<CompanyInput>,
  data: { displayName?: string; normalizedName?: string; websiteDomain?: string | null; phone?: string | null },
  source = 'manual',
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
    data: aliases.map((a) => ({ ...a, workspaceId, companyId, source })),
    skipDuplicates: true,
  });
}

/**
 * Creates a canonical company inside the caller's transaction: match keys locked, aliases written, audited, event
 * recorded, and entity resolution run — a likely duplicate becomes a review candidate the moment it appears.
 * A system-created record that was folded into an existing company is returned as its archived self.
 */
export async function createCompanyTx(tx: Tx, ctx: ServiceContext, input: CompanyInput, opts: { aliasSource?: string } = {}) {
  const data = normalizeCompanyInput(input);
  await lockMatchKeys(tx, ctx.workspaceId, { ...data, websiteDomain: data.websiteDomain ?? null, phone: data.phone ?? null });
  const company = await tx.company.create({
    data: { ...data, workspaceId: ctx.workspaceId, createdBy: actorUserId(ctx), updatedBy: actorUserId(ctx) },
  });
  await syncCompanyAliases(tx, ctx.workspaceId, company.id, input, data, opts.aliasSource);
  await writeAudit(tx, ctx, { action: 'company.created', entityType: 'COMPANY', entityId: company.id, after: company });
  await recordEvent(tx, ctx, 'CompanyCreated', company.id, {
    companyId: company.id,
    displayName: company.displayName,
    websiteDomain: company.websiteDomain,
  });
  const detection = await detectCompanyDuplicates(tx, ctx, company.id);
  const result = detection.autoMerged ? await tx.company.findUniqueOrThrow({ where: { id: company.id } }) : company;
  return { company: result, detection };
}

export function assertCompanyEditable(company: { mergedIntoId: string | null; status: CompanyStatus }) {
  if (company.mergedIntoId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This company was merged into another record — edit the surviving company');
  if (company.status === 'ARCHIVED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This company is archived — restore it first');
}
