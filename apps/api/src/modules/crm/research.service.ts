import { Injectable } from '@nestjs/common';
import type { ResearchRun } from '@revenue-os/database';
import { requestCompanyIntelligenceTx } from '@revenue-os/ai';
import { requestResearchTx } from '@revenue-os/domain';
import { BusinessRuleError, NotFoundError } from '@revenue-os/shared';
import type { ServiceContext, Tx } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';

export function presentRun(r: ResearchRun) {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    steps: r.steps,
    gaps: r.gaps,
    summary: r.summary,
    error: r.error,
    missionId: r.missionId,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
  };
}

/**
 * "Research this company now" (Phase 8). Creates one QUEUED run per company — asking twice returns the run already
 * waiting — and the ResearchRequested event schedules the worker in the same transaction (outbox).
 */
@Injectable()
export class ResearchService {
  constructor(private readonly prisma: PrismaService) {}

  async request(ctx: ServiceContext, companyId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.assertActive(tx, ctx, companyId);
      const { run, created } = await requestResearchTx(tx, ctx, companyId);
      return { run: presentRun(run), created };
    });
  }

  /** "Assess again" (Phase 9): the company's AI agents run on what we know now; nothing external happens. */
  async requestAssessment(ctx: ServiceContext, companyId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.assertActive(tx, ctx, companyId);
      return requestCompanyIntelligenceTx(tx, ctx, companyId);
    });
  }

  private async assertActive(tx: Tx, ctx: ServiceContext, companyId: string) {
    const company = await tx.company.findFirst({ where: { id: companyId, workspaceId: ctx.workspaceId }, select: { mergedIntoId: true, status: true } });
    if (!company) throw new NotFoundError(`company ${companyId} not found`);
    if (company.mergedIntoId || company.status === 'ARCHIVED') {
      throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only an active company record can be researched');
    }
  }
}
