import { Inject, Injectable } from '@nestjs/common';
import type { MemoryScope } from '@revenue-os/database';
import {
  addMemoryNote,
  answerGap,
  approveKnowledge,
  archiveKnowledge,
  buildBrainContext,
  closeCommitment,
  completeCommitment,
  correctMemory,
  createCommitment,
  createKnowledge,
  dismissGap,
  invalidateMemory,
  markReviewed,
  recordKnowledgeFeedback,
  rejectKnowledge,
  resolveAnsweredGaps,
  resolveKnowledgeConflict,
  resolveMemoryConflict,
  restoreVersion,
  reviewMemoryCandidate,
  saveDraft,
  setKnowledgeControls,
  setKnowledgeDisabled,
  setRelationshipStatus,
  simulateAnswer,
  submitForReview,
  uploadDocument,
  verifyMemory,
  type BrainDeps,
  type KnowledgeInput,
} from '@revenue-os/knowledge';
import type { ProviderRuntime } from '@revenue-os/providers/runtime';
import { NotFoundError, type KnowledgeContent, type KnowledgeControls } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { PROVIDER_RUNTIME } from '../integrations/provider-runtime.js';

const short = (r: { item: { id: string; code: string; status: string }; revision: { id: string; version: number; status: string }; errors?: string[] }) => ({ itemId: r.item.id, code: r.item.code, status: r.item.status, revisionId: r.revision.id, version: r.revision.version, revisionStatus: r.revision.status, errors: r.errors ?? [] });

/**
 * Memory + Knowledge commands (Phase 15). Everything goes through @revenue-os/knowledge: drafts are never AI
 * authority, approval is a person's (pricing/policies/claims need commercial authority), documents are sources.
 */
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}

  private deps(): BrainDeps {
    return { db: this.prisma.client, providers: this.runtime.gateway };
  }

  /** After knowledge goes live: gaps it now answers are resolved (best effort — the embed job retries it). */
  private afterPublish(workspaceId: string) {
    void resolveAnsweredGaps(this.deps(), workspaceId).catch(() => 0);
  }

  async create(ctx: ServiceContext, input: KnowledgeInput) {
    return short(await createKnowledge(this.prisma.client, ctx, input));
  }

  async saveDraft(ctx: ServiceContext, id: string, input: Partial<KnowledgeInput> & { content: KnowledgeContent }) {
    return short(await saveDraft(this.prisma.client, ctx, id, input));
  }

  async submit(ctx: ServiceContext, id: string) {
    const r = await submitForReview(this.prisma.client, ctx, id);
    return { revisionId: r.id, version: r.version, status: r.status };
  }

  async approve(ctx: ServiceContext, id: string, canApproveCommercial: boolean) {
    const r = await approveKnowledge(this.prisma.client, ctx, id, { canApproveCommercial });
    if (!r.scheduled) this.afterPublish(ctx.workspaceId);
    return { itemId: r.item.id, status: r.item.status, version: r.revision.version, scheduled: r.scheduled, effectiveFrom: r.revision.effectiveFrom, conflicts: r.conflicts };
  }

  async reject(ctx: ServiceContext, id: string, reason: string) {
    const r = await rejectKnowledge(this.prisma.client, ctx, id, reason);
    return { revisionId: r.id, version: r.version, status: r.status };
  }

  async restore(ctx: ServiceContext, id: string, version: number, canApproveCommercial: boolean) {
    const r = await restoreVersion(this.prisma.client, ctx, id, version, { canApproveCommercial });
    this.afterPublish(ctx.workspaceId);
    return { itemId: r.item.id, version: r.revision.version, conflicts: r.conflicts };
  }

  async reviewed(ctx: ServiceContext, id: string, canApproveCommercial: boolean) {
    const i = await markReviewed(this.prisma.client, ctx, id, { canApproveCommercial });
    return { itemId: i.id, status: i.status, nextReviewAt: i.nextReviewAt };
  }

  async disable(ctx: ServiceContext, id: string, disabled: boolean, reason?: string) {
    const i = await setKnowledgeDisabled(this.prisma.client, ctx, id, disabled, reason);
    return { itemId: i.id, aiDisabled: i.aiDisabled };
  }

  async archive(ctx: ServiceContext, id: string, reason: string) {
    const i = await archiveKnowledge(this.prisma.client, ctx, id, reason);
    return { itemId: i.id, status: i.status };
  }

  feedback(ctx: ServiceContext, id: string, input: { kind: string; note?: string | null }) {
    return recordKnowledgeFeedback(this.prisma.client, ctx, id, input);
  }

  controls(ctx: ServiceContext, input: Partial<KnowledgeControls>) {
    return setKnowledgeControls(this.prisma.client, ctx, input);
  }

  async resolveConflict(ctx: ServiceContext, id: string, input: { resolution: 'RESOLVED' | 'DISMISSED'; note?: string | null }) {
    const c = await resolveKnowledgeConflict(this.prisma.client, ctx, id, input);
    return { id: c.id, status: c.status };
  }

  async answerGap(ctx: ServiceContext, id: string, input: { answer: string; question?: string; category?: string; submit?: boolean }) {
    return short(await answerGap(this.prisma.client, ctx, id, input));
  }

  async dismissGap(ctx: ServiceContext, id: string, reason: string) {
    await dismissGap(this.prisma.client, ctx, id, reason);
    return { ok: true };
  }

  async upload(ctx: ServiceContext, input: { fileName: string; contentType: string; data: Buffer }) {
    const r = await uploadDocument(this.deps(), ctx, input);
    return { id: r.source.id, fileName: r.source.fileName, status: r.source.status, duplicate: r.duplicate };
  }

  simulate(ctx: ServiceContext, question: string) {
    return simulateAnswer(this.deps(), ctx.workspaceId, question);
  }

  // ── memory ──

  async reviewCandidate(ctx: ServiceContext, id: string, input: { action: 'ACCEPT' | 'REJECT'; value?: string | null }) {
    const r = await reviewMemoryCandidate(this.prisma.client, ctx, id, input);
    return { candidateId: r.candidate.id, status: r.candidate.status, memoryId: r.memory?.id ?? null };
  }

  async correct(ctx: ServiceContext, id: string, input: { value: string; reason?: string | null }) {
    const m = await correctMemory(this.prisma.client, ctx, id, input);
    return { memoryId: m.id };
  }

  async invalidate(ctx: ServiceContext, id: string, reason: string) {
    const m = await invalidateMemory(this.prisma.client, ctx, id, reason);
    return { memoryId: m.id, status: m.status };
  }

  async verify(ctx: ServiceContext, id: string) {
    const m = await verifyMemory(this.prisma.client, ctx, id);
    return { memoryId: m.id, status: m.status };
  }

  async note(ctx: ServiceContext, input: { companyId: string; entityType: MemoryScope; entityId?: string | null; text: string; key?: string | null }) {
    const m = await addMemoryNote(this.prisma.client, ctx, { ...input, entityId: input.entityId ?? input.companyId });
    return { memoryId: m.id };
  }

  async resolveMemoryConflict(ctx: ServiceContext, id: string, input: { keep: 'A' | 'B' | 'BOTH'; note?: string | null }) {
    const c = await resolveMemoryConflict(this.prisma.client, ctx, id, input);
    return { id: c.id, resolution: c.resolution };
  }

  async createCommitment(ctx: ServiceContext, input: Parameters<typeof createCommitment>[2]) {
    const c = await createCommitment(this.prisma.client, ctx, input);
    return { id: c.id, status: c.status };
  }

  async completeCommitment(ctx: ServiceContext, id: string, evidence: string) {
    const c = await completeCommitment(this.prisma.client, ctx, id, evidence);
    return { id: c.id, status: c.status };
  }

  async commitmentStatus(ctx: ServiceContext, id: string, input: { status: 'CANCELLED' | 'BROKEN' | 'WAITING' | 'OPEN'; reason?: string | null; dueAt?: Date | null }) {
    const c = await closeCommitment(this.prisma.client, ctx, id, input);
    return { id: c.id, status: c.status };
  }

  async relationshipStatus(ctx: ServiceContext, id: string, status: 'ACTIVE' | 'ENDED' | 'INVALIDATED') {
    const r = await setRelationshipStatus(this.prisma.client, ctx, id, status);
    return { id: r.id, status: r.status };
  }

  /**
   * "View AI context" (screen #12 §63): exactly what the Conversation Agent would get for the latest message — memory,
   * promises, approved answers — and what was left out and why.
   */
  async conversationContext(ctx: ServiceContext, conversationId: string) {
    const conv = await this.prisma.client.conversation.findFirst({ where: { id: conversationId, workspaceId: ctx.workspaceId } });
    if (!conv) throw new NotFoundError('Conversation not found');
    const last = await this.prisma.client.messageClassification.findFirst({ where: { conversationId }, orderBy: { createdAt: 'desc' }, select: { questions: true, messageId: true } });
    const brain = await buildBrainContext(this.deps(), { workspaceId: ctx.workspaceId, companyId: conv.companyId, personId: conv.personId, conversationId: conv.id, opportunityId: conv.opportunityId, questions: last?.questions ?? [] });
    return { questions: last?.questions ?? [], ...brain };
  }
}
