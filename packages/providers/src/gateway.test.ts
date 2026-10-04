import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NotFoundError, ProviderError, RateLimitedError, ValidationError, classifyFailure } from '@revenue-os/shared';
import type { Capability } from './core/capabilities.js';
import { ProviderCallError, ProviderOutcomeUnknownError } from './core/errors.js';
import { FakeEmailProvider } from './fakes/email.js';
import { FakeLeadProvider } from './fakes/leads.js';
import { ProviderGateway, type CallRecord, type HealthObservation, type ProviderBinding } from './gateway/gateway.js';
import { MemoryProviderStateStore } from './gateway/state-store.js';

const WS = '00000000-0000-4000-8000-000000000001';
const send = { from: 'me@agency.example', to: ['owner@lawns.example'], subject: 'Hi', text: 'Hello', idempotencyKey: 'k1' };

function setup(bindings: ProviderBinding[], opts: { clock?: { t: number }; threshold?: number } = {}) {
  const calls: CallRecord[] = [];
  const health: HealthObservation[] = [];
  const clock = opts.clock;
  const store = new MemoryProviderStateStore(clock ? () => clock.t : Date.now);
  const gateway = new ProviderGateway({
    resolve: async ({ integrationId }) => (integrationId ? bindings.filter((b) => b.integrationId === integrationId) : bindings),
    store,
    usage: { record: async (c) => void calls.push(c) },
    health: { observe: async (h) => void health.push(h) },
    circuit: { threshold: opts.threshold ?? 3, cooldownMs: 1000 },
  });
  return { gateway, calls, health, store };
}

const bind = (integrationId: string, adapter: FakeEmailProvider | FakeLeadProvider, capabilities: Capability[] = ['EMAIL_SEND', 'EMAIL_READ'], extra: Partial<ProviderBinding> = {}): ProviderBinding => ({
  integrationId,
  provider: adapter.key,
  capabilities,
  adapter,
  ...extra,
});

describe('ProviderGateway', () => {
  test('routes to the adapter, records usage and healthy state', async () => {
    const email = new FakeEmailProvider();
    const { gateway, calls, health } = setup([bind('i1', email)]);
    const { value, provider, integrationId } = await gateway.call({ workspaceId: WS, capability: 'EMAIL_SEND', operation: 'send_message' }, (p, o) => p.sendMessage(send, o));
    assert.match(value.messageId, /^fake-msg-/);
    assert.equal(provider, 'fake_email');
    assert.equal(integrationId, 'i1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.status, 'SUCCEEDED');
    assert.equal(calls[0]!.units, 1);
    assert.equal(health.at(-1)!.state, 'HEALTHY');
  });

  test('no integration for a capability → AUTH-class error (the action waits for a connection)', async () => {
    const { gateway } = setup([]);
    await assert.rejects(
      gateway.call({ workspaceId: WS, capability: 'EMAIL_SEND', operation: 'send_message' }, (p, o) => p.sendMessage(send, o)),
      (err) => err instanceof ProviderError && err.code === 'PROVIDER_AUTH_REQUIRED' && classifyFailure(err).category === 'AUTH',
    );
  });

  test('maps normalized errors onto the shared taxonomy', async () => {
    const email = new FakeEmailProvider();
    const { gateway, health } = setup([bind('i1', email)]);
    const run = () => gateway.call({ workspaceId: WS, capability: 'EMAIL_SEND', operation: 'send_message' }, (p, o) => p.sendMessage(send, o));

    email.failNext('rate-limit');
    await assert.rejects(run(), (err) => err instanceof RateLimitedError && err.retryAfterMs === 50);
    assert.equal(health.at(-1)!.state, 'RATE_LIMITED');

    email.failNext('auth');
    await assert.rejects(run(), (err) => err instanceof ProviderError && err.code === 'PROVIDER_AUTH_REQUIRED');
    assert.equal(health.at(-1)!.state, 'AUTH_REQUIRED');

    email.failNext('unavailable');
    await assert.rejects(run(), (err) => err instanceof ProviderError && err.code === 'PROVIDER_UNAVAILABLE');

    await assert.rejects(
      gateway.call({ workspaceId: WS, capability: 'EMAIL_SEND', operation: 'send_message' }, (p, o) => p.sendMessage({ ...send, to: ['nope'] }, o)),
      ValidationError,
    );
    assert.equal(email.sends, 0);
  });

  test('a lost response on a side effect is an unknown outcome — never a plain retry, never a fallback', async () => {
    const primary = new FakeEmailProvider().failNext('lost-response');
    const backup = new FakeEmailProvider();
    const { gateway } = setup([bind('i1', primary), bind('i2', backup)]);
    await assert.rejects(
      gateway.call({ workspaceId: WS, capability: 'EMAIL_SEND', operation: 'send_message', strategy: 'FALLBACK' }, (p, o) => p.sendMessage(send, o)),
      (err) => err instanceof ProviderOutcomeUnknownError && (err as { providerErrorKind?: string }).providerErrorKind === 'UNKNOWN_OUTCOME',
    );
    assert.equal(primary.sends, 1, 'the provider did act');
    assert.equal(backup.sends, 0, 'no second send through another provider');
    assert.ok(await primary.findSentByIdempotencyKey('k1', { signal: AbortSignal.timeout(1000) }), 'reconcilable by idempotency key');
  });

  test('FALLBACK moves on when a provider definitely did not act; PRIMARY does not', async () => {
    const primary = new FakeEmailProvider();
    const backup = new FakeEmailProvider();
    const { gateway } = setup([bind('i1', primary), bind('i2', backup)]);
    primary.failNext('unavailable');
    const r = await gateway.call({ workspaceId: WS, capability: 'EMAIL_SEND', operation: 'send_message', strategy: 'FALLBACK' }, (p, o) => p.sendMessage(send, o));
    assert.equal(r.integrationId, 'i2');

    primary.failNext('unavailable');
    await assert.rejects(gateway.call({ workspaceId: WS, capability: 'EMAIL_SEND', operation: 'send_message' }, (p, o) => p.sendMessage(send, o)), ProviderError);
    assert.equal(backup.sends, 1);
  });

  test('does not fall back on a semantic "no" (invalid request / not found)', async () => {
    const a = new FakeLeadProvider();
    const b = new FakeLeadProvider();
    const { gateway, calls } = setup([bind('a', a, ['COMPANY_SEARCH']), bind('b', b, ['COMPANY_SEARCH'])]);
    await assert.rejects(
      gateway.call({ workspaceId: WS, capability: 'COMPANY_SEARCH', operation: 'search', strategy: 'FALLBACK' }, (p, o) =>
        p.searchCompanies({ location: { country: 'ZZ' }, industry: 'roofing' }, o),
      ),
      ValidationError,
    );
    assert.equal(calls.length, 1);
    await assert.rejects(
      gateway.call({ workspaceId: WS, capability: 'COMPANY_SEARCH', operation: 'lookup' }, async () => {
        throw new ProviderCallError('NOT_FOUND', 'no such record');
      }),
      NotFoundError,
    );
  });

  test('circuit opens after repeated failures, rejects without calling, then one probe recovers it', async () => {
    const clock = { t: 1_000_000 };
    const email = new FakeEmailProvider();
    const { gateway, calls, health } = setup([bind('i1', email)], { clock, threshold: 3 });
    const run = () => gateway.call({ workspaceId: WS, capability: 'EMAIL_READ', operation: 'list' }, (p, o) => p.listChanges(null, o));

    email.failNext('unavailable', 'unavailable', 'unavailable');
    for (let i = 0; i < 3; i++) await assert.rejects(run(), ProviderError);
    assert.equal(health.at(-1)!.state, 'UNAVAILABLE');
    assert.equal(calls.length, 3);

    await assert.rejects(run(), /Circuit open/);
    assert.equal(calls.length, 3, 'open circuit: the provider is not called');

    clock.t += 1001; // cooldown over → HALF_OPEN, one probe allowed
    await run();
    assert.equal(calls.length, 4);
    assert.equal(health.at(-1)!.state, 'HEALTHY');
    await run();
  });

  test('our own per-integration rate limit refuses with Retry-After before calling the provider', async () => {
    const clock = { t: 5_000_000 };
    const email = new FakeEmailProvider();
    const { gateway, calls } = setup([bind('i1', email, undefined, { rateLimit: { limit: 2, windowMs: 60_000 } })], { clock });
    const run = (k: string) => gateway.call({ workspaceId: WS, capability: 'EMAIL_SEND', operation: 'send_message' }, (p, o) => p.sendMessage({ ...send, idempotencyKey: k }, o));
    await run('a');
    await run('b');
    await assert.rejects(run('c'), (err) => err instanceof RateLimitedError && (err.retryAfterMs ?? 0) > 0);
    assert.equal(calls.length, 2);
    assert.equal(email.sends, 2);
  });

  test('timeouts: unknown outcome for side effects, transient for reads', async () => {
    const email = new FakeEmailProvider();
    const { gateway } = setup([bind('i1', email)]);
    email.failNext('hang');
    await assert.rejects(
      gateway.call({ workspaceId: WS, capability: 'EMAIL_SEND', operation: 'send_message', timeoutMs: 30 }, (p, o) => p.sendMessage(send, o)),
      (err) => err instanceof ProviderOutcomeUnknownError && /timed out/.test(err.message),
    );
    email.failNext('hang');
    await assert.rejects(
      gateway.call({ workspaceId: WS, capability: 'EMAIL_READ', operation: 'list', timeoutMs: 30 }, (p, o) => p.listChanges(null, o)),
      (err) => (err as { providerErrorKind?: string }).providerErrorKind === 'TRANSIENT',
    );
  });

  test('a usage sink failure never fails the business call', async () => {
    const email = new FakeEmailProvider();
    const gateway = new ProviderGateway({
      resolve: async () => [bind('i1', email)],
      store: new MemoryProviderStateStore(),
      usage: { record: async () => Promise.reject(new Error('db down')) },
    });
    const r = await gateway.call({ workspaceId: WS, capability: 'EMAIL_SEND', operation: 'send_message' }, (p, o) => p.sendMessage(send, o));
    assert.ok(r.value.messageId);
  });

  test('checkHealth reports every capability without side effects', async () => {
    const email = new FakeEmailProvider();
    const { gateway, health } = setup([]);
    const checks = await gateway.checkHealth(WS, bind('i1', email));
    assert.deepEqual(checks.map((c) => [c.capability, c.state]), [['EMAIL_SEND', 'HEALTHY'], ['EMAIL_READ', 'HEALTHY']]);
    assert.equal(email.sends, 0);
    assert.equal(health.length, 2);
  });
});
