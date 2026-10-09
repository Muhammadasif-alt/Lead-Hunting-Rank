/*
  Warnings:

  - Added the required column `semantic` to the `PipelineStage` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "StageSemantic" AS ENUM ('NEW', 'DISCOVERY', 'QUALIFIED', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'NURTURE');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StakeholderRole" AS ENUM ('DECISION_MAKER', 'INFLUENCER', 'USER', 'CHAMPION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "StakeholderStatus" AS ENUM ('SUGGESTED', 'KNOWN', 'ENGAGED', 'NOT_CONTACTED');

-- CreateEnum
CREATE TYPE "LossReason" AS ENUM ('PRICE', 'TIMING', 'COMPETITOR', 'NO_BUDGET', 'NO_NEED', 'INTERNAL_DECISION', 'NO_RESPONSE', 'TECHNICAL_FIT', 'WRONG_PROSPECT', 'OTHER');

-- CreateEnum
CREATE TYPE "QualificationStatus" AS ENUM ('UNQUALIFIED', 'PARTIAL', 'QUALIFIED');

-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'OPPORTUNITY';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "commercialSignal" JSONB,
ADD COLUMN     "opportunityId" UUID;

-- AlterTable
-- No opportunity existed before this phase: replace the default stages with ones that carry a meaning.
DELETE FROM "PipelineStage";
ALTER TABLE "PipelineStage" ADD COLUMN     "semantic" "StageSemantic" NOT NULL;
INSERT INTO "PipelineStage" ("id", "workspaceId", "pipelineId", "name", "position", "stageType", "semantic", "isClosed", "isWon", "isLost", "updatedAt")
SELECT gen_random_uuid(), p."workspaceId", p."id", s.name, s.position, s.stage_type::"StageType", s.semantic::"StageSemantic", s.stage_type <> 'OPEN', s.stage_type = 'WON', s.stage_type = 'LOST', now()
FROM "Pipeline" p
CROSS JOIN (VALUES
  ('New', 0, 'OPEN', 'NEW'),
  ('Discovery', 1, 'OPEN', 'DISCOVERY'),
  ('Qualified', 2, 'OPEN', 'QUALIFIED'),
  ('Meeting', 3, 'OPEN', 'MEETING'),
  ('Proposal', 4, 'OPEN', 'PROPOSAL'),
  ('Negotiation', 5, 'OPEN', 'NEGOTIATION'),
  ('Won', 6, 'WON', 'WON'),
  ('Lost', 7, 'LOST', 'LOST'),
  ('Nurture', 8, 'OPEN', 'NURTURE')
) AS s(name, position, stage_type, semantic);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "primaryPersonId" UUID,
    "name" TEXT NOT NULL,
    "service" TEXT,
    "pipelineId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "amountMinor" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "ownerUserId" UUID,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "conversationId" UUID,
    "campaignId" UUID,
    "originReason" TEXT,
    "originQuote" TEXT,
    "createdByType" "ActorType" NOT NULL,
    "createdById" TEXT,
    "nextActionOverride" TEXT,
    "nextActionDueAt" TIMESTAMPTZ(3),
    "stageEnteredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "wonAmountMinor" INTEGER,
    "wonNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityStageHistory" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "fromStageId" UUID,
    "toStageId" UUID NOT NULL,
    "fromSemantic" "StageSemantic",
    "toSemantic" "StageSemantic" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityStakeholder" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "personId" UUID,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "role" "StakeholderRole" NOT NULL DEFAULT 'UNKNOWN',
    "influence" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "status" "StakeholderStatus" NOT NULL DEFAULT 'KNOWN',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "quote" TEXT,
    "messageId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OpportunityStakeholder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityLoss" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "reasonCode" "LossReason" NOT NULL,
    "details" TEXT,
    "competitor" TEXT,
    "revisitAt" TIMESTAMPTZ(3),
    "evidenceQuote" TEXT,
    "suggested" BOOLEAN NOT NULL DEFAULT false,
    "decidedById" UUID,
    "lostAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedAt" TIMESTAMPTZ(3),

    CONSTRAINT "OpportunityLoss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Qualification" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "status" "QualificationStatus" NOT NULL DEFAULT 'UNQUALIFIED',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Qualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationAnswer" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "qualificationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "source" TEXT NOT NULL,
    "sourceMessageId" UUID,
    "quote" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" UUID,
    "createdById" TEXT,
    "supersededAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualificationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_status_stageId_idx" ON "Opportunity"("workspaceId", "status", "stageId");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_companyId_idx" ON "Opportunity"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Opportunity_workspaceId_ownerUserId_idx" ON "Opportunity"("workspaceId", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_workspaceId_id_key" ON "Opportunity"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "OpportunityStageHistory_opportunityId_changedAt_idx" ON "OpportunityStageHistory"("opportunityId", "changedAt");

-- CreateIndex
CREATE INDEX "OpportunityStageHistory_workspaceId_toSemantic_changedAt_idx" ON "OpportunityStageHistory"("workspaceId", "toSemantic", "changedAt");

-- CreateIndex
CREATE INDEX "OpportunityStakeholder_opportunityId_idx" ON "OpportunityStakeholder"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityStakeholder_opportunityId_personId_key" ON "OpportunityStakeholder"("opportunityId", "personId");

-- CreateIndex
CREATE INDEX "OpportunityLoss_opportunityId_lostAt_idx" ON "OpportunityLoss"("opportunityId", "lostAt");

-- CreateIndex
CREATE INDEX "OpportunityLoss_workspaceId_reasonCode_idx" ON "OpportunityLoss"("workspaceId", "reasonCode");

-- CreateIndex
CREATE UNIQUE INDEX "Qualification_opportunityId_key" ON "Qualification"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "Qualification_workspaceId_id_key" ON "Qualification"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Qualification_workspaceId_opportunityId_key" ON "Qualification"("workspaceId", "opportunityId");

-- CreateIndex
CREATE INDEX "QualificationAnswer_qualificationId_key_supersededAt_idx" ON "QualificationAnswer"("qualificationId", "key", "supersededAt");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "Opportunity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStakeholder" ADD CONSTRAINT "OpportunityStakeholder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStakeholder" ADD CONSTRAINT "OpportunityStakeholder_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "Opportunity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityLoss" ADD CONSTRAINT "OpportunityLoss_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityLoss" ADD CONSTRAINT "OpportunityLoss_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "Opportunity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Qualification" ADD CONSTRAINT "Qualification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Qualification" ADD CONSTRAINT "Qualification_workspaceId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "Opportunity"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationAnswer" ADD CONSTRAINT "QualificationAnswer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationAnswer" ADD CONSTRAINT "QualificationAnswer_workspaceId_qualificationId_fkey" FOREIGN KEY ("workspaceId", "qualificationId") REFERENCES "Qualification"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
