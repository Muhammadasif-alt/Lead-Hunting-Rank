import { join } from 'node:path';
import type { Integration, PrismaClient } from '@revenue-os/database';
import type { Redis } from 'ioredis';
import { providerDefinition } from '../catalog.js';
import type { Capability } from '../core/capabilities.js';
import type { ProviderAdapter } from '../core/interfaces.js';
import { FakeCalendarProvider } from '../fakes/calendar.js';
import { FakeEmailProvider, MemoryMailboxStore, RedisMailboxStore } from '../fakes/email.js';
import { FakeLeadProvider } from '../fakes/leads.js';
import { FakeLLMProvider } from '../fakes/llm.js';
import { FakeNotificationProvider } from '../fakes/notification.js';
import { FakeVerificationProvider } from '../fakes/verification.js';
import { ProviderGateway, type BindingResolver, type ProviderBinding } from '../gateway/gateway.js';
import { MemoryProviderStateStore, RedisProviderStateStore } from '../gateway/state-store.js';
import { LocalStorageProvider } from '../storage/local.js';
import { PrismaHealthSink, PrismaUsageSink } from './sinks.js';

type IntegrationRef = Pick<Integration, 'id' | 'workspaceId' | 'provider'>;

/** Builds (and caches) the adapter instance behind an integration. Returns null when not available here. */
export interface AdapterFactory {
  forIntegration(integration: IntegrationRef): ProviderAdapter | null;
}

export interface AdapterFactoryOptions {
  appEnv: string;
  storagePath: string;
  /** With Redis, the fake mailbox survives restarts and is shared by API and worker. */
  redis?: Redis;
  prefix?: string;
}

/**
 * Which adapter serves which catalog key. Fakes exist only outside production. Real vendor adapters register here as
 * their phases land (docs/12 §1 order: LLM, Gmail, Calendar, Storage, lead data, verification).
 */
export function createAdapterFactory(options: AdapterFactoryOptions): AdapterFactory {
  const cache = new Map<string, ProviderAdapter>();
  const fakesAllowed = options.appEnv !== 'production';
  const shared = {
    fake_calendar: new FakeCalendarProvider(),
    fake_leads: new FakeLeadProvider(),
    fake_verification: new FakeVerificationProvider(),
    fake_llm: new FakeLLMProvider(),
    fake_notifications: new FakeNotificationProvider(),
  };

  const build = (integration: IntegrationRef): ProviderAdapter | null => {
    const def = providerDefinition(integration.provider);
    if (!def || def.status !== 'AVAILABLE' || (def.fake && !fakesAllowed)) return null;
    switch (integration.provider) {
      case 'fake_email':
        return new FakeEmailProvider(
          options.redis ? new RedisMailboxStore(options.redis, `${options.prefix ?? 'rhl'}:fake-email:${integration.id}`) : new MemoryMailboxStore(),
        );
      case 'local_storage':
        // One directory per workspace — a key can never reach another workspace's files.
        return new LocalStorageProvider(join(options.storagePath, integration.workspaceId));
      default:
        return shared[integration.provider as keyof typeof shared] ?? null;
    }
  };

  return {
    forIntegration(integration) {
      const key = `${integration.provider}:${integration.id}`;
      if (!cache.has(key)) {
        const adapter = build(integration);
        if (!adapter) return null;
        cache.set(key, adapter);
      }
      return cache.get(key)!;
    },
  };
}

/** Our own per-account throttles (docs/12 §87). Real vendors get theirs from their documented limits. */
const DEFAULT_RATE_LIMITS: Record<string, ProviderBinding['rateLimit']> = {
  fake_email: { limit: 60, windowMs: 60_000 },
  fake_leads: { limit: 120, windowMs: 60_000 },
};

export function toBinding(integration: Pick<Integration, 'id' | 'workspaceId' | 'provider' | 'capabilities'>, factory: AdapterFactory): ProviderBinding | null {
  const adapter = factory.forIntegration(integration);
  if (!adapter) return null;
  return {
    integrationId: integration.id,
    provider: integration.provider,
    capabilities: integration.capabilities as Capability[],
    adapter,
    rateLimit: DEFAULT_RATE_LIMITS[integration.provider],
  };
}

/** Router: the workspace's usable integrations for a capability, preferred first (docs/12 §11, §130). */
export function createIntegrationResolver(db: PrismaClient, factory: AdapterFactory): BindingResolver {
  return async ({ workspaceId, capability, integrationId }) => {
    const rows = await db.integration.findMany({
      where: {
        workspaceId,
        ...(integrationId ? { id: integrationId } : {}),
        status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] },
        capabilities: { has: capability },
      },
      orderBy: [{ priority: 'asc' }, { connectedAt: 'asc' }],
    });
    return rows.map((r) => toBinding(r, factory)).filter((b): b is ProviderBinding => b !== null);
  };
}

export interface ProviderRuntime {
  gateway: ProviderGateway;
  factory: AdapterFactory;
}

/** Wires a gateway the same way in the API and the worker: Prisma usage + health sinks, Redis-shared limits. */
export function createProviderRuntime(
  db: PrismaClient,
  options: AdapterFactoryOptions & { logger?: { warn: (obj: object, msg: string) => void } },
): ProviderRuntime {
  const factory = createAdapterFactory(options);
  const gateway = new ProviderGateway({
    resolve: createIntegrationResolver(db, factory),
    store: options.redis ? new RedisProviderStateStore(options.redis, options.prefix ?? 'rhl') : new MemoryProviderStateStore(),
    usage: new PrismaUsageSink(db),
    health: new PrismaHealthSink(db),
    logger: options.logger,
  });
  return { gateway, factory };
}

/**
 * Active health check of one integration (Test connection, and the periodic sweep). Side-effect free.
 * Returns null when this environment has no adapter for it (e.g. a fake provider in production).
 */
export async function checkIntegrationHealth(db: PrismaClient, runtime: ProviderRuntime, integration: Integration) {
  const binding = toBinding(integration, runtime.factory);
  if (!binding) return null;
  const checks = await runtime.gateway.checkHealth(integration.workspaceId, binding);
  await db.integration.update({ where: { id: integration.id }, data: { lastHealthCheckAt: new Date() } });
  return checks;
}

/** Periodic sweep over every live integration (docs/12 §83: lightweight checks, not provider spam). */
export async function checkAllIntegrations(db: PrismaClient, runtime: ProviderRuntime): Promise<number> {
  const integrations = await db.integration.findMany({ where: { status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] } }, take: 500 });
  let checked = 0;
  for (const integration of integrations) if (await checkIntegrationHealth(db, runtime, integration)) checked++;
  return checked;
}
