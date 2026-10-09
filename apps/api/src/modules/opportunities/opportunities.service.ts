import { Injectable } from '@nestjs/common';
import type { LossReason, StageSemantic } from '@revenue-os/database';
import {
  addStakeholder,
  changeStage,
  confirmQualificationAnswer,
  createFromConversation,
  createOpportunityTx,
  markLost,
  markWon,
  removeStakeholder,
  reopenOpportunity,
  setQualificationAnswer,
  updateOpportunity,
  updateStakeholder,
  type CreateOpportunityInput,
  type OpportunityPatch,
} from '@revenue-os/outreach';
import { ForbiddenError, type QualificationKey } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';

const TX = { timeout: 30_000, maxWait: 10_000 } as const;
type Role = 'DECISION_MAKER' | 'INFLUENCER' | 'USER' | 'CHAMPION' | 'UNKNOWN';

/** Opportunities (Phase 13): commands from @revenue-os/outreach with the session's ServiceContext. */
@Injectable()
export class OpportunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async create(ctx: ServiceContext, input: CreateOpportunityInput) {
    const o = await this.db.$transaction((tx) => createOpportunityTx(tx, ctx, input), TX);
    return { id: o.id };
  }

  async fromConversation(ctx: ServiceContext, conversationId: string, input: { name?: string | null; service?: string | null; amountMinor?: number | null }) {
    const o = await createFromConversation(this.db, ctx, conversationId, input);
    return { id: o.id };
  }

  async update(ctx: ServiceContext, id: string, patch: OpportunityPatch, version?: number) {
    const o = await updateOpportunity(this.db, ctx, id, patch, version);
    return { id: o.id, version: o.version };
  }

  async stage(ctx: ServiceContext, id: string, stage: StageSemantic, reason: string | null, version?: number) {
    const o = await changeStage(this.db, ctx, id, stage, reason, version);
    return { id: o.id, version: o.version };
  }

  won(ctx: ServiceContext, id: string, input: { amountMinor: number; currency?: string; note: string }) {
    return markWon(this.db, ctx, id, input);
  }

  lost(ctx: ServiceContext, id: string, input: { reason: LossReason; details?: string | null; competitor?: string | null; revisitAt?: Date | null; suggested?: boolean; evidenceQuote?: string | null }) {
    return markLost(this.db, ctx, id, input);
  }

  /** Reopening a won deal also needs the authority to mark deals won. */
  async reopen(ctx: ServiceContext, id: string, reason: string, canMarkWon: boolean) {
    const o = await this.db.opportunity.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { status: true } });
    if (o?.status === 'WON' && !canMarkWon) throw new ForbiddenError('Reopening a won deal needs the “mark won” permission');
    return reopenOpportunity(this.db, ctx, id, reason);
  }

  answer(ctx: ServiceContext, id: string, key: QualificationKey, value: string | null) {
    return setQualificationAnswer(this.db, ctx, id, key, value);
  }

  confirm(ctx: ServiceContext, id: string, answerId: string) {
    return confirmQualificationAnswer(this.db, ctx, id, answerId);
  }

  async addStakeholder(ctx: ServiceContext, id: string, input: { personId?: string | null; name?: string | null; title?: string | null; role?: Role; influence?: string }) {
    const s = await addStakeholder(this.db, ctx, id, input);
    return { id: s.id };
  }

  updateStakeholder(ctx: ServiceContext, id: string, sid: string, input: { name?: string; title?: string | null; role?: Role; influence?: string; status?: 'SUGGESTED' | 'KNOWN' | 'ENGAGED' | 'NOT_CONTACTED' }) {
    return updateStakeholder(this.db, ctx, id, sid, input);
  }

  removeStakeholder(ctx: ServiceContext, id: string, sid: string) {
    return removeStakeholder(this.db, ctx, id, sid);
  }
}
