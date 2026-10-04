import type { PrismaClient } from '@revenue-os/database';
import { describeError } from '@revenue-os/shared';
import type { Logger } from '@revenue-os/shared/server';
import { dispatchOutboxBatch, type Publisher } from '../dispatcher.js';

export interface OutboxLoop {
  stop(): Promise<void>;
}

/**
 * Polls the outbox: drains full batches back-to-back, then idles for `idleMs`. Safe to run in several worker
 * processes at once (rows are claimed with SKIP LOCKED). stop() waits for the batch in flight.
 */
export function startOutboxLoop(db: PrismaClient, publish: Publisher, logger: Logger, options: { idleMs?: number; batchSize?: number } = {}): OutboxLoop {
  const idleMs = options.idleMs ?? 500;
  const batchSize = options.batchSize ?? 50;
  let stopped = false;
  let lastError = '';
  let wake: (() => void) | undefined;

  const done = (async () => {
    while (!stopped) {
      let busy = false;
      try {
        const r = await dispatchOutboxBatch(db, publish, { batchSize });
        busy = r.claimed === batchSize;
        if (r.retrying || r.dead) logger.warn(r, 'outbox publish failures');
        else if (r.published) logger.debug(r, 'outbox dispatched');
        lastError = '';
      } catch (err) {
        const message = describeError(err);
        if (message !== lastError) logger.error({ error: message }, 'outbox dispatcher error');
        lastError = message;
      }
      if (!busy && !stopped) await new Promise<void>((resolve) => ((wake = resolve), setTimeout(resolve, idleMs)));
    }
  })();

  return {
    async stop() {
      stopped = true;
      wake?.();
      await done;
    },
  };
}
