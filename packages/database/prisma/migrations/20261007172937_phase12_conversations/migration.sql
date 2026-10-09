-- CreateEnum
CREATE TYPE "ConversationStage" AS ENUM ('REPLIED', 'ENGAGED', 'MEETING_REQUESTED', 'NURTURE', 'CLOSED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('AUTO', 'ASSIST', 'HUMAN');

-- CreateEnum
CREATE TYPE "InboxCategory" AS ENUM ('HIGH_INTENT', 'NEEDS_HUMAN', 'AI_HANDLING', 'MEETING', 'NURTURE', 'CLOSED');

-- CreateEnum
CREATE TYPE "WaitingOn" AS ENUM ('US', 'PROSPECT', 'NOBODY');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('PROSPECT', 'AI', 'HUMAN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('APPLIED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReplyStatus" AS ENUM ('DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'WAITING', 'QUEUED', 'SENT', 'BLOCKED', 'CANCELLED', 'FAILED', 'DISCARDED', 'SUPERSEDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgentType" ADD VALUE 'INBOX';
ALTER TYPE "AgentType" ADD VALUE 'CONVERSATION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'CONVERSATION';
ALTER TYPE "EntityType" ADD VALUE 'CONVERSATION_MESSAGE';
ALTER TYPE "EntityType" ADD VALUE 'CONVERSATION_REPLY';

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "personId" UUID,
    "email" TEXT NOT NULL,
    "contactName" TEXT,
    "mailboxIntegrationId" UUID NOT NULL,
    "threadRef" TEXT,
    "subject" TEXT NOT NULL,
    "campaignId" UUID,
    "enrollmentId" UUID,
    "stage" "ConversationStage" NOT NULL DEFAULT 'REPLIED',
    "mode" "ConversationMode" NOT NULL DEFAULT 'ASSIST',
    "category" "InboxCategory" NOT NULL DEFAULT 'AI_HANDLING',
    "waitingOn" "WaitingOn" NOT NULL DEFAULT 'US',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "priorityReasons" TEXT[],
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "escalationReason" TEXT,
    "primaryIntent" TEXT,
    "sentiment" TEXT,
    "summary" TEXT,
    "nextAction" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "assignedToId" UUID,
    "takenOverById" UUID,
    "takenOverAt" TIMESTAMPTZ(3),
    "snoozedUntil" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "lastInboundAt" TIMESTAMPTZ(3),
    "lastOutboundAt" TIMESTAMPTZ(3),
    "lastMessageAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "author" "MessageAuthor" NOT NULL,
    "authorUserId" UUID,
    "fromEmail" TEXT,
    "toEmails" TEXT[],
    "subject" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "kind" TEXT,
    "mailboxMessageId" UUID,
    "campaignMessageId" UUID,
    "replyId" UUID,
    "internetMessageId" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageClassification" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "primaryIntent" TEXT NOT NULL,
    "secondaryIntents" TEXT[],
    "sentiment" TEXT NOT NULL,
    "questions" TEXT[],
    "objections" JSONB NOT NULL DEFAULT '[]',
    "riskFlags" TEXT[],
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "confidence" "ConfidenceLevel" NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL,
    "agentTaskId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionCandidate" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'APPLIED',
    "decidedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExtractionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationReply" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "inReplyToMessageId" UUID,
    "author" "MessageAuthor" NOT NULL,
    "authorUserId" UUID,
    "agentTaskId" UUID,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "answered" JSONB NOT NULL DEFAULT '[]',
    "unanswered" TEXT[],
    "claims" JSONB NOT NULL DEFAULT '[]',
    "validation" JSONB NOT NULL DEFAULT '[]',
    "confidence" "ConfidenceLevel",
    "status" "ReplyStatus" NOT NULL,
    "statusReason" TEXT,
    "externalActionId" UUID,
    "feedback" JSONB,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConversationReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_category_priority_idx" ON "Conversation"("workspaceId", "category", "priority");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_lastMessageAt_idx" ON "Conversation"("workspaceId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_email_idx" ON "Conversation"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_companyId_idx" ON "Conversation"("workspaceId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_workspaceId_id_key" ON "Conversation"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_mailboxIntegrationId_threadRef_key" ON "Conversation"("mailboxIntegrationId", "threadRef");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_mailboxMessageId_key" ON "ConversationMessage"("mailboxMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_campaignMessageId_key" ON "ConversationMessage"("campaignMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_replyId_key" ON "ConversationMessage"("replyId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_occurredAt_idx" ON "ConversationMessage"("conversationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_workspaceId_id_key" ON "ConversationMessage"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MessageClassification_messageId_key" ON "MessageClassification"("messageId");

-- CreateIndex
CREATE INDEX "MessageClassification_workspaceId_primaryIntent_createdAt_idx" ON "MessageClassification"("workspaceId", "primaryIntent", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageClassification_workspaceId_messageId_key" ON "MessageClassification"("workspaceId", "messageId");

-- CreateIndex
CREATE INDEX "ExtractionCandidate_conversationId_field_createdAt_idx" ON "ExtractionCandidate"("conversationId", "field", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationReply_externalActionId_key" ON "ConversationReply"("externalActionId");

-- CreateIndex
CREATE INDEX "ConversationReply_conversationId_createdAt_idx" ON "ConversationReply"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationReply_workspaceId_id_key" ON "ConversationReply"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "Conversation"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageClassification" ADD CONSTRAINT "MessageClassification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageClassification" ADD CONSTRAINT "MessageClassification_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "Conversation"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageClassification" ADD CONSTRAINT "MessageClassification_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "ConversationMessage"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "Conversation"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReply" ADD CONSTRAINT "ConversationReply_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReply" ADD CONSTRAINT "ConversationReply_workspaceId_conversationId_fkey" FOREIGN KEY ("workspaceId", "conversationId") REFERENCES "Conversation"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
