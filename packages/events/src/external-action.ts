import type { EntityType, ExternalAction, ExternalActionStatus, Prisma, PrismaClient } from '@revenue-os/database';
import {
  BusinessRuleError,
  classifyFailure,
  ConflictError,
  describeError,
  JobTimeoutError,
  NotFoundError,
  PermanentError,
  ProviderError,
  RateLimitedError,
} from '@revenue-os/shared';
import { newId } from '@revenue-os/shared/server';
import { payloadHash, recordEvent, type EventSource, type Tx } from './writer.js';

/**
 * ExternalAction lifecycle (docs/07 §101, docs/11 §18-29):
 *
 *   PREPARED → (WAITING_APPROVAL → APPROVED →) QUEUED → EXECUTING → SUCCEEDED
 *                                                         ├→ QUEUED           provider definitely refused (429/503) — retry
 *                                                         ├→ UNKNOWN_OUTCOME  timeout / connection lost mid-call — reconcile
 *                                                         ├→ WAITING          e.g. provider needs re-auth
 *                                                         └→ BLOCKED / CANCELLED / FAILED
 *   UNKNOWN_OUTCOME → SUCCEEDED (provider has it) | QUEUED (provider confirms it never happened) | stays → human
 *
 * SUCCEEDED is final for its idempotency key; a database trigger enforces that too.
 */
export const EXTERNAL_ACTION_TRANSITIONS: Record<ExternalActionStatus, readonly ExternalActionStatus[]> = {
  PREPARED: ['WAITING_APPROVAL', 'APPROVED', 'QUEUED', 'BLOCKED', 'CANCELLED'],
  WAITING_APPROVAL: ['APPROVED', 'BLOCKED', 'CANCELLED'],
  APPROVED: ['QUEUED', 'BLOCKED', 'CANCELLED'],
  QUEUED: ['EXECUTING', 'WAITING', 'BLOCKED', 'CANCELLED', 'FAILED'],
  EXECUTING: ['SUCCEEDED', 'QUEUED', 'UNKNOWN_OUTCOME', 'WAITING', 'BLOCKED', 'CANCELLED', 'FAILED'],
  WAITING: ['QUEUED', 'BLOCKED', 'CANCELLED'],
  UNKNOWN_OUTCOME: ['SUCCEEDED', 'QUEUED', 'FAILED'],
  SUCCEEDED: [],
  BLOCKED: [],
  CANCELLED: [],
  // An admin may retry a failed action; execution revalidates everything first.
  FAILED: ['QUEUED'],
};

export function canTransition(from: ExternalActionStatus, to: ExternalActionStatus): boolean {
  return EXTERNAL_ACTION_TRANSITIONS[from].includes(to);
}

/** What an executor sees. Payload is the snapshot frozen at prepare time — never re-read from a live record. */
export type ExternalActionView = Pick<
  ExternalAction,
  'id' | 'workspaceId' | 'actionType' | 'provider' | 'providerAccountId' | 'idempotencyKey' | 'payload' | 'attemptCount' | 'entityType' | 'entityId'
>;

export type ReconcileResult = { status: 'SUCCEEDED'; providerRef: string } | { status: 'NOT_FOUND' } | { status: 'UNDETERMINED' };

/**
 * Adapter that performs one kind of side effect (Phase 5 wraps real providers in these).
 * - execute: throw RateLimitedError / ProviderError('PROVIDER_UNAVAILABLE') only when the provider definitely
 *   did NOT act; any other error (timeout, reset) is treated as "maybe it did" and reconciled.
 * - reconcile: look the action up at the provider by its idempotency key/reference.
 */
export interface ActionExecutor {
  execute(action: ExternalActionView, signal: AbortSignal): Promise<{ providerRef: string }>;
  reconcile?(action: ExternalActionView): Promise<ReconcileResult>;
}

export type Revalidation = { ok: true } | { ok: false; status: 'BLOCKED' | 'CANCELLED' | 'WAITING'; reason: string };

/**
 * Current-state check immediately before the side effect (docs/07 §16-17). Phase 4 checks the workspace is
 * active; the Policy Engine, suppression and kill switch plug in here in Phase 10.
 */
export type Revalidator = (action: ExternalActionView, db: PrismaClient) => Promise<Revalidation>;

export const workspaceActiveRevalidator: Revalidator = async (action, db) => {
  const ws = await db.workspace.findUnique({ where: { id: action.workspaceId }, select: { status: true } });
  return ws?.status === 'ACTIVE' ? { ok: true } : { ok: false, status: 'BLOCKED', reason: `Workspace is ${ws?.status ?? 'missing'}` };
};

// ───────────────────────────── prepare / queue ─────────────────────────────

export interface PrepareInput {
  actionType: string;
  provider: string;
  providerAccountId?: string;
  entityType: EntityType;
  entityId: string;
  /** One logical side effect = one key, e.g. campaign:{id}:enrollment:{id}:step:{id}:message:{id} (docs/11 §21). */
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

/**
 * Creates the action, or returns the existing one for the same idempotency key. Asking again with a different
 * payload under the same key is an IDEMPOTENCY_CONFLICT — a changed message is a new logical action.
 * Safe inside a caller's transaction (uses ON CONFLICT DO NOTHING, so a duplicate doesn't abort the transaction).
 */
export async function prepareExternalAction(tx: Tx, source: EventSource & { workspaceId: string }, input: PrepareInput) {
  const hash = payloadHash(input.payload);
  const id = newId();
  const { count } = await tx.externalAction.createMany({
    data: [
      {
        id,
        workspaceId: source.workspaceId,
        actionType: input.actionType,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        entityType: input.entityType,
        entityId: input.entityId,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload as Prisma.InputJsonValue,
        payloadHash: hash,
      },
    ],
    skipDuplicates: true,
  });
  const action = await tx.externalAction.findUniqueOrThrow({
    where: { workspaceId_idempotencyKey: { workspaceId: source.workspaceId, idempotencyKey: input.idempotencyKey } },
  });
  if (count === 0 && action.payloadHash !== hash) {
    throw new ConflictError('IDEMPOTENCY_CONFLICT', `Idempotency key ${input.idempotencyKey} was already used for a different payload`);
  }
  if (count === 1) {
    const { correlationId } = await recordEvent(tx, source, 'ExternalActionPrepared', id, { externalActionId: id, actionType: input.actionType, provider: input.provider });
    await tx.externalAction.update({ where: { id }, data: { correlationId } });
  }
  return { action, created: count === 1 };
}

/** Moves a ready action to QUEUED and emits ExternalActionQueued — the outbox route enqueues its execution job. */
export async function queueExternalAction(tx: Tx, source: EventSource & { workspaceId: string }, id: string): Promise<boolean> {
  const action = await tx.externalAction.findFirst({ where: { id, workspaceId: source.workspaceId } });
  if (!action) throw new NotFoundError(`external action ${id} not found`);
  if (action.status === 'QUEUED') return false;
  const moved = await transition(tx, action, ['PREPARED', 'APPROVED', 'WAITING', 'FAILED'], 'QUEUED');
  if (!moved) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `Cannot queue an action that is ${action.status}`);
  await recordEvent(tx, source, 'ExternalActionQueued', id, { externalActionId: id, actionType: action.actionType });
  return true;
}

/** Conditional status update: succeeds only if the row is still in one of `from` (optimistic, race-safe). */
async function transition(
  db: Tx | PrismaClient,
  action: Pick<ExternalAction, 'id' | 'workspaceId'>,
  from: ExternalActionStatus[],
  to: ExternalActionStatus,
  data: Prisma.ExternalActionUpdateManyMutationInput = {},
): Promise<boolean> {
  for (const f of from) if (!canTransition(f, to)) throw new Error(`Illegal ExternalAction transition ${f} → ${to}`);
  const { count } = await db.externalAction.updateMany({
    where: { id: action.id, workspaceId: action.workspaceId, status: { in: from } },
    data: { ...data, status: to, version: { increment: 1 } },
  });
  return count === 1;
}

// ───────────────────────────── execute ─────────────────────────────

export type ExecutionOutcome =
  | 'SUCCEEDED'
  | 'ALREADY_SUCCEEDED'
  | 'RECONCILED_SUCCEEDED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'WAITING'
  | 'FAILED'
  | 'NEEDS_REVIEW'
  | 'NOT_EXECUTABLE'
  | 'IN_PROGRESS'
  | 'CLAIM_LOST';

/** Thrown to make the queue retry later; the action is already back in QUEUED or UNKNOWN_OUTCOME. */
export class RetryLaterError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RetryLaterError';
  }
}

export interface ExecuteDeps {
  executors: Record<string, ActionExecutor>;
  revalidate?: Revalidator;
  timeoutMs?: number;
  /** True on the job's last attempt: a retryable provider refusal then becomes FAILED instead of QUEUED. */
  finalAttempt?: boolean;
}

const SYSTEM: EventSource['actor'] = { type: 'SYSTEM', id: null };

/**
 * Executes an action at most once per idempotency key, no matter how many times its job is delivered
 * (docs/11 §130 "email safety formula"): load current state → atomic claim → revalidate → provider call →
 * persist result + event. A lost race, a duplicate job or a replay finds the row already claimed/finished and
 * does nothing.
 */
export async function executeExternalAction(
  db: PrismaClient,
  ref: { workspaceId: string; externalActionId: string },
  deps: ExecuteDeps,
): Promise<ExecutionOutcome> {
  let action = await db.externalAction.findFirst({ where: { id: ref.externalActionId, workspaceId: ref.workspaceId } });
  if (!action) throw new NotFoundError(`external action ${ref.externalActionId} not found`);
  const executor = deps.executors[action.actionType];
  if (!executor) throw new PermanentError(`No executor registered for action type ${action.actionType}`);
  const source: EventSource = { workspaceId: action.workspaceId, actor: SYSTEM };
  const base = { externalActionId: action.id, actionType: action.actionType };

  switch (action.status) {
    case 'SUCCEEDED':
      return 'ALREADY_SUCCEEDED';
    case 'EXECUTING':
      return 'IN_PROGRESS'; // another worker owns it; a stale claim is found by the reconcile sweep
    case 'BLOCKED':
    case 'CANCELLED':
    case 'FAILED':
    case 'PREPARED':
    case 'WAITING_APPROVAL':
    case 'APPROVED':
    case 'WAITING':
      return 'NOT_EXECUTABLE'; // the job is stale — current state wins (docs/11 §88)
    case 'UNKNOWN_OUTCOME': {
      const outcome = await reconcile(db, action, executor, source);
      if (outcome !== 'RETRY') return outcome;
      action = await db.externalAction.findUniqueOrThrow({ where: { id: action.id } });
      break; // provider confirmed it never happened → back in QUEUED, execute below
    }
    case 'QUEUED':
      break;
  }

  // Atomic claim: exactly one worker moves QUEUED → EXECUTING.
  const claimedAt = new Date();
  const claimed = await transition(db, action, ['QUEUED'], 'EXECUTING', { attemptCount: { increment: 1 }, claimedAt, lastError: null });
  if (!claimed) return 'CLAIM_LOST';
  const attempt = action.attemptCount + 1;
  const view: ExternalActionView = { ...action, attemptCount: attempt };

  const check = await (deps.revalidate ?? workspaceActiveRevalidator)(view, db);
  if (!check.ok) {
    await db.$transaction(async (tx) => {
      await transition(tx, action, ['EXECUTING'], check.status, { statusReason: check.reason });
      const type = check.status === 'BLOCKED' ? 'ExternalActionBlocked' : check.status === 'CANCELLED' ? 'ExternalActionCancelled' : 'ExternalActionWaiting';
      await recordEvent(tx, source, type, action.id, { ...base, reason: check.reason });
    });
    return check.status;
  }

  let providerRef: string;
  try {
    providerRef = (await withTimeout((signal) => executor.execute(view, signal), deps.timeoutMs ?? 30_000)).providerRef;
  } catch (err) {
    return handleExecutionError(db, action, err, attempt, deps, source);
  }

  await db.$transaction(async (tx) => {
    const ok = await transition(tx, action, ['EXECUTING'], 'SUCCEEDED', { responseRef: providerRef, executedAt: new Date(), statusReason: null });
    if (!ok) throw new Error(`ExternalAction ${action.id} left EXECUTING while its call was in flight`);
    await recordEvent(tx, source, 'ExternalActionSucceeded', action.id, { ...base, providerRef, attempt });
  });
  return 'SUCCEEDED';
}

async function handleExecutionError(
  db: PrismaClient,
  action: ExternalAction,
  err: unknown,
  attempt: number,
  deps: ExecuteDeps,
  source: EventSource,
): Promise<ExecutionOutcome> {
  const base = { externalActionId: action.id, actionType: action.actionType };
  const reason = describeError(err).slice(0, 1000);
  const failure = classifyFailure(err);
  const definitelyNotSent = err instanceof RateLimitedError || (err instanceof ProviderError && err.code === 'PROVIDER_UNAVAILABLE');

  if (definitelyNotSent) {
    if (deps.finalAttempt) {
      await finish(db, action, 'FAILED', source, 'ExternalActionFailed', { ...base, reason: `Retries exhausted: ${reason}`, attempt });
      throw new RetryLaterError(reason, undefined, { cause: err }); // surfaces in the DLQ
    }
    await transition(db, action, ['EXECUTING'], 'QUEUED', { lastError: reason });
    throw new RetryLaterError(reason, failure.retryAfterMs, { cause: err });
  }
  if (failure.category === 'AUTH') {
    await finish(db, action, 'WAITING', source, 'ExternalActionWaiting', { ...base, reason });
    return 'WAITING';
  }
  if (failure.category === 'POLICY') {
    await finish(db, action, 'BLOCKED', source, 'ExternalActionBlocked', { ...base, reason });
    return 'BLOCKED';
  }
  if (!failure.retryable) {
    await finish(db, action, 'FAILED', source, 'ExternalActionFailed', { ...base, reason, attempt });
    return 'FAILED';
  }
  // Timeout, reset, unknown: the provider may have acted. Never resend blindly — reconcile on the next attempt.
  await transition(db, action, ['EXECUTING'], 'UNKNOWN_OUTCOME', { lastError: reason, statusReason: 'Outcome unknown — will reconcile' });
  throw new RetryLaterError(`Outcome unknown: ${reason}`, undefined, { cause: err });
}

async function finish<T extends 'ExternalActionFailed' | 'ExternalActionWaiting' | 'ExternalActionBlocked'>(
  db: PrismaClient,
  action: ExternalAction,
  to: ExternalActionStatus,
  source: EventSource,
  type: T,
  payload: Parameters<typeof recordEvent<T>>[4],
) {
  await db.$transaction(async (tx) => {
    const reason = (payload as { reason: string }).reason;
    if (await transition(tx, action, ['EXECUTING'], to, { lastError: reason, statusReason: reason })) {
      await recordEvent(tx, source, type, action.id, payload);
    }
  });
}

/** UNKNOWN_OUTCOME → ask the provider. Returns 'RETRY' when the provider confirms it never acted (now QUEUED). */
async function reconcile(db: PrismaClient, action: ExternalAction, executor: ActionExecutor, source: EventSource): Promise<ExecutionOutcome | 'RETRY'> {
  const base = { externalActionId: action.id, actionType: action.actionType };
  const result: ReconcileResult = executor.reconcile ? await executor.reconcile(action) : { status: 'UNDETERMINED' };

  if (result.status === 'SUCCEEDED') {
    await db.$transaction(async (tx) => {
      if (await transition(tx, action, ['UNKNOWN_OUTCOME'], 'SUCCEEDED', { responseRef: result.providerRef, executedAt: new Date(), statusReason: 'Reconciled with provider' })) {
        await recordEvent(tx, source, 'ExternalActionSucceeded', action.id, { ...base, providerRef: result.providerRef, attempt: action.attemptCount });
      }
    });
    return 'RECONCILED_SUCCEEDED';
  }
  if (result.status === 'NOT_FOUND') {
    await transition(db, action, ['UNKNOWN_OUTCOME'], 'QUEUED', { statusReason: 'Provider confirmed it never happened — safe to retry' });
    return 'RETRY';
  }
  await db.$transaction(async (tx) => {
    const reason = executor.reconcile ? 'Provider could not confirm whether the action happened' : 'Provider does not support reconciliation';
    await tx.externalAction.updateMany({ where: { id: action.id, status: 'UNKNOWN_OUTCOME' }, data: { statusReason: reason } });
    await recordEvent(tx, source, 'ExternalActionNeedsReview', action.id, { ...base, reason });
  });
  return 'NEEDS_REVIEW';
}

/**
 * Crash recovery sweep: actions EXECUTING longer than `staleAfterMs` lost their worker mid-call. Each moves to
 * UNKNOWN_OUTCOME and emits ExternalActionClaimExpired, whose consumer reconciles it (docs/11 §93-99).
 */
export async function expireStaleClaims(db: PrismaClient, staleAfterMs: number, limit = 100): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const stale = await db.externalAction.findMany({ where: { status: 'EXECUTING', claimedAt: { lt: cutoff } }, take: limit });
  let expired = 0;
  for (const action of stale) {
    await db.$transaction(async (tx) => {
      const moved = await transition(tx, action, ['EXECUTING'], 'UNKNOWN_OUTCOME', { statusReason: 'Worker claim expired mid-call' });
      if (!moved) return;
      expired++;
      await recordEvent(tx, { workspaceId: action.workspaceId, actor: SYSTEM }, 'ExternalActionClaimExpired', action.id, {
        externalActionId: action.id,
        actionType: action.actionType,
        claimedAt: action.claimedAt!.toISOString(),
      });
    });
  }
  return expired;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new JobTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
