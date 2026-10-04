import { createHash } from 'node:crypto';
import type { ActorType, Prisma } from '@revenue-os/database';
import { getContext, newId } from '@revenue-os/shared/server';
import { EVENTS, type EventPayloads, type EventType } from './registry.js';

export type Tx = Prisma.TransactionClient;

/** Who caused the event. Structurally compatible with the API's ServiceContext. */
export interface EventSource {
  workspaceId: string | null;
  actor: { type: ActorType; id: string | null };
}

export interface RecordedEvent {
  eventId: string;
  correlationId: string;
}

/**
 * Transactional outbox writer (docs/07 §5, docs/11 §11-14). Call it with the SAME transaction client as the
 * business mutation: the DomainEvent and its OutboxEvent commit or roll back together with the change, so an
 * event is never published for a change that didn't happen, and a committed change never loses its event.
 *
 * correlationId continues the current workflow (request/job context); causationId is the event or request that
 * directly caused this one.
 */
export async function recordEvent<T extends EventType>(
  tx: Tx,
  source: EventSource,
  type: T,
  aggregateId: string,
  payload: EventPayloads[T],
  options: { causationId?: string } = {},
): Promise<RecordedEvent> {
  const definition = EVENTS[type];
  const exec = getContext();
  const correlationId = exec?.correlationId ?? newId();
  const causationId = options.causationId ?? exec?.causationId ?? exec?.requestId ?? null;
  const eventId = newId();
  const json = payload as unknown as Prisma.InputJsonValue;

  await tx.domainEvent.create({
    data: {
      id: eventId,
      workspaceId: source.workspaceId,
      eventType: type,
      eventVersion: definition.version,
      aggregateType: definition.aggregateType,
      aggregateId,
      payload: json,
      actorType: source.actor.type,
      actorId: source.actor.id,
      correlationId,
      causationId,
    },
  });
  await tx.outboxEvent.create({
    data: {
      workspaceId: source.workspaceId,
      domainEventId: eventId,
      eventType: type,
      eventVersion: definition.version,
      aggregateType: definition.aggregateType,
      aggregateId,
      payload: json,
      correlationId,
      causationId: eventId,
    },
  });
  return { eventId, correlationId };
}

/** Deterministic JSON (sorted keys) so equal payloads hash equally regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}
