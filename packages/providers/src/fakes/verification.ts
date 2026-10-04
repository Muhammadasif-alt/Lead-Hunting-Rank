import { ProviderCallError } from '../core/errors.js';
import type { CallOptions, CapabilityCheck, VerificationProvider, VerificationResult, VerificationStatus } from '../core/interfaces.js';
import { FailureQueue, type FakeFailure } from './failures.js';

/**
 * Rule-based verifier with predictable answers, so every canonical status can be produced on purpose:
 * - `*@*.invalid`, no MX-like domain → INVALID
 * - `info@ / sales@ / admin@ …` role addresses → RISKY
 * - domains containing "catchall" → CATCH_ALL
 * - domains containing "unknown" or ending `.test` → UNKNOWN
 * - everything else → VALID
 * The vendor's own status word stays in `rawStatus` (docs/12 §46).
 */
export class FakeVerificationProvider implements VerificationProvider {
  readonly key = 'fake_verification';
  private readonly failures = new FailureQueue();

  failNext(...failures: FakeFailure[]): this {
    this.failures.push(...failures);
    return this;
  }

  async healthCheck(): Promise<CapabilityCheck[]> {
    return [{ capability: 'EMAIL_VERIFY', ok: true, detail: 'Verifier reachable (test)' }];
  }

  async verifyEmail(email: string, { signal }: CallOptions): Promise<VerificationResult> {
    await this.failures.before(signal);
    const match = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(email.trim().toLowerCase());
    if (!match) throw new ProviderCallError('INVALID_REQUEST', 'Fake verifier: not an email address');
    const [, local, domain] = match as unknown as [string, string, string];
    const [status, rawStatus]: [VerificationStatus, string] = domain.endsWith('.invalid')
      ? ['INVALID', 'undeliverable']
      : domain.includes('catchall')
        ? ['CATCH_ALL', 'accept_all']
        : domain.includes('unknown') || domain.endsWith('.test')
          ? ['UNKNOWN', 'timeout']
          : ['info', 'sales', 'admin', 'contact', 'hello', 'support'].includes(local)
            ? ['RISKY', 'role_based']
            : ['VALID', 'deliverable'];
    return { email: email.trim(), status, rawStatus, checkedAt: new Date().toISOString(), units: 1 };
  }
}
