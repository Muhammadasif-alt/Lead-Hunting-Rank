import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RateLimitedError } from '@revenue-os/shared';
import { QueueService } from '../../infra/queue.service.js';

const WINDOW_SECONDS = 15 * 60;
/** Failed attempts allowed per window before login is refused (docs/15 login protection). */
export const MAX_FAILURES_PER_ACCOUNT = 5;
export const MAX_FAILURES_PER_IP = 50;

const key = (kind: 'acct' | 'ip', value: string) =>
  `auth:fail:${kind}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;

/**
 * Counts failed logins in Redis per account and per IP. Exceeding either refuses further attempts for the window,
 * even with the right password — so guessing gains nothing. Counters reset on success (per account).
 */
@Injectable()
export class LoginThrottleService {
  constructor(private readonly queues: QueueService) {}

  async assertAllowed(email: string, ip: string): Promise<void> {
    const [acct, perIp] = await this.queues.redis.mget(key('acct', email), key('ip', ip));
    if (Number(acct ?? 0) >= MAX_FAILURES_PER_ACCOUNT || Number(perIp ?? 0) >= MAX_FAILURES_PER_IP) {
      throw new RateLimitedError('Too many sign-in attempts. Wait 15 minutes and try again.');
    }
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    const tx = this.queues.redis.multi();
    for (const k of [key('acct', email), key('ip', ip)]) tx.incr(k).expire(k, WINDOW_SECONDS, 'NX');
    await tx.exec();
  }

  async reset(email: string): Promise<void> {
    await this.queues.redis.del(key('acct', email));
  }
}
