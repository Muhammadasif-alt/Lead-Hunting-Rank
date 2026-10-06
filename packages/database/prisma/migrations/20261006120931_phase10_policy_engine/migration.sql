-- CreateEnum
CREATE TYPE "OutboundState" AS ENUM ('ACTIVE', 'PAUSED', 'EMERGENCY_STOP');

-- CreateEnum
CREATE TYPE "AutonomyLevel" AS ENUM ('L0', 'L1', 'L2', 'L3', 'L4');

-- CreateEnum
CREATE TYPE "PolicyOutcome" AS ENUM ('ACT', 'ASK', 'WAIT', 'BLOCK');

-- CreateEnum
CREATE TYPE "PolicyStage" AS ENUM ('PREPARE', 'APPROVAL', 'EXECUTION');

-- CreateEnum
CREATE TYPE "SuppressionScope" AS ENUM ('EMAIL', 'PHONE', 'PERSON', 'COMPANY', 'DOMAIN');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'DO_NOT_CONTACT', 'COMPLAINT', 'LEGAL', 'MANUAL', 'INVALID_CONTACT', 'BOUNCE_POLICY');

-- CreateEnum
CREATE TYPE "SuppressionStatus" AS ENUM ('ACTIVE', 'LIFTED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'INVALIDATED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'SUPPRESSION';
ALTER TYPE "EntityType" ADD VALUE 'APPROVAL_REQUEST';
ALTER TYPE "EntityType" ADD VALUE 'POLICY_DECISION';

-- AlterTable
ALTER TABLE "AgentDefinition" ADD COLUMN     "autonomyLevel" "AutonomyLevel";

-- AlterTable
ALTER TABLE "ExternalAction" ADD COLUMN     "requestedByAgent" TEXT,
ADD COLUMN     "requestedById" TEXT,
ADD COLUMN     "requestedByType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "resumeAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "autonomyLevel" "AutonomyLevel" NOT NULL DEFAULT 'L1',
ADD COLUMN     "outboundChangedAt" TIMESTAMPTZ(3),
ADD COLUMN     "outboundChangedBy" UUID,
ADD COLUMN     "outboundReason" TEXT,
ADD COLUMN     "outboundState" "OutboundState" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "Suppression" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "scope" "SuppressionScope" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "status" "SuppressionStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdByType" "ActorType" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMPTZ(3),
    "liftedById" UUID,
    "liftReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "stage" "PolicyStage" NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionClass" "ActionClass" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "agentType" TEXT,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "externalActionId" UUID,
    "decision" "PolicyOutcome" NOT NULL,
    "reasonCodes" TEXT[],
    "reasonSummary" TEXT NOT NULL,
    "matchedRules" TEXT[],
    "policyVersion" INTEGER NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "resumeAt" TIMESTAMPTZ(3),
    "fingerprint" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "externalActionId" UUID NOT NULL,
    "policyDecisionId" UUID,
    "actionType" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "requestedByType" "ActorType" NOT NULL,
    "requestedById" TEXT,
    "requestedByAgent" TEXT,
    "payloadSnapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "reasonCodes" TEXT[],
    "reason" TEXT NOT NULL,
    "requiredPermission" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Suppression_workspaceId_scope_value_status_idx" ON "Suppression"("workspaceId", "scope", "value", "status");

-- CreateIndex
CREATE INDEX "Suppression_workspaceId_status_createdAt_idx" ON "Suppression"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PolicyDecision_workspaceId_evaluatedAt_idx" ON "PolicyDecision"("workspaceId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "PolicyDecision_workspaceId_externalActionId_idx" ON "PolicyDecision"("workspaceId", "externalActionId");

-- CreateIndex
CREATE INDEX "PolicyDecision_workspaceId_decision_evaluatedAt_idx" ON "PolicyDecision"("workspaceId", "decision", "evaluatedAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_workspaceId_status_createdAt_idx" ON "ApprovalRequest"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_workspaceId_externalActionId_idx" ON "ApprovalRequest"("workspaceId", "externalActionId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_expiresAt_idx" ON "ApprovalRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ExternalAction_status_resumeAt_idx" ON "ExternalAction"("status", "resumeAt");

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One ACTIVE suppression per scope + value (lifted rows are history and may repeat).
CREATE UNIQUE INDEX "Suppression_active_key" ON "Suppression"("workspaceId", "scope", "value") WHERE "status" = 'ACTIVE';

-- Suppressions are never deleted: a removed row could let a blocked contact be emailed again (docs/10 §103-109).
CREATE OR REPLACE FUNCTION suppression_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Suppression rows cannot be deleted; lift them instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER suppression_no_delete BEFORE DELETE ON "Suppression" FOR EACH ROW EXECUTE FUNCTION suppression_no_delete();

-- A policy decision is a record of what was decided; it is never rewritten.
CREATE OR REPLACE FUNCTION policy_decision_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PolicyDecision rows are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER policy_decision_append_only BEFORE UPDATE OR DELETE ON "PolicyDecision" FOR EACH ROW EXECUTE FUNCTION policy_decision_append_only();
