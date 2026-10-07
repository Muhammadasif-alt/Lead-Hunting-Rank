-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'PAUSED', 'BLOCKED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignObjective" AS ENUM ('START_CONVERSATIONS', 'BOOK_MEETINGS', 'QUOTE_REQUESTS', 'REENGAGE', 'VALIDATE_MARKET');

-- CreateEnum
CREATE TYPE "CampaignStepKind" AS ENUM ('FIRST_TOUCH', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ELIGIBLE', 'ENROLLED', 'ACTIVE', 'REPLIED', 'PAUSED', 'COMPLETED', 'REMOVED', 'SUPPRESSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CampaignMessageStatus" AS ENUM ('DRAFT_REJECTED', 'PENDING_APPROVAL', 'WAITING', 'QUEUED', 'SENT', 'BLOCKED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "MailboxMessageKind" AS ENUM ('REPLY', 'AUTO_REPLY', 'UNSUBSCRIBE', 'BOUNCE', 'UNMATCHED');

-- AlterEnum
ALTER TYPE "AgentType" ADD VALUE 'CAMPAIGN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'CAMPAIGN';
ALTER TYPE "EntityType" ADD VALUE 'CAMPAIGN_ENROLLMENT';
ALTER TYPE "EntityType" ADD VALUE 'CAMPAIGN_MESSAGE';
ALTER TYPE "EntityType" ADD VALUE 'MAILBOX_MESSAGE';

-- AlterTable
ALTER TABLE "ExternalAction" ADD COLUMN     "responseMeta" JSONB;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "objective" "CampaignObjective" NOT NULL DEFAULT 'START_CONVERSATIONS',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "statusReason" TEXT,
    "offer" TEXT NOT NULL DEFAULT '',
    "audience" JSONB NOT NULL DEFAULT '{}',
    "strategy" JSONB NOT NULL DEFAULT '{}',
    "mailboxIntegrationId" UUID,
    "senderName" TEXT NOT NULL DEFAULT '',
    "cohortSize" INTEGER NOT NULL DEFAULT 25,
    "dailyNewLimit" INTEGER NOT NULL DEFAULT 20,
    "checks" JSONB,
    "checkedAt" TIMESTAMPTZ(3),
    "launchedAt" TIMESTAMPTZ(3),
    "pausedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignStep" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "CampaignStepKind" NOT NULL,
    "delayDays" INTEGER NOT NULL,
    "angle" TEXT NOT NULL DEFAULT 'FIRST_TOUCH',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEnrollment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "personId" UUID,
    "contactPointId" UUID,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "statusReason" TEXT,
    "nextStepPosition" INTEGER NOT NULL DEFAULT 1,
    "nextStepDueAt" TIMESTAMPTZ(3),
    "threadRef" TEXT,
    "lastSentAt" TIMESTAMPTZ(3),
    "repliedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "eligibilitySnapshot" JSONB NOT NULL DEFAULT '{}',
    "unsubscribeToken" TEXT NOT NULL,
    "enrolledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CampaignEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMessage" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "stepId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "agentTaskId" UUID,
    "externalActionId" UUID,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "claims" JSONB NOT NULL DEFAULT '[]',
    "status" "CampaignMessageStatus" NOT NULL,
    "statusReason" TEXT,
    "providerMessageId" TEXT,
    "threadRef" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CampaignMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxMessage" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "threadRef" TEXT,
    "fromEmail" TEXT NOT NULL,
    "toEmails" TEXT[],
    "subject" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "kind" "MailboxMessageKind" NOT NULL,
    "campaignId" UUID,
    "enrollmentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxCursor" (
    "integrationId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "cursor" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MailboxCursor_pkey" PRIMARY KEY ("integrationId")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_status_idx" ON "Campaign"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_workspaceId_id_key" ON "Campaign"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStep_workspaceId_id_key" ON "CampaignStep"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStep_campaignId_position_key" ON "CampaignStep"("campaignId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEnrollment_unsubscribeToken_key" ON "CampaignEnrollment"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "CampaignEnrollment_workspaceId_status_nextStepDueAt_idx" ON "CampaignEnrollment"("workspaceId", "status", "nextStepDueAt");

-- CreateIndex
CREATE INDEX "CampaignEnrollment_workspaceId_email_idx" ON "CampaignEnrollment"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "CampaignEnrollment_threadRef_idx" ON "CampaignEnrollment"("threadRef");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEnrollment_workspaceId_id_key" ON "CampaignEnrollment"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEnrollment_campaignId_companyId_key" ON "CampaignEnrollment"("campaignId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_externalActionId_key" ON "CampaignMessage"("externalActionId");

-- CreateIndex
CREATE INDEX "CampaignMessage_workspaceId_campaignId_createdAt_idx" ON "CampaignMessage"("workspaceId", "campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_enrollmentId_stepId_key" ON "CampaignMessage"("enrollmentId", "stepId");

-- CreateIndex
CREATE INDEX "MailboxMessage_workspaceId_enrollmentId_idx" ON "MailboxMessage"("workspaceId", "enrollmentId");

-- CreateIndex
CREATE INDEX "MailboxMessage_workspaceId_occurredAt_idx" ON "MailboxMessage"("workspaceId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxMessage_integrationId_providerMessageId_key" ON "MailboxMessage"("integrationId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_integrationId_key" ON "IntegrationCredential"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_stateHash_key" ON "OAuthState"("stateHash");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_workspaceId_campaignId_fkey" FOREIGN KEY ("workspaceId", "campaignId") REFERENCES "Campaign"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEnrollment" ADD CONSTRAINT "CampaignEnrollment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEnrollment" ADD CONSTRAINT "CampaignEnrollment_workspaceId_campaignId_fkey" FOREIGN KEY ("workspaceId", "campaignId") REFERENCES "Campaign"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_workspaceId_campaignId_fkey" FOREIGN KEY ("workspaceId", "campaignId") REFERENCES "Campaign"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_workspaceId_enrollmentId_fkey" FOREIGN KEY ("workspaceId", "enrollmentId") REFERENCES "CampaignEnrollment"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_workspaceId_stepId_fkey" FOREIGN KEY ("workspaceId", "stepId") REFERENCES "CampaignStep"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxMessage" ADD CONSTRAINT "MailboxMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxCursor" ADD CONSTRAINT "MailboxCursor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one live (not-ended) enrollment per email across ACTIVE campaigns is enforced in code (campaign conflict
-- resolver); here the database guarantees one message per step and one action per message (unique indexes above).
