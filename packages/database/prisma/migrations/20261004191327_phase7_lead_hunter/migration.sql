-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DiscoveryMode" AS ENUM ('QUICK', 'DEEP', 'MARKET_EXHAUST', 'REFRESH', 'MONITOR');

-- CreateEnum
CREATE TYPE "DiscoveryMissionStatus" AS ENUM ('DRAFT', 'READY', 'PLANNING', 'DISCOVERING', 'RESOLVING', 'ENRICHING', 'ASSESSING_COVERAGE', 'COMPLETED', 'PAUSED', 'WAITING', 'BLOCKED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscoveryStopReason" AS ENUM ('SATURATED', 'STRATEGIES_EXHAUSTED', 'ROUND_LIMIT', 'QUERY_BUDGET', 'CALL_BUDGET', 'STOPPED_BY_USER');

-- CreateEnum
CREATE TYPE "QueryStrategyType" AS ENUM ('PRIMARY_CATEGORY', 'RELATED_CATEGORY', 'KEYWORD_VARIANT', 'GEO_VARIANT');

-- CreateEnum
CREATE TYPE "DiscoveryQueryStatus" AS ENUM ('PLANNED', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ObservationStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ObservationOutcome" AS ENUM ('CREATED', 'MATCHED_EXISTING', 'DUPLICATE_LISTING');

-- CreateEnum
CREATE TYPE "CoverageDecision" AS ENUM ('CONTINUE', 'COMPLETE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'MARKET';
ALTER TYPE "EntityType" ADD VALUE 'DISCOVERY_MISSION';

-- CreateTable
CREATE TABLE "Market" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "region" TEXT,
    "city" TEXT,
    "industry" TEXT NOT NULL,
    "relatedCategories" TEXT[],
    "status" "MarketStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastDiscoveryAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryMission" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "mode" "DiscoveryMode" NOT NULL,
    "status" "DiscoveryMissionStatus" NOT NULL DEFAULT 'PLANNING',
    "request" TEXT,
    "interpretation" JSONB,
    "categories" TEXT[],
    "maxRounds" INTEGER NOT NULL,
    "maxQueries" INTEGER NOT NULL,
    "maxProviderCalls" INTEGER NOT NULL,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "queriesExecuted" INTEGER NOT NULL DEFAULT 0,
    "providerCalls" INTEGER NOT NULL DEFAULT 0,
    "failedQueries" INTEGER NOT NULL DEFAULT 0,
    "observationsCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueCompanies" INTEGER NOT NULL DEFAULT 0,
    "newCompanies" INTEGER NOT NULL DEFAULT 0,
    "matchedExisting" INTEGER NOT NULL DEFAULT 0,
    "duplicateObservations" INTEGER NOT NULL DEFAULT 0,
    "reviewCandidates" INTEGER NOT NULL DEFAULT 0,
    "rejectedObservations" INTEGER NOT NULL DEFAULT 0,
    "withWebsite" INTEGER NOT NULL DEFAULT 0,
    "withoutWebsite" INTEGER NOT NULL DEFAULT 0,
    "withPhone" INTEGER NOT NULL DEFAULT 0,
    "sourcesUsed" TEXT[],
    "coverageConfidence" "ConfidenceLevel",
    "stopReason" "DiscoveryStopReason",
    "statusReason" TEXT,
    "resumeStatus" "DiscoveryMissionStatus",
    "retryAt" TIMESTAMPTZ(3),
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "createdBy" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DiscoveryMission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryQuery" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "missionId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "queryType" "QueryStrategyType" NOT NULL,
    "strategyKey" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keyword" TEXT,
    "provider" TEXT NOT NULL,
    "integrationId" UUID,
    "status" "DiscoveryQueryStatus" NOT NULL DEFAULT 'PLANNED',
    "cursor" TEXT,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "pageLimit" INTEGER NOT NULL,
    "exhausted" BOOLEAN NOT NULL DEFAULT false,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "newUniqueCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "errorKind" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryObservation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "missionId" UUID NOT NULL,
    "queryId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "integrationId" UUID,
    "sourceRecordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "phone" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" CHAR(2),
    "category" TEXT,
    "rawPayload" JSONB NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ObservationStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" "ObservationOutcome",
    "companyId" UUID,
    "evidenceId" UUID,
    "matchScore" INTEGER,
    "matchConfidence" "ConfidenceLevel",
    "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
    "rejectReason" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageAssessment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "missionId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "queries" INTEGER NOT NULL,
    "observations" INTEGER NOT NULL,
    "newUnique" INTEGER NOT NULL,
    "cumulativeUnique" INTEGER NOT NULL,
    "marginalYield" DOUBLE PRECISION NOT NULL,
    "duplicateRate" DOUBLE PRECISION NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "decision" "CoverageDecision" NOT NULL,
    "stopReason" "DiscoveryStopReason",
    "reasons" TEXT[],
    "strategiesRemaining" INTEGER NOT NULL,
    "assessedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Market_workspaceId_id_key" ON "Market"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Market_workspaceId_marketKey_key" ON "Market"("workspaceId", "marketKey");

-- CreateIndex
CREATE INDEX "DiscoveryMission_workspaceId_createdAt_idx" ON "DiscoveryMission"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscoveryMission_workspaceId_marketId_status_idx" ON "DiscoveryMission"("workspaceId", "marketId", "status");

-- CreateIndex
CREATE INDEX "DiscoveryMission_status_leaseUntil_idx" ON "DiscoveryMission"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryMission_workspaceId_id_key" ON "DiscoveryMission"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "DiscoveryQuery_missionId_round_status_idx" ON "DiscoveryQuery"("missionId", "round", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryQuery_workspaceId_id_key" ON "DiscoveryQuery"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryQuery_missionId_provider_strategyKey_key" ON "DiscoveryQuery"("missionId", "provider", "strategyKey");

-- CreateIndex
CREATE INDEX "DiscoveryObservation_missionId_status_idx" ON "DiscoveryObservation"("missionId", "status");

-- CreateIndex
CREATE INDEX "DiscoveryObservation_missionId_companyId_idx" ON "DiscoveryObservation"("missionId", "companyId");

-- CreateIndex
CREATE INDEX "DiscoveryObservation_workspaceId_companyId_idx" ON "DiscoveryObservation"("workspaceId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryObservation_missionId_provider_sourceRecordId_key" ON "DiscoveryObservation"("missionId", "provider", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageAssessment_missionId_round_key" ON "CoverageAssessment"("missionId", "round");

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryMission" ADD CONSTRAINT "DiscoveryMission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryMission" ADD CONSTRAINT "DiscoveryMission_workspaceId_marketId_fkey" FOREIGN KEY ("workspaceId", "marketId") REFERENCES "Market"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryQuery" ADD CONSTRAINT "DiscoveryQuery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryQuery" ADD CONSTRAINT "DiscoveryQuery_workspaceId_missionId_fkey" FOREIGN KEY ("workspaceId", "missionId") REFERENCES "DiscoveryMission"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryObservation" ADD CONSTRAINT "DiscoveryObservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryObservation" ADD CONSTRAINT "DiscoveryObservation_workspaceId_missionId_fkey" FOREIGN KEY ("workspaceId", "missionId") REFERENCES "DiscoveryMission"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryObservation" ADD CONSTRAINT "DiscoveryObservation_workspaceId_queryId_fkey" FOREIGN KEY ("workspaceId", "queryId") REFERENCES "DiscoveryQuery"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageAssessment" ADD CONSTRAINT "CoverageAssessment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageAssessment" ADD CONSTRAINT "CoverageAssessment_workspaceId_missionId_fkey" FOREIGN KEY ("workspaceId", "missionId") REFERENCES "DiscoveryMission"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
