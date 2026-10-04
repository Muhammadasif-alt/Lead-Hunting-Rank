-- CreateEnum
CREATE TYPE "DeadLetterStatus" AS ENUM ('OPEN', 'RETRY_SCHEDULED', 'RESOLVED', 'IGNORED');

-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'EXTERNAL_ACTION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExternalActionStatus" ADD VALUE 'WAITING_APPROVAL';
ALTER TYPE "ExternalActionStatus" ADD VALUE 'WAITING';
ALTER TYPE "ExternalActionStatus" ADD VALUE 'UNKNOWN_OUTCOME';

-- AlterTable
ALTER TABLE "ExternalAction" ADD COLUMN     "causationId" TEXT,
ADD COLUMN     "claimedAt" TIMESTAMPTZ(3),
ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "payload" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "payloadHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "statusReason" TEXT;

-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "causationId" TEXT,
ADD COLUMN     "correlationId" TEXT;

-- CreateTable
CREATE TABLE "DeadLetterRecord" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "queue" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobId" TEXT,
    "jobData" JSONB NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "correlationId" TEXT,
    "failureCategory" TEXT NOT NULL,
    "lastError" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "status" "DeadLetterStatus" NOT NULL DEFAULT 'OPEN',
    "firstFailedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFailedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedBy" UUID,
    "resolutionNote" TEXT,

    CONSTRAINT "DeadLetterRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxReceipt" (
    "consumer" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxReceipt_pkey" PRIMARY KEY ("consumer","eventId")
);

-- CreateIndex
CREATE INDEX "DeadLetterRecord_status_lastFailedAt_idx" ON "DeadLetterRecord"("status", "lastFailedAt");

-- CreateIndex
CREATE INDEX "DeadLetterRecord_workspaceId_status_idx" ON "DeadLetterRecord"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "DeadLetterRecord_correlationId_idx" ON "DeadLetterRecord"("correlationId");

-- CreateIndex
CREATE INDEX "ExternalAction_status_claimedAt_idx" ON "ExternalAction"("status", "claimedAt");

-- ───────────── hand-written (Prisma can't express these) ─────────────

-- Domain events are immutable facts (docs/07 §90): a correction is a new event, never an edit.
CREATE FUNCTION domain_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DomainEvent is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "DomainEvent_append_only"
  BEFORE UPDATE OR DELETE ON "DomainEvent"
  FOR EACH ROW EXECUTE FUNCTION domain_event_immutable();
CREATE TRIGGER "DomainEvent_no_truncate"
  BEFORE TRUNCATE ON "DomainEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION domain_event_immutable();

-- A SUCCEEDED external action never runs again under the same idempotency key (docs/07 §101),
-- and its idempotency key / payload are frozen once prepared. Enforced here as a last line of defence.
CREATE FUNCTION external_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'SUCCEEDED' AND NEW.status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'ExternalAction % already SUCCEEDED', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."idempotencyKey" <> OLD."idempotencyKey" OR NEW."payloadHash" <> OLD."payloadHash" THEN
    RAISE EXCEPTION 'ExternalAction % idempotency key and payload are immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ExternalAction_guard"
  BEFORE UPDATE ON "ExternalAction"
  FOR EACH ROW EXECUTE FUNCTION external_action_guard();

ALTER TABLE "ExternalAction" ADD CONSTRAINT "ExternalAction_attempts_nonneg" CHECK ("attemptCount" >= 0);
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_attempts_nonneg" CHECK ("attemptCount" >= 0);
ALTER TABLE "DeadLetterRecord" ADD CONSTRAINT "DeadLetterRecord_attempts_nonneg" CHECK ("attempts" >= 0 AND "retryCount" >= 0);

-- Dispatcher hot path: oldest pending first.
CREATE INDEX "OutboxEvent_pending_idx" ON "OutboxEvent"("availableAt", "createdAt") WHERE status = 'PENDING';
