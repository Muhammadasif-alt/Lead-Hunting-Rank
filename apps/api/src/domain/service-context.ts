import { Prisma, type ActorType, type EntityType, type PrismaClient } from '@revenue-os/database';
import { NotFoundError } from '@revenue-os/shared';
import { getContext } from '@revenue-os/shared/server';

export type Tx = Prisma.TransactionClient;

/**
 * Who is acting, in which workspace. Application services take this explicitly and never trust a userId or
 * workspaceId from request bodies (docs/14 §6-12). From Phase 3 it is built from the authenticated session.
 */
export interface ServiceContext {
  workspaceId: string;
  actor: { type: ActorType; id: string | null };
}

/** UUID of the acting user for created_by/updated_by columns (null for system/AI actors). */
export function actorUserId(ctx: ServiceContext): string | null {
  return ctx.actor.type === 'HUMAN' ? ctx.actor.id : null;
}

/** Append-only audit entry, written inside the caller's transaction so it commits or rolls back with the change. */
export async function writeAudit(
  tx: Tx,
  ctx: ServiceContext,
  entry: { action: string; entityType: EntityType; entityId: string; before?: unknown; after?: unknown; reason?: string },
): Promise<void> {
  const exec = getContext();
  await tx.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeJson: toJson(entry.before),
      afterJson: toJson(entry.after),
      reason: entry.reason,
      requestId: exec?.requestId,
      correlationId: exec?.correlationId,
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}

/** Throws NotFound unless the COMPANY/PERSON exists in this workspace (polymorphic refs have no FK). */
export async function assertEntityInWorkspace(
  db: Tx | PrismaClient,
  workspaceId: string,
  entityType: EntityType,
  entityId: string,
): Promise<void> {
  const where = { id: entityId, workspaceId };
  const found =
    entityType === 'COMPANY'
      ? await db.company.findFirst({ where, select: { id: true } })
      : entityType === 'PERSON'
        ? await db.person.findFirst({ where, select: { id: true } })
        : null;
  if (!found) throw new NotFoundError(`${entityType.toLowerCase()} ${entityId} not found`);
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
