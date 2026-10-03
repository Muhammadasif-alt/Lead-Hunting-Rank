import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Who/what the current unit of work belongs to. One per HTTP request or queue job.
 * The logger reads it automatically, so every log line carries these IDs without passing them around.
 *
 * - requestId:     one HTTP request (API only)
 * - correlationId: one logical workflow — follows API → event → job → provider (Tech Spec #7 §105-109)
 * - causationId:   the event/job that directly caused this one
 */
export interface ExecutionContext {
  correlationId: string;
  requestId?: string;
  causationId?: string;
  workspaceId?: string;
  actorType?: 'user' | 'ai' | 'system';
  actorId?: string;
  jobId?: string;
  jobType?: string;
}

const storage = new AsyncLocalStorage<ExecutionContext>();

export function runWithContext<T>(context: ExecutionContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): ExecutionContext | undefined {
  return storage.getStore();
}

/** Adds fields once they're known (e.g. workspaceId/actorId after authentication in Phase 3). */
export function updateContext(fields: Partial<Omit<ExecutionContext, 'correlationId'>>): void {
  const current = storage.getStore();
  if (current) Object.assign(current, fields);
}

export function newId(): string {
  return randomUUID();
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Accepts a client-supplied tracing ID only if it is short and plain — anything else is replaced.
 * The server always owns tracing identity (Tech Spec #10 §96-101).
 */
export function acceptExternalId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : undefined;
}
