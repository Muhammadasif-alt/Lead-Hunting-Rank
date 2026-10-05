-- CreateEnum
CREATE TYPE "ResearchTrigger" AS ENUM ('DISCOVERY', 'MANUAL');

-- CreateEnum
CREATE TYPE "ResearchRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'WAITING', 'FAILED');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('LIVE', 'UNREACHABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WebsiteAuditStatus" AS ENUM ('COMPLETE', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SocialProfileStatus" AS ENUM ('ACTIVE', 'GONE');

-- CreateEnum
CREATE TYPE "HypothesisStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'SUPPORTED', 'WEAKENED', 'INVALIDATED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "HypothesisSource" AS ENUM ('RULE', 'AI');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'WEBSITE';
ALTER TYPE "EntityType" ADD VALUE 'RESEARCH_RUN';
ALTER TYPE "EntityType" ADD VALUE 'OPPORTUNITY_HYPOTHESIS';

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "trigger" "ResearchTrigger" NOT NULL,
    "missionId" UUID,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'QUEUED',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "gaps" TEXT[],
    "summary" TEXT,
    "error" TEXT,
    "retryAt" TIMESTAMPTZ(3),
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "requestedBy" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Website" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "status" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN',
    "statusReason" TEXT,
    "isOfficial" BOOLEAN NOT NULL DEFAULT true,
    "matchConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteSnapshot" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "websiteId" UUID NOT NULL,
    "researchRunId" UUID,
    "evidenceId" UUID,
    "pageType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "contentType" TEXT,
    "contentHash" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "metadata" JSONB NOT NULL,
    "textExcerpt" TEXT,
    "auditVersion" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteAudit" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "websiteId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "researchRunId" UUID,
    "auditVersion" INTEGER NOT NULL,
    "status" "WebsiteAuditStatus" NOT NULL,
    "performedAt" TIMESTAMPTZ(3) NOT NULL,
    "hasSsl" BOOLEAN,
    "mobileReady" BOOLEAN,
    "hasContactForm" BOOLEAN,
    "hasBooking" BOOLEAN,
    "hasChat" BOOLEAN,
    "hasClearCta" BOOLEAN,
    "copyrightYear" INTEGER,
    "technologySummary" TEXT[],
    "findings" JSONB NOT NULL,
    "overallConfidence" "ConfidenceLevel" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Technology" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Technology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyTechnology" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "technologyId" UUID NOT NULL,
    "evidenceId" UUID,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "firstDetectedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastDetectedAt" TIMESTAMPTZ(3) NOT NULL,
    "goneAt" TIMESTAMPTZ(3),

    CONSTRAINT "CompanyTechnology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialProfile" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "handle" TEXT,
    "status" "SocialProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "matchConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "evidenceId" UUID,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastCheckedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SocialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityHypothesis" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "reasonSummary" TEXT NOT NULL,
    "status" "HypothesisStatus" NOT NULL DEFAULT 'ACTIVE',
    "confidence" "ConfidenceLevel" NOT NULL,
    "source" "HypothesisSource" NOT NULL DEFAULT 'RULE',
    "researchRunId" UUID,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSupportedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OpportunityHypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HypothesisEvidence" (
    "workspaceId" UUID NOT NULL,
    "hypothesisId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HypothesisEvidence_pkey" PRIMARY KEY ("hypothesisId","evidenceId")
);

-- CreateIndex
CREATE INDEX "ResearchRun_workspaceId_companyId_createdAt_idx" ON "ResearchRun"("workspaceId", "companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_status_leaseUntil_idx" ON "ResearchRun"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "ResearchRun_workspaceId_missionId_idx" ON "ResearchRun"("workspaceId", "missionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRun_workspaceId_id_key" ON "ResearchRun"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Website_workspaceId_id_key" ON "Website"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Website_workspaceId_companyId_domain_key" ON "Website"("workspaceId", "companyId", "domain");

-- CreateIndex
CREATE INDEX "WebsiteSnapshot_workspaceId_websiteId_fetchedAt_idx" ON "WebsiteSnapshot"("workspaceId", "websiteId", "fetchedAt");

-- CreateIndex
CREATE INDEX "WebsiteAudit_workspaceId_companyId_performedAt_idx" ON "WebsiteAudit"("workspaceId", "companyId", "performedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Technology_key_key" ON "Technology"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTechnology_workspaceId_companyId_technologyId_key" ON "CompanyTechnology"("workspaceId", "companyId", "technologyId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialProfile_workspaceId_companyId_platform_profileUrl_key" ON "SocialProfile"("workspaceId", "companyId", "platform", "profileUrl");

-- CreateIndex
CREATE INDEX "OpportunityHypothesis_workspaceId_status_idx" ON "OpportunityHypothesis"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityHypothesis_workspaceId_id_key" ON "OpportunityHypothesis"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityHypothesis_workspaceId_companyId_key_key" ON "OpportunityHypothesis"("workspaceId", "companyId", "key");

-- CreateIndex
CREATE INDEX "HypothesisEvidence_workspaceId_evidenceId_idx" ON "HypothesisEvidence"("workspaceId", "evidenceId");

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteSnapshot" ADD CONSTRAINT "WebsiteSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteSnapshot" ADD CONSTRAINT "WebsiteSnapshot_workspaceId_websiteId_fkey" FOREIGN KEY ("workspaceId", "websiteId") REFERENCES "Website"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAudit" ADD CONSTRAINT "WebsiteAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAudit" ADD CONSTRAINT "WebsiteAudit_workspaceId_websiteId_fkey" FOREIGN KEY ("workspaceId", "websiteId") REFERENCES "Website"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTechnology" ADD CONSTRAINT "CompanyTechnology_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTechnology" ADD CONSTRAINT "CompanyTechnology_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTechnology" ADD CONSTRAINT "CompanyTechnology_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "Technology"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialProfile" ADD CONSTRAINT "SocialProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialProfile" ADD CONSTRAINT "SocialProfile_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityHypothesis" ADD CONSTRAINT "OpportunityHypothesis_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityHypothesis" ADD CONSTRAINT "OpportunityHypothesis_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HypothesisEvidence" ADD CONSTRAINT "HypothesisEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HypothesisEvidence" ADD CONSTRAINT "HypothesisEvidence_workspaceId_hypothesisId_fkey" FOREIGN KEY ("workspaceId", "hypothesisId") REFERENCES "OpportunityHypothesis"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HypothesisEvidence" ADD CONSTRAINT "HypothesisEvidence_workspaceId_evidenceId_fkey" FOREIGN KEY ("workspaceId", "evidenceId") REFERENCES "Evidence"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
