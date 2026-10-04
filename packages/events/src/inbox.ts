import type { PrismaClient } from '@revenue-os/database';
import type { Tx } from './writer.js';

/**
 * Consumer idempotency (docs/11 §15-17, "InboxReceipt"). Runs `effect` and records (consumer, eventId) in one
 * transaction. A redelivered event finds the receipt and is acknowledged without running again. Two concurrent
 * deliveries serialize on the receipt's primary key: the second waits, then sees the first one's commit.
 *
 * Use it for internal effects (DB writes). External side effects use ExternalAction instead.
 */
export async function processOnce<T>(
  db: PrismaClient,
  consumer: string,
  eventId: string,
  effect: (tx: Tx) => Promise<T>,
): Promise<{ processed: true; result: T } | { processed: false }> {
  return db.$transaction(async (tx) => {
    const inserted = await tx.$executeRaw`
      INSERT INTO "InboxReceipt" (consumer, "eventId") VALUES (${consumer}, ${eventId})
      ON CONFLICT DO NOTHING`;
    if (inserted === 0) return { processed: false as const };
    return { processed: true as const, result: await effect(tx) };
  });
}
