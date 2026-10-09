import { join } from 'node:path';
import type { Integration, PrismaClient } from '@revenue-os/database';
import type { Redis } from 'ioredis';
import { providerDefinition } from '../catalog.js';
import type { Capability } from '../core/capabilities.js';
import type { ProviderAdapter } from '../core/interfaces.js';
import { GoogleCalendarProvider } from '../calendar/google-calendar.js';
import { FakeCalendarProvider, MemoryCalendarStore, RedisCalendarStore } from '../fakes/calendar.js';
import { FakeEmailProvider, MemoryMailboxStore, RedisMailboxStore } from '../fakes/email.js';
import { FakeDirectoryProvider, FakeLeadProvider } from '../fakes/leads.js';
import { FakeLLMProvider } from '../fakes/llm.js';
import { FakeNotificationProvider } from '../fakes/notification.js';
import { FakeVerificationProvider } from '../fakes/verification.js';
import { FakeWebsiteProvider } from '../fakes/websites.js';
import { ProviderGateway, type BindingResolver, type ProviderBinding } from '../gateway/gateway.js';
import { MemoryProviderStateStore, RedisProviderStateStore } from '../gateway/state-store.js';
import { CredentialStore } from '../credentials/secret.js';
import { GmailProvider } from '../email/gmail.js';
import { refreshGoogleToken, type GoogleTokens } from '../email/google-oauth.js';
import { ProviderCallError } from '../core/errors.js';
import { AnthropicProvider } from '../llm/anthropic.js';
import { LocalStorageProvider } from '../storage/local.js';
import { HttpWebsiteFetcher } from '../web/fetcher.js';
import { PrismaHealthSink, PrismaUsageSink } from './sinks.js';

type IntegrationRef = Pick<Integration, 'id' | 'workspaceId' | 'provider'>;

/** Builds (and caches) the adapter instance behind an integration. Returns null when not available here. */
export interface AdapterFactory {
  forIntegration(integration: IntegrationRef): ProviderAdapter | null;
}

export interface AdapterFactoryOptions {
  appEnv: string;
  storagePath: string;
  /** With Redis, the fake mailbox and calendar survive restarts and are shared by API and worker. */
  redis?: Redis;
  prefix?: string;
  /** Server LLM configuration (LLM_PROVIDER / LLM_API_KEY). */
  llm?: { provider: string; apiKey?: string };
  /** Encrypted per-integration credentials (OAuth tokens) and the Google OAuth client to refresh them. */
  credentials?: { db: PrismaClient; encryptionKey?: string; google?: { clientId: string; clientSecret: string } };
  fetch?: typeof fetch;
}

/** A fresh Google access token (Gmail, Calendar): refreshed (and re-stored, encrypted) a minute before it expires. */
function googleTokenSource(integrationId: string, creds: NonNullable<AdapterFactoryOptions['credentials']>, fetchFn?: typeof fetch) {
  const store = new CredentialStore(creds.db, creds.encryptionKey);
  let cached: GoogleTokens | null = null;
  return async () => {
    if (!creds.google) throw new ProviderCallError('AUTH_REQUIRED', 'Google OAuth is not configured on this server');
    cached ??= await store.load<GoogleTokens>(integrationId);
    if (!cached) throw new ProviderCallError('AUTH_REQUIRED', 'No credentials stored for this connection — reconnect it');
    if (cached.expiresAt - Date.now() < 60_000) {
      cached = await refreshGoogleToken(creds.google, cached, fetchFn);
      const row = await creds.db.integration.findUnique({ where: { id: integrationId }, select: { workspaceId: true } });
      if (row) await store.save(row.workspaceId, integrationId, cached);
    }
    return cached.accessToken;
  };
}

/**
 * Which adapter serves which catalog key. Fakes exist only outside production. Real vendor adapters register here as
 * their phases land (docs/12 §1 order: LLM, Gmail, Calendar, Storage, lead data, verification).
 */
export function createAdapterFactory(options: AdapterFactoryOptions): AdapterFactory {
  const cache = new Map<string, ProviderAdapter>();
  const fakesAllowed = options.appEnv !== 'production';
  const shared = {
    fake_leads: new FakeLeadProvider(),
    fake_directory: new FakeDirectoryProvider(),
    fake_verification: new FakeVerificationProvider(),
    fake_websites: new FakeWebsiteProvider(),
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
      case 'fake_calendar':
        return new FakeCalendarProvider(
          options.redis ? new RedisCalendarStore(options.redis, `${options.prefix ?? 'rhl'}:fake-calendar:${integration.id}`) : new MemoryCalendarStore(),
        );
      case 'local_storage':
        // One directory per workspace — a key can never reach another workspace's files.
        return new LocalStorageProvider(join(options.storagePath, integration.workspaceId));
      case 'web_fetcher':
        return new HttpWebsiteFetcher();
      case 'gmail':
        return options.credentials ? new GmailProvider({ getAccessToken: googleTokenSource(integration.id, options.credentials, options.fetch), fetch: options.fetch }) : null;
      case 'google_calendar':
        return options.credentials ? new GoogleCalendarProvider({ getAccessToken: googleTokenSource(integration.id, options.credentials, options.fetch), fetch: options.fetch }) : null;
      case 'anthropic':
        return options.llm?.provider === 'anthropic' && options.llm.apiKey ? new AnthropicProvider({ apiKey: options.llm.apiKey }) : null;
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
  fake_directory: { limit: 120, windowMs: 60_000 },
  // Polite to the sites we read and to our own bandwidth: three pages per company.
  web_fetcher: { limit: 60, windowMs: 60_000 },
};

/** The fetcher keeps its own per-page deadline (a slow site is a website fact); the gateway's must outlast it. */
const DEFAULT_TIMEOUTS: Record<string, number> = { web_fetcher: 20_000, anthropic: 120_000 };

export function toBinding(integration: Pick<Integration, 'id' | 'workspaceId' | 'provider' | 'capabilities'>, factory: AdapterFactory): ProviderBinding | null {
  const adapter = factory.forIntegration(integration);
  if (!adapter) return null;
  return {
    integrationId: integration.id,
    provider: integration.provider,
    capabilities: integration.capabilities as Capability[],
    adapter,
    rateLimit: DEFAULT_RATE_LIMITS[integration.provider],
    timeoutMs: DEFAULT_TIMEOUTS[integration.provider],
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
  const factory = createAdapterFactory({ ...options, credentials: { db, ...options.credentials } });
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
