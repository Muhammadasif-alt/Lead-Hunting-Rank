import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ProviderCallError } from '../core/errors.js';
import { messageIdFor } from '../email/gmail.js';
import type { CallOptions, CapabilityCheck, EmailChanges, EmailMessage, EmailProvider, SendEmailInput, SendEmailResult } from '../core/interfaces.js';
import { FailureQueue, type FakeFailure } from './failures.js';

/** Where the fake mailbox keeps messages: memory for tests, Redis for the dev worker so it survives restarts. */
export interface FakeMailboxStore {
  append(message: EmailMessage, idempotencyKey: string | null): Promise<number>;
  bySequence(after: number, limit: number): Promise<{ messages: EmailMessage[]; last: number }>;
  byId(messageId: string): Promise<EmailMessage | null>;
  byIdempotencyKey(key: string): Promise<EmailMessage | null>;
}

export class MemoryMailboxStore implements FakeMailboxStore {
  readonly messages: EmailMessage[] = [];
  private readonly keys = new Map<string, string>();

  async append(message: EmailMessage, idempotencyKey: string | null) {
    this.messages.push(message);
    if (idempotencyKey) this.keys.set(idempotencyKey, message.messageId);
    return this.messages.length;
  }
  async bySequence(after: number, limit: number) {
    const messages = this.messages.slice(after, after + limit);
    return { messages, last: after + messages.length };
  }
  async byId(messageId: string) {
    return this.messages.find((m) => m.messageId === messageId) ?? null;
  }
  async byIdempotencyKey(key: string) {
    const id = this.keys.get(key);
    return id ? this.byId(id) : null;
  }
}

export class RedisMailboxStore implements FakeMailboxStore {
  constructor(
    private readonly redis: Redis,
    /** e.g. `${queuePrefix}:fake-email:${integrationId}` */
    private readonly prefix: string,
  ) {}

  async append(message: EmailMessage, idempotencyKey: string | null) {
    const json = JSON.stringify(message);
    const multi = this.redis.multi().rpush(`${this.prefix}:log`, message.messageId).hset(`${this.prefix}:messages`, message.messageId, json);
    if (idempotencyKey) multi.hset(`${this.prefix}:keys`, idempotencyKey, message.messageId);
    const [[, length]] = (await multi.exec()) as [[null, number], ...unknown[]];
    return length;
  }
  async bySequence(after: number, limit: number) {
    const ids = await this.redis.lrange(`${this.prefix}:log`, after, after + limit - 1);
    const raw = ids.length ? await this.redis.hmget(`${this.prefix}:messages`, ...ids) : [];
    const messages = raw.filter((r): r is string => r !== null).map((r) => JSON.parse(r) as EmailMessage);
    return { messages, last: after + ids.length };
  }
  async byId(messageId: string) {
    const raw = await this.redis.hget(`${this.prefix}:messages`, messageId);
    return raw ? (JSON.parse(raw) as EmailMessage) : null;
  }
  async byIdempotencyKey(key: string) {
    const id = await this.redis.hget(`${this.prefix}:keys`, key);
    return id ? this.byId(id) : null;
  }
}

/**
 * A mailbox that stores instead of delivering. Like a real provider it does NOT deduplicate sends by itself — our
 * ExternalAction idempotency must guarantee one message. It does support looking a send up by idempotency key, which
 * is how a lost response is reconciled.
 */
export class FakeEmailProvider implements EmailProvider {
  readonly key = 'fake_email';
  private readonly failures = new FailureQueue();
  /** Messages actually "sent" by this instance — tests assert exactly-once on it. */
  sends = 0;

  constructor(readonly store: FakeMailboxStore = new MemoryMailboxStore()) {}

  failNext(...failures: FakeFailure[]): this {
    this.failures.push(...failures);
    return this;
  }

  async healthCheck(): Promise<CapabilityCheck[]> {
    return [
      { capability: 'EMAIL_SEND', ok: true, detail: 'Send capability granted (test mailbox)' },
      { capability: 'EMAIL_READ', ok: true, detail: 'Read capability granted (test mailbox)' },
    ];
  }

  async sendMessage(input: SendEmailInput, { signal }: CallOptions) {
    const after = await this.failures.before(signal);
    if (input.to.length === 0 || input.to.some((to) => !to.includes('@'))) {
      throw new ProviderCallError('INVALID_REQUEST', 'Fake provider: invalid recipient address');
    }
    const message: EmailMessage = {
      messageId: `fake-msg-${randomUUID()}`,
      threadId: input.threadRef ?? `fake-thread-${randomUUID()}`,
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      direction: 'OUTBOUND',
      occurredAt: new Date().toISOString(),
      internetMessageId: messageIdFor(input.idempotencyKey, input.from),
    };
    await this.store.append(message, input.idempotencyKey);
    this.sends++;
    if (after === 'lost-response') FailureQueue.lost();
    return { messageId: message.messageId, threadId: message.threadId, sentAt: message.occurredAt, internetMessageId: message.internetMessageId, units: 1 };
  }

  /** Test mailbox only: an email arrives (a reply, an auto-reply, a bounce) — mailbox sync will see it. */
  async receive(input: { from: string; to: string[]; subject: string; text: string; threadId?: string }): Promise<EmailMessage> {
    const message: EmailMessage = {
      messageId: `fake-msg-${randomUUID()}`,
      threadId: input.threadId ?? `fake-thread-${randomUUID()}`,
      from: input.from.toLowerCase(),
      to: input.to,
      subject: input.subject,
      text: input.text,
      direction: 'INBOUND',
      occurredAt: new Date().toISOString(),
    };
    await this.store.append(message, null);
    return message;
  }

  async findSentByIdempotencyKey(idempotencyKey: string, _options?: CallOptions): Promise<SendEmailResult | null> {
    const m = await this.store.byIdempotencyKey(idempotencyKey);
    return m ? { messageId: m.messageId, threadId: m.threadId, sentAt: m.occurredAt } : null;
  }

  async getMessage(messageId: string, _options?: CallOptions) {
    return this.store.byId(messageId);
  }

  async getThread(threadId: string, _options?: CallOptions) {
    const { messages } = await this.store.bySequence(0, 10_000);
    return messages.filter((m) => m.threadId === threadId);
  }

  async listChanges(cursor: string | null, { signal }: CallOptions): Promise<EmailChanges> {
    await this.failures.before(signal);
    const after = cursor ? Number(cursor) : 0;
    if (!Number.isInteger(after) || after < 0) throw new ProviderCallError('INVALID_REQUEST', 'Fake provider: bad cursor');
    const { messages, last } = await this.store.bySequence(after, 100);
    return { messages, cursor: String(last) };
  }
}
