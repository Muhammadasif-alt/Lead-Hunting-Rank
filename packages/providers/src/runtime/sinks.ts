import type { IntegrationStatus, PrismaClient, ProviderHealthState } from '@revenue-os/database';
import { recordEvent, type EventType } from '@revenue-os/events';
import { getContext } from '@revenue-os/shared/server';
import { HEALTH_SEVERITY, type HealthState } from '../core/capabilities.js';
import type { CallRecord, HealthObservation, HealthSink, UsageSink } from '../gateway/gateway.js';

/** Writes one ProviderCallRecord per provider call (docs/12 §111). */
export class PrismaUsageSink implements UsageSink {
  constructor(private readonly db: PrismaClient) {}

  async record(call: CallRecord) {
    await this.db.providerCallRecord.create({ data: { ...call, correlationId: getContext()?.correlationId ?? null } });
  }
}

const TRANSITION_EVENT: Record<HealthState, EventType> = {
  HEALTHY: 'ProviderRecovered',
  DEGRADED: 'IntegrationDegraded',
  RATE_LIMITED: 'ProviderRateLimited',
  AUTH_REQUIRED: 'IntegrationAuthExpired',
  UNAVAILABLE: 'ProviderUnavailable',
};

const STATUS_FOR: Record<HealthState, IntegrationStatus> = {
  HEALTHY: 'ACTIVE',
  DEGRADED: 'DEGRADED',
  RATE_LIMITED: 'RATE_LIMITED',
  AUTH_REQUIRED: 'AUTH_EXPIRED',
  UNAVAILABLE: 'ERROR',
};

/** Statuses that follow health. DISABLED / DISCONNECTED / CONNECTING are human decisions and stay put. */
const HEALTH_DRIVEN: IntegrationStatus[] = ['ACTIVE', 'DEGRADED', 'RATE_LIMITED', 'AUTH_EXPIRED', 'ERROR'];

/**
 * Persists capability health and turns transitions into events (IntegrationAuthExpired, ProviderRecovered…) in the
 * same transaction. The integration's overall status follows its worst capability. Unchanged states are written at
 * most once per `throttleMs` per process, so a busy capability doesn't write a row per call.
 */
export class PrismaHealthSink implements HealthSink {
  private readonly written = new Map<string, { state: HealthState; at: number }>();

  constructor(
    private readonly db: PrismaClient,
    private readonly throttleMs = 60_000,
  ) {}

  async observe(o: HealthObservation) {
    if (!o.integrationId) return;
    const integrationId = o.integrationId;
    const cacheKey = `${integrationId}:${o.capability}`;
    const cached = this.written.get(cacheKey);
    if (cached && cached.state === o.state && Date.now() - cached.at < this.throttleMs) return;

    await this.db.$transaction(async (tx) => {
      // Serialize health writes per integration so two workers can't both emit the same transition.
      const locked = await tx.$queryRaw<{ status: IntegrationStatus }[]>`SELECT status FROM "Integration" WHERE id = ${integrationId}::uuid AND "workspaceId" = ${o.workspaceId}::uuid FOR UPDATE`;
      if (locked.length === 0) return;
      const now = new Date();
      const ok = o.state === 'HEALTHY';
      const prev = await tx.integrationCapabilityHealth.findUnique({ where: { integrationId_capability: { integrationId, capability: o.capability } } });
      const state = o.state as ProviderHealthState;
      await tx.integrationCapabilityHealth.upsert({
        where: { integrationId_capability: { integrationId, capability: o.capability } },
        create: { workspaceId: o.workspaceId, integrationId, capability: o.capability, state, reason: o.reason, checkedAt: now, ...(ok ? { lastSuccessAt: now } : { lastFailureAt: now }) },
        update: { state, reason: o.reason, checkedAt: now, ...(ok ? { lastSuccessAt: now } : { lastFailureAt: now }) },
      });

      if (prev?.state !== o.state && !(prev === null && ok)) {
        await recordEvent(tx, { workspaceId: o.workspaceId, actor: { type: 'SYSTEM', id: null } }, TRANSITION_EVENT[o.state], integrationId, {
          integrationId,
          provider: o.provider,
          capability: o.capability,
          from: prev?.state ?? null,
          to: o.state,
          reason: o.reason,
        });
      }

      const all = await tx.integrationCapabilityHealth.findMany({ where: { integrationId }, select: { state: true } });
      const worst = all.reduce<HealthState>((w, h) => (HEALTH_SEVERITY[h.state] > HEALTH_SEVERITY[w] ? h.state : w), 'HEALTHY');
      const current = locked[0]!.status;
      await tx.integration.update({
        where: { id: integrationId },
        data: {
          ...(HEALTH_DRIVEN.includes(current) && STATUS_FOR[worst] !== current ? { status: STATUS_FOR[worst], version: { increment: 1 } } : {}),
          ...(ok ? { lastSuccessAt: now } : { lastErrorAt: now, lastError: o.reason?.slice(0, 1000) ?? null }),
        },
      });
    });
    this.written.set(cacheKey, { state: o.state, at: Date.now() });
  }
}
