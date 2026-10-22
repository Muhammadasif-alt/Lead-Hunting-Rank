-- CreateEnum
CREATE TYPE "TouchType" AS ENUM ('MARKET', 'DISCOVERY', 'SIGNAL', 'HYPOTHESIS', 'CAMPAIGN', 'MESSAGE', 'CONVERSATION', 'MEETING', 'REFERRAL', 'HUMAN');

-- CreateEnum
CREATE TYPE "RevenueEventType" AS ENUM ('WON', 'PAYMENT', 'EXPANSION', 'REFUND');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'REVENUE_EVENT';
ALTER TYPE "EntityType" ADD VALUE 'ANALYTICS_VIEW';

-- CreateTable
CREATE TABLE "AttributionTouch" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "touchType" "TouchType" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionTouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueEvent" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "type" "RevenueEventType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "dedupeKey" TEXT,
    "createdByType" "ActorType" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMetric" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT 'ALL',
    "dimensionId" TEXT NOT NULL DEFAULT '',
    "value" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fromDay" DATE,
    "toDay" DATE,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AnalyticsRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsView" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tab" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AnalyticsView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttributionTouch_workspaceId_touchType_sourceId_idx" ON "AttributionTouch"("workspaceId", "touchType", "sourceId");

-- CreateIndex
CREATE INDEX "AttributionTouch_workspaceId_opportunityId_position_idx" ON "AttributionTouch"("workspaceId", "opportunityId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionTouch_opportunityId_touchType_sourceId_key" ON "AttributionTouch"("opportunityId", "touchType", "sourceId");

-- CreateIndex
CREATE INDEX "RevenueEvent_workspaceId_occurredAt_idx" ON "RevenueEvent"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "RevenueEvent_workspaceId_opportunityId_idx" ON "RevenueEvent"("workspaceId", "opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueEvent_workspaceId_dedupeKey_key" ON "RevenueEvent"("workspaceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "DailyMetric_workspaceId_metric_day_idx" ON "DailyMetric"("workspaceId", "metric", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetric_workspaceId_day_metric_dimension_dimensionId_key" ON "DailyMetric"("workspaceId", "day", "metric", "dimension", "dimensionId");

-- CreateIndex
CREATE INDEX "AnalyticsRun_workspaceId_kind_startedAt_idx" ON "AnalyticsRun"("workspaceId", "kind", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsView_workspaceId_userId_name_key" ON "AnalyticsView"("workspaceId", "userId", "name");

-- AddForeignKey
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEvent" ADD CONSTRAINT "RevenueEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMetric" ADD CONSTRAINT "DailyMetric_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsRun" ADD CONSTRAINT "AnalyticsRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsView" ADD CONSTRAINT "AnalyticsView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Revenue amounts are positive; a refund is its own REFUND event.
ALTER TABLE "RevenueEvent" ADD CONSTRAINT "RevenueEvent_amount_positive" CHECK ("amountMinor" >= 0);
