import { Inject, Injectable } from '@nestjs/common';
import { googleOAuthConfig, type AppConfig } from '@revenue-os/config';
import type { Integration, IntegrationStatus } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import { isConnectable, PROVIDER_CATALOG, providerDefinition } from '@revenue-os/providers';
import { checkIntegrationHealth, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@revenue-os/shared';
import { actorUserId, writeAudit, type ServiceContext, type Tx } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_CONFIG } from '../../infra/tokens.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { PROVIDER_RUNTIME } from './provider-runtime.js';

const DAY = 24 * 3_600_000;

/** Fields safe to show. Never the credential reference or raw configuration (docs/12 §149: no secrets displayed). */
function present(i: Integration & { health?: { capability: string; state: string; reason: string | null; checkedAt: Date; lastSuccessAt: Date | null; lastFailureAt: Date | null }[] }) {
  return {
    id: i.id,
    provider: i.provider,
    category: i.category,
    name: i.name,
    status: i.status,
    capabilities: i.capabilities,
    priority: i.priority,
    connectedAt: i.connectedAt,
    disconnectedAt: i.disconnectedAt,
    lastHealthCheckAt: i.lastHealthCheckAt,
    lastSuccessAt: i.lastSuccessAt,
    lastErrorAt: i.lastErrorAt,
    lastError: i.lastError,
    version: i.version,
    health: (i.health ?? []).map((h) => ({ capability: h.capability, state: h.state, reason: h.reason, checkedAt: h.checkedAt, lastSuccessAt: h.lastSuccessAt, lastFailureAt: h.lastFailureAt })),
  };
}

/**
 * Integrations (docs/12 §144-149, screen #15): connect / test / disable / enable / disconnect a workspace's provider
 * connections, plus health and usage. Every state change is audited and emits its event in the same transaction.
 * Disconnecting keeps the row, its health history and usage — business records never depend on a live connection.
 */
@Injectable()
export class IntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
    private readonly google: GoogleOAuthService,
  ) {}

  catalog() {
    return PROVIDER_CATALOG.map((p) => ({ ...p, connectable: isConnectable(p, this.config.APP_ENV, this.serverKeys()) }));
  }

  async list(workspaceId: string) {
    const db = this.prisma.client;
    const [integrations, usage] = await Promise.all([
      db.integration.findMany({ where: { workspaceId }, include: { health: { orderBy: { capability: 'asc' } } }, orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] }),
      db.providerCallRecord.groupBy({
        by: ['integrationId', 'status'],
        where: { workspaceId, startedAt: { gte: new Date(Date.now() - DAY) } },
        _count: true,
        _avg: { durationMs: true },
        _sum: { costMinor: true },
      }),
    ]);
    return integrations.map((i) => {
      const rows = usage.filter((u) => u.integrationId === i.id);
      const calls = rows.reduce((n, r) => n + r._count, 0);
      const latency = rows.reduce((n, r) => n + (r._avg.durationMs ?? 0) * r._count, 0);
      const costs = rows.map((r) => r._sum.costMinor).filter((c): c is number => c !== null);
      return {
        ...present(i),
        usage24h: {
          calls,
          failures: rows.find((r) => r.status === 'FAILED')?._count ?? 0,
          avgLatencyMs: calls ? Math.round(latency / calls) : null,
          // null = the provider doesn't report cost; shown as unknown, never as $0.
          costMinor: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
        },
      };
    });
  }

  /** Usage per provider + capability over the last `days` (docs/12 §42: calls, failures, latency, units, cost). */
  async usage(workspaceId: string, days: number) {
    const rows = await this.prisma.client.providerCallRecord.groupBy({
      by: ['provider', 'capability', 'status'],
      where: { workspaceId, startedAt: { gte: new Date(Date.now() - days * DAY) } },
      _count: true,
      _avg: { durationMs: true },
      _sum: { units: true, costMinor: true },
    });
    const merged = new Map<string, { provider: string; capability: string; calls: number; failures: number; latencyTotal: number; units: number; costMinor: number | null }>();
    for (const r of rows) {
      const key = `${r.provider}:${r.capability}`;
      const m = merged.get(key) ?? { provider: r.provider, capability: r.capability, calls: 0, failures: 0, latencyTotal: 0, units: 0, costMinor: null };
      m.calls += r._count;
      if (r.status === 'FAILED') m.failures += r._count;
      m.latencyTotal += (r._avg.durationMs ?? 0) * r._count;
      m.units += r._sum.units ?? 0;
      if (r._sum.costMinor !== null) m.costMinor = (m.costMinor ?? 0) + r._sum.costMinor;
      merged.set(key, m);
    }
    return {
      days,
      rows: [...merged.values()].map(({ latencyTotal, ...m }) => ({ ...m, avgLatencyMs: m.calls ? Math.round(latencyTotal / m.calls) : null })),
    };
  }

  private serverKeys() {
    return { llmProvider: this.config.LLM_PROVIDER, llmKeyConfigured: !!this.config.LLM_API_KEY, googleOAuth: !!googleOAuthConfig(this.config) };
  }

  /**
   * Connects a provider that needs no credentials (fakes, local storage). Reconnecting a disconnected account restores
   * the same integration row and its history instead of creating a duplicate identity (docs/12 §120).
   */
  async connect(ctx: ServiceContext, providerKey: string, input: { name?: string }) {
    const def = providerDefinition(providerKey);
    if (!def) throw new NotFoundError(`Unknown provider ${providerKey}`);
    if (def.connection === 'OAUTH' && isConnectable(def, this.config.APP_ENV, this.serverKeys())) {
      throw new ValidationError(`${def.name} connects through Google sign-in — use "Connect with Google"`);
    }
    if (!isConnectable(def, this.config.APP_ENV, this.serverKeys())) {
      const why =
        def.status === 'PLANNED'
          ? `arrives in Phase ${def.plannedPhase}`
          : def.fake
            ? 'test providers are disabled in production'
            : def.connection === 'SERVER_KEY'
              ? `the server needs LLM_PROVIDER=${def.key} and LLM_API_KEY`
              : def.connection === 'OAUTH'
                ? 'the server needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and ENCRYPTION_KEY'
                : `needs ${def.connection} credentials`;
      throw new ValidationError(`${def.name} can't be connected here: ${why}`);
    }
    const integration = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.integration.findUnique({ where: { workspaceId_provider_accountRef: { workspaceId: ctx.workspaceId, provider: def.key, accountRef: 'default' } } });
      if (existing && existing.status !== 'DISCONNECTED') throw new ConflictError('ALREADY_EXISTS', `${def.name} is already connected`);
      const data = {
        status: 'ACTIVE' as const,
        name: input.name?.trim() || existing?.name || def.name,
        capabilities: def.capabilities,
        category: def.category,
        connectedBy: actorUserId(ctx),
        connectedAt: new Date(),
        disconnectedAt: null,
      };
      const row = existing
        ? await tx.integration.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.integration.create({ data: { ...data, workspaceId: ctx.workspaceId, provider: def.key } });
      await writeAudit(tx, ctx, { action: existing ? 'integration.reconnected' : 'integration.connected', entityType: 'INTEGRATION', entityId: row.id, after: { provider: def.key, name: row.name } });
      await recordEvent(tx, ctx, 'IntegrationConnected', row.id, { integrationId: row.id, provider: def.key, reconnected: Boolean(existing) });
      return row;
    });
    const checks = await checkIntegrationHealth(this.prisma.client, this.runtime, integration);
    return { integration: present(await this.find(ctx.workspaceId, integration.id, true)), checks };
  }

  /** Test connection: side-effect-free capability checks — never a real email (docs/12 §118). */
  async test(ctx: ServiceContext, id: string) {
    const integration = await this.find(ctx.workspaceId, id);
    if (integration.status === 'DISABLED' || integration.status === 'DISCONNECTED') {
      throw new BusinessRuleError('INVALID_STATE_TRANSITION', `Integration is ${integration.status.toLowerCase()} — enable or reconnect it first`);
    }
    const checks = await checkIntegrationHealth(this.prisma.client, this.runtime, integration);
    if (!checks) throw new ValidationError(`No ${integration.provider} adapter is available in this environment`);
    return { integration: present(await this.find(ctx.workspaceId, id, true)), checks };
  }

  disable(ctx: ServiceContext, id: string) {
    return this.change(ctx, id, ['ACTIVE', 'DEGRADED', 'AUTH_EXPIRED', 'RATE_LIMITED', 'ERROR', 'CONNECTING'], 'DISABLED', 'integration.disabled', (tx, i) =>
      recordEvent(tx, ctx, 'IntegrationDisabled', i.id, { integrationId: i.id, provider: i.provider }),
    );
  }

  async enable(ctx: ServiceContext, id: string) {
    const result = await this.change(ctx, id, ['DISABLED'], 'ACTIVE', 'integration.enabled', (tx, i) =>
      recordEvent(tx, ctx, 'IntegrationEnabled', i.id, { integrationId: i.id, provider: i.provider }),
    );
    // Health may have changed while it was off — check before anything routes to it again.
    const integration = await this.find(ctx.workspaceId, id);
    await checkIntegrationHealth(this.prisma.client, this.runtime, integration);
    return { ...result, integration: present(await this.find(ctx.workspaceId, id, true)) };
  }

  /** Stops new provider calls and marks it disconnected; history, mappings and usage stay (docs/12 §119). */
  async disconnect(ctx: ServiceContext, id: string) {
    const result = await this.change(
      ctx,
      id,
      ['ACTIVE', 'DEGRADED', 'AUTH_EXPIRED', 'RATE_LIMITED', 'ERROR', 'CONNECTING', 'DISABLED'],
      'DISCONNECTED',
      'integration.disconnected',
      (tx, i) => recordEvent(tx, ctx, 'IntegrationDisconnected', i.id, { integrationId: i.id, provider: i.provider }),
      { disconnectedAt: new Date() },
    );
    // Google connections (Gmail, Calendar): revoke the grant and delete the stored tokens — reconnecting asks Google again.
    const row = await this.prisma.client.integration.findUnique({ where: { id }, select: { provider: true } });
    if (row?.provider === 'gmail' || row?.provider === 'google_calendar') await this.google.forget(id);
    return result;
  }

  private async change(
    ctx: ServiceContext,
    id: string,
    from: IntegrationStatus[],
    to: IntegrationStatus,
    action: string,
    emit: (tx: Tx, integration: Integration) => Promise<unknown>,
    extra: { disconnectedAt?: Date } = {},
  ) {
    const integration = await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.integration.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!current) throw new NotFoundError(`integration ${id} not found`);
      // Conditional on the status we read: a concurrent change makes this a clean conflict, not a lost update.
      const { count } = await tx.integration.updateMany({
        where: { id, workspaceId: ctx.workspaceId, status: { in: from }, version: current.version },
        data: { status: to, version: { increment: 1 }, ...extra },
      });
      if (count === 0) {
        if (!from.includes(current.status)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `Integration is ${current.status.toLowerCase()}`);
        throw new ConflictError('VERSION_CONFLICT', 'Integration changed meanwhile — reload and try again');
      }
      await writeAudit(tx, ctx, { action, entityType: 'INTEGRATION', entityId: id, before: { status: current.status }, after: { status: to } });
      await emit(tx, current);
      return tx.integration.findUniqueOrThrow({ where: { id }, include: { health: { orderBy: { capability: 'asc' } } } });
    });
    return { integration: present(integration) };
  }

  private async find(workspaceId: string, id: string): Promise<Integration>;
  private async find(workspaceId: string, id: string, withHealth: true): Promise<Parameters<typeof present>[0]>;
  private async find(workspaceId: string, id: string, withHealth = false) {
    const integration = await this.prisma.client.integration.findFirst({
      where: { id, workspaceId },
      ...(withHealth ? { include: { health: { orderBy: { capability: 'asc' as const } } } } : {}),
    });
    if (!integration) throw new NotFoundError(`integration ${id} not found`);
    return integration;
  }
}
