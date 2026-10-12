-- pgvector for semantic retrieval of approved knowledge (docs/13 §58-65). The dev/CI image is pgvector/pgvector:pg17.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "MemoryScope" AS ENUM ('COMPANY', 'PERSON', 'CONVERSATION', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('COMPANY', 'PERSON', 'CONVERSATION', 'RELATIONSHIP', 'OPPORTUNITY', 'PREFERENCE');

-- CreateEnum
CREATE TYPE "MemoryOrigin" AS ENUM ('DIRECT_STATEMENT', 'MEETING_NOTE', 'HUMAN_NOTE', 'HUMAN_CORRECTION', 'AI_INFERENCE');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('ACTIVE', 'STALE', 'CONFLICTED', 'SUPERSEDED', 'INVALIDATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MemoryCandidateStatus" AS ENUM ('PENDING', 'AUTO_ACCEPTED', 'ACCEPTED', 'NEEDS_REVIEW', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CommitmentDirection" AS ENUM ('WE_PROMISED', 'PROSPECT_PROMISED', 'MUTUAL');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('OPEN', 'WAITING', 'DUE', 'COMPLETED', 'BROKEN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('WORKS_AT', 'FORMERLY_WORKED_AT', 'REFERRED_BY', 'INTRODUCED_BY', 'REPORTS_TO', 'DECISION_MAKER_FOR', 'INFLUENCER_FOR', 'PARTNER_OF', 'RELATED_COMPANY');

-- CreateEnum
CREATE TYPE "KnowledgeType" AS ENUM ('PROFILE', 'SERVICE', 'PRICING', 'FAQ', 'POLICY', 'INTEGRATION', 'CASE_STUDY', 'COMPETITOR', 'CLAIM', 'DOCUMENT', 'PROPOSAL_BLOCK');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'STALE', 'CONFLICT', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KnowledgeRevisionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KnowledgeOrigin" AS ENUM ('HUMAN', 'DOCUMENT', 'HUMAN_ANSWER', 'AI_DRAFT', 'ROLLBACK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'MEMORY';
ALTER TYPE "EntityType" ADD VALUE 'COMMITMENT';
ALTER TYPE "EntityType" ADD VALUE 'RELATIONSHIP';
ALTER TYPE "EntityType" ADD VALUE 'KNOWLEDGE_ITEM';
ALTER TYPE "EntityType" ADD VALUE 'KNOWLEDGE_SOURCE';
ALTER TYPE "EntityType" ADD VALUE 'KNOWLEDGE_GAP';

-- AlterTable
ALTER TABLE "ConversationReply" ADD COLUMN     "knowledge" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "knowledgeControls" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Memory" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "entityType" "MemoryScope" NOT NULL,
    "entityId" UUID NOT NULL,
    "memoryType" "MemoryType" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "origin" "MemoryOrigin" NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "status" "MemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "sensitivity" TEXT NOT NULL DEFAULT 'NORMAL',
    "useInOutreach" BOOLEAN NOT NULL DEFAULT true,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMPTZ(3),
    "lastConfirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "recheckAfter" TIMESTAMPTZ(3),
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "supersededById" UUID,
    "statusReason" TEXT,
    "createdByType" "ActorType" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEvidence" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "memoryId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "quote" TEXT,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryCandidate" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "entityType" "MemoryScope" NOT NULL,
    "entityId" UUID NOT NULL,
    "memoryType" "MemoryType" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "quote" TEXT,
    "origin" "MemoryOrigin" NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "conversationId" UUID,
    "meetingId" UUID,
    "status" "MemoryCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "memoryId" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryConflict" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "memoryAId" UUID NOT NULL,
    "memoryBId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "conflictType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "note" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ(3),
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commitment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "conversationId" UUID,
    "opportunityId" UUID,
    "meetingId" UUID,
    "personId" UUID,
    "direction" "CommitmentDirection" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dueAt" TIMESTAMPTZ(3),
    "status" "CommitmentStatus" NOT NULL DEFAULT 'OPEN',
    "ownerUserId" UUID,
    "origin" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "quote" TEXT,
    "dedupeKey" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "completionEvidence" TEXT,
    "statusReason" TEXT,
    "createdByType" "ActorType" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "fromType" TEXT NOT NULL,
    "fromId" UUID NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "toType" TEXT NOT NULL,
    "toId" UUID,
    "toLabel" TEXT NOT NULL,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "confidence" "ConfidenceLevel" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "quote" TEXT,
    "confirmedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "KnowledgeType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'DRAFT',
    "authorityLevel" INTEGER NOT NULL,
    "currentRevisionId" UUID,
    "serviceItemId" UUID,
    "ownerUserId" UUID,
    "reviewIntervalDays" INTEGER,
    "lastReviewedAt" TIMESTAMPTZ(3),
    "nextReviewAt" TIMESTAMPTZ(3),
    "aiDisabled" BOOLEAN NOT NULL DEFAULT false,
    "aiDisabledReason" TEXT,
    "aiDisabledAt" TIMESTAMPTZ(3),
    "aiDisabledById" UUID,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "needsReviewReason" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRevision" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "KnowledgeRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "KnowledgeOrigin" NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3),
    "sourceIds" TEXT[],
    "gapId" UUID,
    "changeNote" TEXT,
    "createdByType" "ActorType" NOT NULL,
    "createdById" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "rejectedReason" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "supersededAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector,
    "embeddingModel" TEXT,
    "embeddedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageIntegrationId" UUID,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "statusReason" TEXT,
    "textLength" INTEGER,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeConflict" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "revisionId" UUID,
    "otherItemId" UUID,
    "otherRevisionId" UUID,
    "sourceId" UUID,
    "topic" TEXT NOT NULL,
    "conflictType" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ(3),
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGap" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "conversationIds" TEXT[],
    "companyIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "priorityReasons" TEXT[],
    "draftItemId" UUID,
    "resolvedItemId" UUID,
    "resolvedAt" TIMESTAMPTZ(3),
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeUsage" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "usedByType" TEXT NOT NULL,
    "usedById" TEXT,
    "conversationId" UUID,
    "question" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeFeedback" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "revisionId" UUID,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "userId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Memory_workspaceId_companyId_status_idx" ON "Memory"("workspaceId", "companyId", "status");

-- CreateIndex
CREATE INDEX "Memory_workspaceId_entityType_entityId_key_idx" ON "Memory"("workspaceId", "entityType", "entityId", "key");

-- CreateIndex
CREATE INDEX "Memory_workspaceId_status_recheckAfter_idx" ON "Memory"("workspaceId", "status", "recheckAfter");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_workspaceId_id_key" ON "Memory"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "MemoryEvidence_memoryId_idx" ON "MemoryEvidence"("memoryId");

-- CreateIndex
CREATE INDEX "MemoryCandidate_workspaceId_status_createdAt_idx" ON "MemoryCandidate"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryCandidate_workspaceId_sourceId_entityId_key_key" ON "MemoryCandidate"("workspaceId", "sourceId", "entityId", "key");

-- CreateIndex
CREATE INDEX "MemoryConflict_workspaceId_status_idx" ON "MemoryConflict"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "MemoryConflict_memoryAId_idx" ON "MemoryConflict"("memoryAId");

-- CreateIndex
CREATE INDEX "MemoryConflict_memoryBId_idx" ON "MemoryConflict"("memoryBId");

-- CreateIndex
CREATE INDEX "Commitment_workspaceId_status_dueAt_idx" ON "Commitment"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Commitment_workspaceId_companyId_idx" ON "Commitment"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Commitment_workspaceId_conversationId_idx" ON "Commitment"("workspaceId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Commitment_workspaceId_dedupeKey_key" ON "Commitment"("workspaceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Relationship_workspaceId_companyId_idx" ON "Relationship"("workspaceId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_workspaceId_fromId_type_toLabel_key" ON "Relationship"("workspaceId", "fromId", "type", "toLabel");

-- CreateIndex
CREATE INDEX "KnowledgeItem_workspaceId_type_status_idx" ON "KnowledgeItem"("workspaceId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeItem_workspaceId_code_key" ON "KnowledgeItem"("workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeItem_workspaceId_id_key" ON "KnowledgeItem"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "KnowledgeRevision_workspaceId_status_idx" ON "KnowledgeRevision"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRevision_itemId_version_key" ON "KnowledgeRevision"("itemId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRevision_workspaceId_id_key" ON "KnowledgeRevision"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_workspaceId_itemId_idx" ON "KnowledgeChunk"("workspaceId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_revisionId_chunkIndex_key" ON "KnowledgeChunk"("revisionId", "chunkIndex");

-- CreateIndex
CREATE INDEX "KnowledgeSource_workspaceId_uploadedAt_idx" ON "KnowledgeSource"("workspaceId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_workspaceId_sha256_key" ON "KnowledgeSource"("workspaceId", "sha256");

-- CreateIndex
CREATE INDEX "KnowledgeConflict_workspaceId_status_idx" ON "KnowledgeConflict"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "KnowledgeConflict_itemId_idx" ON "KnowledgeConflict"("itemId");

-- CreateIndex
CREATE INDEX "KnowledgeGap_workspaceId_status_priority_idx" ON "KnowledgeGap"("workspaceId", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGap_workspaceId_key_key" ON "KnowledgeGap"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "KnowledgeUsage_workspaceId_itemId_at_idx" ON "KnowledgeUsage"("workspaceId", "itemId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeUsage_workspaceId_usedByType_usedById_revisionId_key" ON "KnowledgeUsage"("workspaceId", "usedByType", "usedById", "revisionId");

-- CreateIndex
CREATE INDEX "KnowledgeFeedback_workspaceId_itemId_idx" ON "KnowledgeFeedback"("workspaceId", "itemId");

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEvidence" ADD CONSTRAINT "MemoryEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEvidence" ADD CONSTRAINT "MemoryEvidence_workspaceId_memoryId_fkey" FOREIGN KEY ("workspaceId", "memoryId") REFERENCES "Memory"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCandidate" ADD CONSTRAINT "MemoryCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryConflict" ADD CONSTRAINT "MemoryConflict_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRevision" ADD CONSTRAINT "KnowledgeRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRevision" ADD CONSTRAINT "KnowledgeRevision_workspaceId_itemId_fkey" FOREIGN KEY ("workspaceId", "itemId") REFERENCES "KnowledgeItem"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_workspaceId_revisionId_fkey" FOREIGN KEY ("workspaceId", "revisionId") REFERENCES "KnowledgeRevision"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeConflict" ADD CONSTRAINT "KnowledgeConflict_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeUsage" ADD CONSTRAINT "KnowledgeUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFeedback" ADD CONSTRAINT "KnowledgeFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── hand-written invariants (docs/13 §132-134) ──

-- A wrong memory is invalidated with a reason, never silently dropped.
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_invalidated_has_reason" CHECK ("status" <> 'INVALIDATED' OR "statusReason" IS NOT NULL);
-- A superseded memory points at what replaced it (history stays readable).
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_superseded_has_successor" CHECK ("status" <> 'SUPERSEDED' OR "supersededById" IS NOT NULL);
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_valid_window" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");

-- A kept promise carries its evidence.
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_completed_has_evidence" CHECK ("status" <> 'COMPLETED' OR ("completedAt" IS NOT NULL AND "completionEvidence" IS NOT NULL));

-- Approved knowledge was approved by a person, at a time.
ALTER TABLE "KnowledgeRevision" ADD CONSTRAINT "KnowledgeRevision_approved_by_person" CHECK ("status" NOT IN ('APPROVED', 'SUPERSEDED') OR "approvedAt" IS NULL OR "approvedById" IS NOT NULL);
ALTER TABLE "KnowledgeRevision" ADD CONSTRAINT "KnowledgeRevision_approved_has_time" CHECK ("status" <> 'APPROVED' OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL));
-- One open draft per item at a time: edits continue the draft instead of forking it.
CREATE UNIQUE INDEX "KnowledgeRevision_open_draft_key" ON "KnowledgeRevision" ("itemId") WHERE "status" IN ('DRAFT', 'IN_REVIEW');
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_authority_range" CHECK ("authorityLevel" BETWEEN 1 AND 6);
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_disabled_has_reason" CHECK (NOT "aiDisabled" OR "aiDisabledReason" IS NOT NULL);

-- The Test AI model also embeds text (deterministic test vectors) — existing connections gain the capability.
UPDATE "Integration" SET "capabilities" = array_append("capabilities", 'EMBEDDINGS') WHERE "provider" = 'fake_llm' AND NOT ('EMBEDDINGS' = ANY("capabilities"));
