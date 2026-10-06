import type { ActionExecutor, ExternalActionView, ReconcileResult } from '@revenue-os/events';
import { ValidationError } from '@revenue-os/shared';
import { z } from 'zod';
import type { ProviderGateway } from '../gateway/gateway.js';

/** ExternalAction type for one outbound email. Campaigns (Phase 11) and replies (Phase 12) request these through the Policy Engine. */
export const EMAIL_SEND_ACTION = 'email.send';

/** The frozen payload of an email.send action. */
export const EmailSendPayload = z.strictObject({
  from: z.email(),
  to: z.array(z.email()).min(1).max(50),
  subject: z.string().min(1).max(998),
  text: z.string().min(1).max(100_000),
  html: z.string().max(500_000).optional(),
  threadRef: z.string().max(500).optional(),
});
export type EmailSendPayload = z.output<typeof EmailSendPayload>;

/**
 * Bridges the ExternalAction state machine (Phase 4) to the EMAIL_SEND capability through the gateway. The action's
 * `providerAccountId` pins the integration (mailbox) it was prepared for — a retry never silently switches mailbox,
 * and never falls back to another provider (that could send twice). A lost response is reconciled by looking the
 * idempotency key up at the same mailbox.
 */
export function createEmailSendExecutor(gateway: ProviderGateway): ActionExecutor {
  const request = (action: ExternalActionView, operation: string, capability: 'EMAIL_SEND' | 'EMAIL_READ') => ({
    workspaceId: action.workspaceId,
    capability,
    operation,
    integrationId: action.providerAccountId ?? undefined,
    entity: { type: action.entityType, id: action.entityId },
  });

  return {
    async execute(action) {
      const parsed = EmailSendPayload.safeParse(action.payload);
      if (!parsed.success) throw new ValidationError(`Invalid email.send payload: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      const { value } = await gateway.call(request(action, 'send_message', 'EMAIL_SEND'), (email, options) =>
        email.sendMessage({ ...parsed.data, idempotencyKey: action.idempotencyKey }, options),
      );
      return { providerRef: value.messageId };
    },

    async reconcile(action): Promise<ReconcileResult> {
      try {
        const { value } = await gateway.call(request(action, 'find_sent', 'EMAIL_READ'), (email, options) => email.findSentByIdempotencyKey(action.idempotencyKey, options));
        return value ? { status: 'SUCCEEDED', providerRef: value.messageId } : { status: 'NOT_FOUND' };
      } catch {
        return { status: 'UNDETERMINED' }; // can't ask the provider right now — a human or the next sweep decides
      }
    },
  };
}
