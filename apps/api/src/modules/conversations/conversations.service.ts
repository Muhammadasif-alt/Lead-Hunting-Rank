import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@revenue-os/config';
import type { ConversationMode } from '@revenue-os/database';
import {
  addNote,
  applyInbound,
  assignConversation,
  discardReply,
  doNotContact,
  draftConversationReply,
  markConversationRead,
  rejectExtraction,
  reopenConversation,
  replyFeedback,
  resolveConversation,
  sendHumanReply,
  setConversationMode,
  snoozeConversation,
  syncMailbox,
} from '@revenue-os/outreach';
import { FakeEmailProvider } from '@revenue-os/providers';
import type { ProviderRuntime } from '@revenue-os/providers/runtime';
import { BusinessRuleError, ForbiddenError, NotFoundError, ValidationError } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_CONFIG } from '../../infra/tokens.js';
import { PROVIDER_RUNTIME } from '../integrations/provider-runtime.js';

/**
 * Conversations (Phase 12, screen #5). Commands go through @revenue-os/outreach; replies go out only as email.reply
 * external actions the Policy Engine decides on — a person's reply as that person, an AI reply as the Conversation Agent.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}

  private deps() {
    return { db: this.prisma.client, providers: this.runtime.gateway, publicUrl: this.config.APP_URL };
  }

  private async load(workspaceId: string, id: string) {
    const c = await this.prisma.client.conversation.findFirst({ where: { id, workspaceId } });
    if (!c) throw new NotFoundError('Conversation not found');
    return c;
  }

  setMode(ctx: ServiceContext, id: string, mode: ConversationMode) {
    return setConversationMode(this.prisma.client, ctx, id, mode);
  }

  async reply(ctx: ServiceContext, id: string, input: { body: string; subject?: string | null; fromReplyId?: string | null }) {
    await this.load(ctx.workspaceId, id);
    const user = ctx.actor.id ? await this.prisma.client.user.findUnique({ where: { id: ctx.actor.id }, select: { name: true } }) : null;
    const r = await sendHumanReply(this.prisma.client, ctx, id, { ...input, signature: user?.name ?? null });
    return { id: r.id, status: r.status, statusReason: r.statusReason };
  }

  /** "Suggest a reply": a fresh AI draft for the latest message, whatever the mode (in HUMAN mode it is only a suggestion). */
  async suggest(ctx: ServiceContext, id: string) {
    const c = await this.load(ctx.workspaceId, id);
    if (c.stage === 'SUPPRESSED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'They unsubscribed — nothing to reply');
    const r = await draftConversationReply(this.deps(), c.id, { requestId: randomUUID() });
    if (!r) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'There is no message from them to answer yet');
    return { id: r.id, status: r.status, statusReason: r.statusReason };
  }

  discard(ctx: ServiceContext, id: string, replyId: string) {
    return discardReply(this.prisma.client, ctx, id, replyId);
  }

  feedback(ctx: ServiceContext, id: string, replyId: string, input: { rating: 'UP' | 'DOWN'; reason?: string | null }) {
    return replyFeedback(this.prisma.client, ctx, id, replyId, input);
  }

  note(ctx: ServiceContext, id: string, text: string) {
    return addNote(this.prisma.client, ctx, id, text);
  }

  resolve(ctx: ServiceContext, id: string, reason: string | null) {
    return resolveConversation(this.prisma.client, ctx, id, reason);
  }

  reopen(ctx: ServiceContext, id: string) {
    return reopenConversation(this.prisma.client, ctx, id);
  }

  snooze(ctx: ServiceContext, id: string, until: Date) {
    return snoozeConversation(this.prisma.client, ctx, id, until);
  }

  assign(ctx: ServiceContext, id: string, userId: string | null) {
    return assignConversation(this.prisma.client, ctx, id, userId);
  }

  doNotContact(ctx: ServiceContext, id: string, note: string | null) {
    return doNotContact(this.prisma.client, ctx, id, note);
  }

  rejectFact(ctx: ServiceContext, id: string, extractionId: string) {
    return rejectExtraction(this.prisma.client, ctx, id, extractionId);
  }

  read(ctx: ServiceContext, id: string) {
    return markConversationRead(this.prisma.client, ctx, id);
  }

  /**
   * Test mailbox only (never production, never a real mailbox): the prospect "writes" a message in this thread, then
   * the mailbox is synced — exactly the path a real reply takes. The worker then reads it and drafts.
   */
  async simulateProspect(ctx: ServiceContext, id: string, text: string) {
    if (this.config.APP_ENV === 'production') throw new ForbiddenError('Not available in production');
    const c = await this.load(ctx.workspaceId, id);
    const mailbox = await this.prisma.client.integration.findFirst({ where: { id: c.mailboxIntegrationId, workspaceId: ctx.workspaceId } });
    const adapter = mailbox ? this.runtime.factory.forIntegration(mailbox) : null;
    if (!mailbox || !(adapter instanceof FakeEmailProvider)) throw new ValidationError('Simulated messages only work with the test mailbox');
    const to = [mailbox.accountRef.includes('@') ? mailbox.accountRef : 'outreach@test-mailbox.example'];
    const message = await adapter.receive({ from: c.email, to, subject: /^re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`, text: `${text.trim()}\n\nOn Mon, someone wrote:\n> earlier message`, threadId: c.threadRef ?? undefined });
    const applied = await applyInbound(this.prisma.client, mailbox, message);
    await syncMailbox(this.prisma.client, this.runtime.gateway, mailbox).catch(() => null);
    return { kind: applied?.kind ?? null, conversationId: applied?.conversationId ?? null };
  }
}
