import { Inject, Injectable } from '@nestjs/common';
import type { ProviderRuntime } from '@revenue-os/providers/runtime';
import type { RuleAction, RuleConditions, SignalFeedbackKey, WatchlistKind } from '@revenue-os/shared';
import {
  actOnSignal,
  addWatchlistMembers,
  archiveWatchlist,
  createSignalRule,
  createWatchlist,
  deleteSignalRule,
  dismissSignal,
  listSignalRules,
  reanalyzeSignal,
  removeWatchlistMembers,
  requestCompanyCheck,
  signalDetail,
  updateSignalRule,
  updateWatchlist,
  watchlistDetail,
  type SignalActionKey,
  type SignalDeps,
} from '@revenue-os/signals';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { PROVIDER_RUNTIME } from '../integrations/provider-runtime.js';

/**
 * Signal commands (Phase 16). Everything goes through @revenue-os/signals: acting on a signal queues research, attaches
 * it to a deal or marks a cold, actionable prospect as a campaign candidate — nothing here sends or creates an
 * external action. Each command returns the fresh read model.
 */
@Injectable()
export class SignalsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private deps(): SignalDeps {
    return { db: this.db, providers: this.runtime.gateway };
  }

  async act(ctx: ServiceContext, id: string, input: { action: SignalActionKey; note?: string | null }) {
    await actOnSignal(this.db, ctx, id, input);
    return signalDetail(this.db, ctx.workspaceId, id);
  }

  async dismiss(ctx: ServiceContext, id: string, input: { feedback: SignalFeedbackKey; note?: string | null }) {
    await dismissSignal(this.db, ctx, id, input);
    return signalDetail(this.db, ctx.workspaceId, id);
  }

  async analyze(ctx: ServiceContext, id: string) {
    const r = await reanalyzeSignal(this.deps(), ctx, id);
    return { outcome: r.outcome, aiStatus: r.aiStatus ?? null, reason: r.reason ?? null, signal: await signalDetail(this.db, ctx.workspaceId, id) };
  }

  check(ctx: ServiceContext, companyId: string) {
    return requestCompanyCheck(this.db, ctx, companyId);
  }

  async createWatchlist(ctx: ServiceContext, input: { name: string; description?: string | null; kind: WatchlistKind; priority: 'HIGH' | 'NORMAL' | 'LOW'; marketId?: string | null }) {
    const w = await createWatchlist(this.db, ctx, input);
    return watchlistDetail(this.db, ctx.workspaceId, w.id);
  }

  async updateWatchlist(ctx: ServiceContext, id: string, input: { name?: string; description?: string | null; priority?: 'HIGH' | 'NORMAL' | 'LOW' }) {
    await updateWatchlist(this.db, ctx, id, input);
    return watchlistDetail(this.db, ctx.workspaceId, id);
  }

  async archiveWatchlist(ctx: ServiceContext, id: string) {
    const w = await archiveWatchlist(this.db, ctx, id);
    return { id: w.id, archivedAt: w.archivedAt?.toISOString() ?? null };
  }

  async addMembers(ctx: ServiceContext, id: string, input: { companyIds: string[]; reason?: string | null }) {
    const r = await addWatchlistMembers(this.db, ctx, id, input);
    return { ...r, watchlist: await watchlistDetail(this.db, ctx.workspaceId, id) };
  }

  async removeMembers(ctx: ServiceContext, id: string, input: { companyIds: string[] }) {
    const r = await removeWatchlistMembers(this.db, ctx, id, input);
    return { ...r, watchlist: await watchlistDetail(this.db, ctx.workspaceId, id) };
  }

  private async ruleRow(workspaceId: string, id: string) {
    return (await listSignalRules(this.db, workspaceId)).find((r) => r.id === id)!;
  }

  async createRule(ctx: ServiceContext, input: { name: string; enabled?: boolean; conditions: RuleConditions; actions: RuleAction[] }) {
    const r = await createSignalRule(this.db, ctx, input);
    return this.ruleRow(ctx.workspaceId, r.id);
  }

  async updateRule(ctx: ServiceContext, id: string, input: { name?: string; enabled?: boolean; conditions?: RuleConditions; actions?: RuleAction[]; position?: number }) {
    await updateSignalRule(this.db, ctx, id, input);
    return this.ruleRow(ctx.workspaceId, id);
  }

  deleteRule(ctx: ServiceContext, id: string) {
    return deleteSignalRule(this.db, ctx, id);
  }
}
