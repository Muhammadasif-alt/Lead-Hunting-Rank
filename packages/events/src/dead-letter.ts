import type { Prisma, PrismaClient } from '@revenue-os/database';
import type { FailureCategory } from '@revenue-os/shared';

export interface DeadLetterInput {
  queue: string;
  jobName: string;
  jobId?: string;
  jobData: Record<string, unknown>;
  failureCategory: FailureCategory;
  lastError: string;
  attempts: number;
}

/** Entity a job is about, read from conventional payload fields — for the admin "which record failed?" column. */
function entityOf(data: Record<string, unknown>): { entityType?: string; entityId?: string } {
  for (const [field, type] of [
    ['externalActionId', 'EXTERNAL_ACTION'],
    ['companyId', 'COMPANY'],
    ['personId', 'PERSON'],
  ] as const) {
    if (typeof data[field] === 'string') return { entityType: type, entityId: data[field] as string };
  }
  return {};
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/**
 * Persists a job that will not be retried any more (docs/11 §44-47). A job that was itself a DLQ retry
 * (carries deadLetterId) updates its original record instead of creating a second one.
 */
export async function recordDeadLetter(db: PrismaClient, input: DeadLetterInput): Promise<string> {
  const data = input.jobData;
  const common = {
    failureCategory: input.failureCategory,
    lastError: input.lastError.slice(0, 2000),
    attempts: input.attempts,
    lastFailedAt: new Date(),
  };
  const existingId = str(data.deadLetterId);
  if (existingId) {
    const { count } = await db.deadLetterRecord.updateMany({ where: { id: existingId }, data: { ...common, status: 'OPEN', jobId: input.jobId } });
    if (count === 1) return existingId;
  }
  const { deadLetterId: _drop, ...jobData } = data;
  const row = await db.deadLetterRecord.create({
    data: {
      ...common,
      workspaceId: str(data.workspaceId),
      queue: input.queue,
      jobName: input.jobName,
      jobId: input.jobId,
      jobData: jobData as Prisma.InputJsonValue,
      correlationId: str(data.correlationId),
      ...entityOf(data),
    },
  });
  return row.id;
}

/** A retried dead letter succeeded. */
export async function resolveDeadLetter(db: PrismaClient, id: string): Promise<void> {
  await db.deadLetterRecord.updateMany({
    where: { id, status: { in: ['OPEN', 'RETRY_SCHEDULED'] } },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolutionNote: 'Retry succeeded' },
  });
}
