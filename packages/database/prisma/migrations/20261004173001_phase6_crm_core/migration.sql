-- CreateEnum
CREATE TYPE "MatchCandidateStatus" AS ENUM ('PENDING', 'NEEDS_REVIEW', 'AUTO_RESOLVED', 'MERGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MergeMode" AS ENUM ('MANUAL', 'AUTO');

-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'ENTITY_MATCH_CANDIDATE';

-- DropIndex
DROP INDEX "Company_workspaceId_status_idx";

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "mergedAt" TIMESTAMPTZ(3),
ADD COLUMN     "mergedIntoId" UUID;

-- CreateTable
CREATE TABLE "EntityMatchCandidate" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "leftId" UUID NOT NULL,
    "rightId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "matchingSignals" JSONB NOT NULL,
    "conflictingSignals" JSONB NOT NULL,
    "status" "MatchCandidateStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedByType" "ActorType",
    "resolvedById" UUID,
    "resolution" TEXT,
    "mergeId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "EntityMatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityMerge" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "sourceId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "candidateId" UUID,
    "mode" "MergeMode" NOT NULL,
    "reason" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "sourceSnapshot" JSONB NOT NULL,
    "moved" JSONB NOT NULL,
    "filledFields" TEXT[],
    "mergedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityMatchCandidate_workspaceId_entityType_status_idx" ON "EntityMatchCandidate"("workspaceId", "entityType", "status");

-- CreateIndex
CREATE INDEX "EntityMatchCandidate_workspaceId_rightId_idx" ON "EntityMatchCandidate"("workspaceId", "rightId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityMatchCandidate_workspaceId_entityType_leftId_rightId_key" ON "EntityMatchCandidate"("workspaceId", "entityType", "leftId", "rightId");

-- CreateIndex
CREATE INDEX "EntityMerge_workspaceId_targetId_idx" ON "EntityMerge"("workspaceId", "targetId");

-- CreateIndex
CREATE INDEX "EntityMerge_workspaceId_sourceId_idx" ON "EntityMerge"("workspaceId", "sourceId");

-- Fuzzy company-name matching for entity resolution (similarity()).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Company_normalizedName_trgm_idx" ON "Company" USING GIN ("normalizedName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Company_workspaceId_phone_idx" ON "Company"("workspaceId", "phone");

-- CreateIndex
CREATE INDEX "Company_workspaceId_status_updatedAt_idx" ON "Company"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Company_workspaceId_mergedIntoId_idx" ON "Company"("workspaceId", "mergedIntoId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMatchCandidate" ADD CONSTRAINT "EntityMatchCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMerge" ADD CONSTRAINT "EntityMerge_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Hand-written guardrails (not expressible in Prisma schema) ───

-- One row per pair: the smaller id is always on the left, and a record is never its own duplicate.
ALTER TABLE "EntityMatchCandidate" ADD CONSTRAINT "EntityMatchCandidate_ordered_pair" CHECK ("leftId" < "rightId");
ALTER TABLE "EntityMatchCandidate" ADD CONSTRAINT "EntityMatchCandidate_score_range" CHECK ("score" BETWEEN 0 AND 100);

-- A merged company is archived and points somewhere else.
ALTER TABLE "Company" ADD CONSTRAINT "Company_merge_consistent"
  CHECK ("mergedIntoId" IS NULL OR ("mergedIntoId" <> "id" AND "status" = 'ARCHIVED' AND "mergedAt" IS NOT NULL));

-- EntityMerge is history: append-only, like AuditLog.
CREATE FUNCTION entity_merge_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'EntityMerge is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "EntityMerge_append_only"
  BEFORE UPDATE OR DELETE ON "EntityMerge"
  FOR EACH ROW EXECUTE FUNCTION entity_merge_immutable();
CREATE TRIGGER "EntityMerge_no_truncate"
  BEFORE TRUNCATE ON "EntityMerge"
  FOR EACH STATEMENT EXECUTE FUNCTION entity_merge_immutable();
