-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('CANDIDATE', 'DETECTED', 'VALIDATED', 'ACTIONABLE', 'MONITOR', 'DISMISSED', 'EXPIRED', 'ACTED_ON');

-- CreateEnum
CREATE TYPE "SignalStrength" AS ENUM ('STRONG', 'MEDIUM', 'WEAK');

-- CreateEnum
CREATE TYPE "WatchlistPriority" AS ENUM ('HIGH', 'NORMAL', 'LOW');

-- AlterEnum
ALTER TYPE "AgentType" ADD VALUE 'SIGNAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'SIGNAL';
ALTER TYPE "EntityType" ADD VALUE 'SIGNAL_WATCHLIST';
ALTER TYPE "EntityType" ADD VALUE 'SIGNAL_RULE';

-- AlterEnum
ALTER TYPE "ResearchTrigger" ADD VALUE 'MONITOR';

-- CreateTable
CREATE TABLE "Signal" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "personId" UUID,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "SignalStatus" NOT NULL DEFAULT 'DETECTED',
    "statusReason" TEXT,
    "strength" "SignalStrength" NOT NULL,
    "relevance" JSONB NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "change" JSONB,
    "sourceKind" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "interpretation" TEXT,
    "interpretationSource" "HypothesisSource",
    "whyNow" TEXT,
    "hypothesisId" UUID,
    "opportunityId" UUID,
    "conversationId" UUID,
    "commitmentId" UUID,
    "marketId" UUID,
    "recommendedAction" TEXT NOT NULL,
    "autoActions" TEXT[],
    "ruleIds" UUID[],
    "campaignCandidate" BOOLEAN NOT NULL DEFAULT false,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "detectedAt" TIMESTAMPTZ(3) NOT NULL,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "windowEndsAt" TIMESTAMPTZ(3),
    "actedAction" TEXT,
    "actedAt" TIMESTAMPTZ(3),
    "actedById" UUID,
    "feedback" TEXT,
    "feedbackNote" TEXT,
    "dismissedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalEvidence" (
    "workspaceId" UUID NOT NULL,
    "signalId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalEvidence_pkey" PRIMARY KEY ("signalId","evidenceId")
);

-- CreateTable
CREATE TABLE "SignalWatchlist" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'MANUAL',
    "priority" "WatchlistPriority" NOT NULL DEFAULT 'NORMAL',
    "marketId" UUID,
    "monitors" JSONB NOT NULL DEFAULT '{}',
    "lastSweepAt" TIMESTAMPTZ(3),
    "createdBy" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SignalWatchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalWatchlistMember" (
    "workspaceId" UUID NOT NULL,
    "watchlistId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "reason" TEXT,
    "addedBy" UUID,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "nextCheckAt" TIMESTAMPTZ(3),

    CONSTRAINT "SignalWatchlistMember_pkey" PRIMARY KEY ("watchlistId","companyId")
);

-- CreateTable
CREATE TABLE "SignalRule" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "actions" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "lastMatchedAt" TIMESTAMPTZ(3),
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SignalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalObservation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "changeLevel" TEXT NOT NULL,
    "detail" TEXT,
    "signalId" UUID,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Signal_workspaceId_status_strength_detectedAt_idx" ON "Signal"("workspaceId", "status", "strength", "detectedAt");

-- CreateIndex
CREATE INDEX "Signal_workspaceId_companyId_detectedAt_idx" ON "Signal"("workspaceId", "companyId", "detectedAt");

-- CreateIndex
CREATE INDEX "Signal_workspaceId_companyId_type_subject_status_idx" ON "Signal"("workspaceId", "companyId", "type", "subject", "status");

-- CreateIndex
CREATE INDEX "Signal_workspaceId_type_detectedAt_idx" ON "Signal"("workspaceId", "type", "detectedAt");

-- CreateIndex
CREATE INDEX "Signal_workspaceId_expiresAt_idx" ON "Signal"("workspaceId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_workspaceId_id_key" ON "Signal"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_workspaceId_dedupeKey_key" ON "Signal"("workspaceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "SignalEvidence_workspaceId_evidenceId_idx" ON "SignalEvidence"("workspaceId", "evidenceId");

-- CreateIndex
CREATE INDEX "SignalWatchlist_workspaceId_kind_idx" ON "SignalWatchlist"("workspaceId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SignalWatchlist_workspaceId_id_key" ON "SignalWatchlist"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SignalWatchlist_workspaceId_name_key" ON "SignalWatchlist"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "SignalWatchlistMember_workspaceId_companyId_idx" ON "SignalWatchlistMember"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "SignalWatchlistMember_workspaceId_nextCheckAt_idx" ON "SignalWatchlistMember"("workspaceId", "nextCheckAt");

-- CreateIndex
CREATE INDEX "SignalRule_workspaceId_enabled_position_idx" ON "SignalRule"("workspaceId", "enabled", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SignalRule_workspaceId_id_key" ON "SignalRule"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "SignalObservation_workspaceId_observedAt_idx" ON "SignalObservation"("workspaceId", "observedAt");

-- CreateIndex
CREATE INDEX "SignalObservation_workspaceId_companyId_observedAt_idx" ON "SignalObservation"("workspaceId", "companyId", "observedAt");

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvidence" ADD CONSTRAINT "SignalEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvidence" ADD CONSTRAINT "SignalEvidence_workspaceId_signalId_fkey" FOREIGN KEY ("workspaceId", "signalId") REFERENCES "Signal"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvidence" ADD CONSTRAINT "SignalEvidence_workspaceId_evidenceId_fkey" FOREIGN KEY ("workspaceId", "evidenceId") REFERENCES "Evidence"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalWatchlist" ADD CONSTRAINT "SignalWatchlist_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalWatchlistMember" ADD CONSTRAINT "SignalWatchlistMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalWatchlistMember" ADD CONSTRAINT "SignalWatchlistMember_workspaceId_watchlistId_fkey" FOREIGN KEY ("workspaceId", "watchlistId") REFERENCES "SignalWatchlist"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalWatchlistMember" ADD CONSTRAINT "SignalWatchlistMember_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalRule" ADD CONSTRAINT "SignalRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalObservation" ADD CONSTRAINT "SignalObservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalObservation" ADD CONSTRAINT "SignalObservation_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
