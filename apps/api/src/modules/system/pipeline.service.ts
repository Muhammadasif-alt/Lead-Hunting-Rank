import { Injectable } from '@nestjs/common';
import type { DeadLetterStatus, Prisma } from '@revenue-os/database';
import { prepareExternalAction, queueExternalAction } from '@revenue-os/events';
import { DEFAULT_ATTEMPTS, JOB_RETENTION, readHeartbeats } from '@revenue-os/events/runtime';
import { FAKE_SEND_ACTION, fakeProviderKey, type FakeFailure } from '@revenue-os/events/testing';
import { BusinessRuleError, describeError, JOBS, NotFoundError, QUEUES, type QueueName } from '@revenue-os/shared';
import { newId } from '@revenue-os/shared/server';
import { writeAudit, type ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { QueueService } from '../../infra/queue.service.js';

const QUEUE_NAMES = new Set<string>(Object.values(QUEUES));
/** Queues that have workers today; the rest exist by name only until their phase. */
const ACTIVE_QUEUES: QueueName[] = [QUEUES.outbound, QUEUES.maintenance];

/**
 * Event pipeline operations for the System Health screen (#18): outbox/queue/worker state, the end-to-end
 * self-test, and the dead-letter queue (docs/11 §44-47, §114-118). Workspace data is always scoped to the
 * caller's workspace; DLQ rows without a workspace are system jobs and visible to every system.read holder.
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  async overview(workspaceId: string) {
    const db = this.prisma.client;
    const [outbox, oldestPending, actions, deadLetters, workers, queues] = await Promise.all([
      db.outboxEvent.groupBy({ by: ['status'], where: { workspaceId }, _count: true }),
      db.outboxEvent.findFirst({ where: { workspaceId, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      db.externalAction.groupBy({ by: ['status'], where: { workspaceId }, _count: true }),
      db.deadLetterRecord.count({ where: { status: 'OPEN', OR: [{ workspaceId }, { workspaceId: null }] } }),
      readHeartbeats(this.queues.redis, this.queues.prefix).catch(() => null),
      Promise.all(
        ACTIVE_QUEUES.map(async (name) => {
          try {
            const c = await this.queues.queue(name).getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed');
            return { name, waiting: (c.waiting ?? 0) + (c.prioritized ?? 0), active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0 };
          } catch (err) {
            return { name, error: describeError(err) };
          }
        }),
      ),
    ]);
    const counts = (rows: { status: string; _count: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r._count]));
    return {
      outbox: { ...counts(outbox), oldestPendingAgeMs: oldestPending ? Date.now() - oldestPending.createdAt.getTime() : null },
      externalActions: counts(actions),
      openDeadLetters: deadLetters,
      workers: workers?.map((w) => ({ workerId: w.workerId, queues: w.queues, startedAt: w.startedAt, lastHeartbeatAt: w.lastHeartbeatAt, metrics: w.metrics })) ?? null,
      queues,
    };
  }

  /**
   * DoD self-test (docs/13 Phase 4): API command → DB transaction (ExternalAction + event + outbox) → dispatcher →
   * BullMQ → worker → fake provider → result → event. `simulate` injects a first-attempt failure to show retries
   * and crash-safe reconciliation.
   */
  async runPipelineTest(ctx: ServiceContext, simulate?: FakeFailure) {
    const runId = newId();
    const action = await this.prisma.client.$transaction(async (tx) => {
      const { action } = await prepareExternalAction(tx, ctx, {
        actionType: FAKE_SEND_ACTION,
        provider: 'fake',
        entityType: 'WORKSPACE',
        entityId: ctx.workspaceId,
        idempotencyKey: `diagnostics:pipeline-test:${runId}`,
        payload: { runId, requestedBy: ctx.actor.id, ...(simulate ? { simulate } : {}) },
      });
      await queueExternalAction(tx, ctx, action.id);
      await writeAudit(tx, ctx, { action: 'system.pipeline_test', entityType: 'EXTERNAL_ACTION', entityId: action.id, after: { simulate: simulate ?? null } });
      return tx.externalAction.findUniqueOrThrow({ where: { id: action.id } });
    });
    return { externalActionId: action.id, correlationId: action.correlationId };
  }

  /** An action with its full event trail (same correlationId) — "what happened, in order?". */
  async externalAction(workspaceId: string, id: string) {
    const db = this.prisma.client;
    const action = await db.externalAction.findFirst({ where: { id, workspaceId } });
    if (!action) throw new NotFoundError(`external action ${id} not found`);
    const events = action.correlationId
      ? await db.domainEvent.findMany({
          where: { workspaceId, correlationId: action.correlationId },
          orderBy: { occurredAt: 'asc' },
          select: { id: true, eventType: true, occurredAt: true, actorType: true, causationId: true, payload: true },
        })
      : [];
    let providerCalls: number | null = null;
    if (action.actionType === FAKE_SEND_ACTION) {
      const raw = await this.queues.redis.get(fakeProviderKey(this.queues.prefix, 'calls', action.idempotencyKey)).catch(() => null);
      providerCalls = raw === null ? 0 : Number(raw);
    }
    const { payload: _payload, payloadHash: _hash, ...summary } = action;
    return { action: summary, events, providerCalls };
  }

  listDeadLetters(workspaceId: string, status: DeadLetterStatus = 'OPEN') {
    return this.prisma.client.deadLetterRecord.findMany({
      where: { status, OR: [{ workspaceId }, { workspaceId: null }] },
      orderBy: { lastFailedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        queue: true,
        jobName: true,
        entityType: true,
        entityId: true,
        correlationId: true,
        failureCategory: true,
        lastError: true,
        attempts: true,
        retryCount: true,
        status: true,
        firstFailedAt: true,
        lastFailedAt: true,
        resolvedAt: true,
        resolutionNote: true,
      },
    });
  }

  /**
   * Manual retry (docs/11 §46): re-enqueues the same logical job. The handler reloads current state, so a retry
   * can never do something the current state no longer allows. A FAILED external action is re-queued through its
   * state machine instead (FAILED → QUEUED, with a fresh event).
   */
  async retryDeadLetter(ctx: ServiceContext, id: string) {
    const record = await this.findDeadLetter(ctx.workspaceId, id);
    if (record.status !== 'OPEN') throw new BusinessRuleError('INVALID_STATE_TRANSITION', `Dead letter is ${record.status}`);
    const data = (record.jobData ?? {}) as Record<string, unknown>;

    if (record.jobName === JOBS.externalActionExecute && typeof data.externalActionId === 'string' && record.workspaceId) {
      const action = await this.prisma.client.externalAction.findFirst({ where: { id: data.externalActionId, workspaceId: record.workspaceId } });
      if (action && action.status !== 'QUEUED' && action.status !== 'UNKNOWN_OUTCOME') {
        const requeue = action.status === 'FAILED';
        await this.prisma.client.$transaction(async (tx) => {
          if (requeue) await queueExternalAction(tx, ctx, action.id);
          await this.settle(tx, ctx, record.id, 'RESOLVED', requeue ? 'Action re-queued for execution' : `Nothing to retry — action is ${action.status}`);
        });
        return { retried: requeue, note: requeue ? 'Action re-queued' : `Action is already ${action.status}` };
      }
    }

    if (!QUEUE_NAMES.has(record.queue)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `Unknown queue ${record.queue}`);
    const attempt = record.retryCount + 1;
    await this.queues.queue(record.queue as QueueName).add(record.jobName, { ...data, deadLetterId: record.id }, {
      jobId: `dlq.${record.id}.${attempt}`,
      attempts: DEFAULT_ATTEMPTS,
      backoff: { type: 'custom' },
      ...JOB_RETENTION,
    });
    await this.prisma.client.$transaction(async (tx) => {
      await tx.deadLetterRecord.update({ where: { id: record.id }, data: { status: 'RETRY_SCHEDULED', retryCount: attempt } });
      await writeAudit(tx, ctx, { action: 'dead_letter.retried', entityType: 'WORKSPACE', entityId: ctx.workspaceId, after: { deadLetterId: record.id, attempt } });
    });
    return { retried: true, note: 'Job re-enqueued' };
  }

  async ignoreDeadLetter(ctx: ServiceContext, id: string, note?: string) {
    const record = await this.findDeadLetter(ctx.workspaceId, id);
    if (record.status === 'RESOLVED' || record.status === 'IGNORED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', `Dead letter is ${record.status}`);
    await this.prisma.client.$transaction((tx) => this.settle(tx, ctx, record.id, 'IGNORED', note?.trim() || 'Dismissed'));
    return { ignored: true };
  }

  private async findDeadLetter(workspaceId: string, id: string) {
    const record = await this.prisma.client.deadLetterRecord.findFirst({ where: { id, OR: [{ workspaceId }, { workspaceId: null }] } });
    if (!record) throw new NotFoundError(`dead letter ${id} not found`);
    return record;
  }

  private async settle(tx: Prisma.TransactionClient, ctx: ServiceContext, id: string, status: 'RESOLVED' | 'IGNORED', note: string) {
    await tx.deadLetterRecord.update({ where: { id }, data: { status, resolvedAt: new Date(), resolvedBy: ctx.actor.id, resolutionNote: note } });
    await writeAudit(tx, ctx, {
      action: status === 'RESOLVED' ? 'dead_letter.resolved' : 'dead_letter.ignored',
      entityType: 'WORKSPACE',
      entityId: ctx.workspaceId,
      after: { deadLetterId: id, note },
    });
  }
}
