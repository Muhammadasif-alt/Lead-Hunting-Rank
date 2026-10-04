import { Injectable } from '@nestjs/common';
import type { Company, CompanyAlias, ConfidenceLevel, MatchCandidateStatus, Prisma, PrismaClient } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
  isSharedHost,
  scoreCompanyMatch,
  type CompanyMatch,
  type CompanyMatchRecord,
} from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';
import { writeAudit, type ServiceContext, type Tx } from '../../domain/service-context.js';
import { mergeCompaniesTx } from './company-merge.js';

type Db = Tx | PrismaClient;
type CompanyWithAliases = Company & { aliases: CompanyAlias[] };

export const OPEN_CANDIDATE: MatchCandidateStatus[] = ['PENDING', 'NEEDS_REVIEW'];

/** Actors whose records may be auto-merged. A record a human typed in is never merged away without a human. */
const AUTO_MERGE_ACTORS = new Set(['SYSTEM', 'INTEGRATION']);

export interface MatchResult {
  company: CompanyWithAliases;
  match: CompanyMatch;
}

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
    const company = await tx.company.findFirst({ where: { id: companyId, workspaceId: ctx.workspaceId }, include: { aliases: true } });
    if (!company || company.mergedIntoId || company.status === 'ARCHIVED') return { candidates: [], autoMerged: null };

    const matches = await findCompanyMatches(tx, ctx.workspaceId, toMatchRecord(company), company.id);
    const seen = new Set<string>();
    const candidates = [];
    for (const { company: other, match } of matches) {
      const candidate = await upsertCandidate(tx, ctx, company.id, other.id, match);
      seen.add(candidate.id);
      candidates.push({ candidate, other, match });
    }

    // Candidates that no longer score (e.g. a website was corrected) are closed, not deleted.
    const stale = await tx.entityMatchCandidate.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        entityType: 'COMPANY',
        status: { in: OPEN_CANDIDATE },
        OR: [{ leftId: companyId }, { rightId: companyId }],
        id: { notIn: [...seen] },
      },
    });
    for (const c of stale) {
      await tx.entityMatchCandidate.update({
        where: { id: c.id },
        data: { status: 'AUTO_RESOLVED', resolution: 'No longer similar after the records changed', resolvedAt: new Date(), resolvedByType: 'SYSTEM', version: { increment: 1 } },
      });
    }

    const auto = opts.autoMerge !== false && AUTO_MERGE_ACTORS.has(ctx.actor.type) && company.createdBy === null
      ? candidates.find((c) => c.match.autoMergeSafe && c.candidate.status === 'NEEDS_REVIEW')
      : undefined;
    if (!auto) return { candidates, autoMerged: null };

    // The newer, system-created record folds into the existing one.
    const merged = await mergeCompaniesTx(tx, ctx, {
      sourceId: company.id,
      targetId: auto.other.id,
      mode: 'AUTO',
      candidateId: auto.candidate.id,
      reason: auto.match.matching.map((m) => m.detail).join('; '),
    });
    await this.detectForCompany(tx, ctx, auto.other.id, { autoMerge: false });
    return { candidates, autoMerged: merged.merge };
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

export function toMatchRecord(c: CompanyWithAliases): CompanyMatchRecord {
  const of = (type: CompanyAlias['aliasType']) => c.aliases.filter((a) => a.aliasType === type).map((a) => a.normalizedValue);
  return {
    normalizedName: c.normalizedName,
    websiteDomain: c.websiteDomain,
    phone: c.phone,
    addressLine: c.addressLine,
    city: c.city,
    region: c.region,
    country: c.country,
    postalCode: c.postalCode,
    aliases: { names: of('NAME'), domains: of('DOMAIN'), phones: of('PHONE') },
  };
}

/** Blocking keys → candidate ids (aliases + trigram name index) → deterministic scoring. Best matches first. */
export async function findCompanyMatches(db: Db, workspaceId: string, record: CompanyMatchRecord, excludeId?: string): Promise<MatchResult[]> {
  const keys = matchKeys(record);
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM "Company" c
    WHERE c."workspaceId" = ${workspaceId}::uuid
      AND c."mergedIntoId" IS NULL
      AND c.status <> 'ARCHIVED'
      AND c.id <> COALESCE(${excludeId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (
        c."websiteDomain" = ANY(${keys.domains}::text[])
        OR c.phone = ANY(${keys.phones}::text[])
        OR c."normalizedName" % ${record.normalizedName}
        OR c.id IN (
          SELECT a."companyId" FROM "CompanyAlias" a
          WHERE a."workspaceId" = ${workspaceId}::uuid
            AND ((a."aliasType" = 'DOMAIN' AND a."normalizedValue" = ANY(${keys.domains}::text[]))
              OR (a."aliasType" = 'PHONE' AND a."normalizedValue" = ANY(${keys.phones}::text[]))
              OR (a."aliasType" = 'NAME' AND a."normalizedValue" = ANY(${keys.names}::text[])))
        )
      )
    LIMIT 50`;
  if (rows.length === 0) return [];

  const companies = await db.company.findMany({ where: { id: { in: rows.map((r) => r.id) } }, include: { aliases: true } });
  return companies
    .map((company) => ({ company, match: scoreCompanyMatch(record, toMatchRecord(company)) }))
    .filter((m) => m.match.confidence !== null)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 10);
}

/**
 * Serializes concurrent creates/edits that share a website, phone or exact name (transaction-scoped advisory locks),
 * so two simultaneous imports of the same business can't both miss each other.
 */
export async function lockMatchKeys(tx: Tx, workspaceId: string, record: CompanyMatchRecord): Promise<void> {
  const keys = matchKeys(record);
  const all = [...keys.domains.map((d) => `d:${d}`), ...keys.phones.map((p) => `p:${p}`), ...keys.names.map((n) => `n:${n}`)].map((k) => `${workspaceId}:${k}`).sort();
  for (const key of all) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

function matchKeys(record: CompanyMatchRecord) {
  const uniq = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))];
  return {
    domains: uniq([record.websiteDomain, ...(record.aliases?.domains ?? [])]).filter((d) => !isSharedHost(d)),
    phones: uniq([record.phone, ...(record.aliases?.phones ?? [])]),
    names: uniq([record.normalizedName, ...(record.aliases?.names ?? [])]),
  };
}

const CANDIDATE_STATUS: Record<ConfidenceLevel, MatchCandidateStatus> = { HIGH: 'NEEDS_REVIEW', MEDIUM: 'NEEDS_REVIEW', LOW: 'PENDING' };

async function upsertCandidate(tx: Tx, ctx: ServiceContext, a: string, b: string, match: CompanyMatch) {
  const [leftId, rightId] = a < b ? [a, b] : [b, a];
  const confidence = match.confidence!;
  const signals = {
    score: match.score,
    confidence,
    matchingSignals: match.matching as unknown as Prisma.InputJsonValue,
    conflictingSignals: match.conflicting as unknown as Prisma.InputJsonValue,
    lastEvaluatedAt: new Date(),
  };
  const key = { workspaceId: ctx.workspaceId, entityType: 'COMPANY' as const, leftId, rightId };
  const existing = await tx.entityMatchCandidate.findUnique({ where: { workspaceId_entityType_leftId_rightId: key } });

  if (existing) {
    // A human's "not the same" (or a completed merge) is final — new evidence only refreshes the signals.
    if (existing.status === 'REJECTED' || existing.status === 'MERGED') return existing;
    const reopened = existing.status === 'AUTO_RESOLVED';
    return tx.entityMatchCandidate.update({
      where: { id: existing.id },
      data: { ...signals, status: CANDIDATE_STATUS[confidence], ...(reopened ? { resolvedAt: null, resolvedByType: null, resolution: null } : {}), version: { increment: 1 } },
    });
  }

  const candidate = await tx.entityMatchCandidate.create({ data: { ...key, ...signals, status: CANDIDATE_STATUS[confidence] } });
  await writeAudit(tx, ctx, { action: 'duplicate.detected', entityType: 'ENTITY_MATCH_CANDIDATE', entityId: candidate.id, after: { leftId, rightId, score: match.score, confidence } });
  await recordEvent(tx, ctx, 'DuplicateCandidateDetected', candidate.id, { candidateId: candidate.id, entityType: 'COMPANY', leftId, rightId, score: match.score, confidence });
  return candidate;
}
