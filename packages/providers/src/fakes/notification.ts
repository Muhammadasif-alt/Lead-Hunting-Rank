import { randomUUID } from 'node:crypto';
import type { CallOptions, CapabilityCheck, NotificationInput, NotificationProvider } from '../core/interfaces.js';
import { FailureQueue, type FakeFailure } from './failures.js';

/** Records notifications instead of delivering them. Same idempotency key → same notification, like a real channel. */
export class FakeNotificationProvider implements NotificationProvider {
  readonly key = 'fake_notifications';
  private readonly failures = new FailureQueue();
  readonly sent = new Map<string, NotificationInput & { notificationId: string }>();

  failNext(...failures: FakeFailure[]): this {
    this.failures.push(...failures);
    return this;
  }

  async healthCheck(): Promise<CapabilityCheck[]> {
    return [{ capability: 'NOTIFY', ok: true, detail: 'Notifications recorded (test)' }];
  }

  async notify(input: NotificationInput, { signal }: CallOptions) {
    const after = await this.failures.before(signal);
    const existing = this.sent.get(input.idempotencyKey);
    const notificationId = existing?.notificationId ?? `fake-ntf-${randomUUID()}`;
    if (!existing) this.sent.set(input.idempotencyKey, { ...input, notificationId });
    if (after === 'lost-response') FailureQueue.lost();
    return { notificationId };
  }
}
