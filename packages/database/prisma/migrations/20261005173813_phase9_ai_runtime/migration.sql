-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('RESEARCH', 'WEB_AUDIT', 'CONTACT', 'SCORING');

-- CreateEnum
CREATE TYPE "PromptStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'WAITING_TOOL', 'WAITING_HUMAN', 'COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiFailureCategory" AS ENUM ('MODEL_FAILURE', 'TOOL_FAILURE', 'PROVIDER_FAILURE', 'VALIDATION_FAILURE', 'POLICY_BLOCK', 'BUDGET_BLOCK', 'MISSING_CONTEXT', 'TIMEOUT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AiDecisionKind" AS ENUM ('PROPOSE', 'ACT', 'ASK', 'WAIT', 'BLOCK', 'ESCALATE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AssessmentDimension" AS ENUM ('ICP_FIT', 'OPPORTUNITY', 'CONTACTABILITY', 'DATA_CONFIDENCE', 'PRIORITY');

-- CreateEnum
CREATE TYPE "AssessmentLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'AGENT_TASK';
ALTER TYPE "EntityType" ADD VALUE 'AI_DECISION';

-- CreateTable
CREATE TABLE "AgentDefinition" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "version" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "modelClass" TEXT NOT NULL,
    "allowedTools" TEXT[],
    "maxConcurrency" INTEGER NOT NULL DEFAULT 4,
    "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "dailyRunLimit" INTEGER,
    "dailyCostLimitMinor" INTEGER,
    "riskClass" TEXT NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AgentDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptDefinition" (
    "id" UUID NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "taskType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PromptStatus" NOT NULL DEFAULT 'ACTIVE',
    "system" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "taskType" TEXT NOT NULL,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 4,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "objective" TEXT NOT NULL,
    "inputKey" TEXT NOT NULL,
    "inputRefs" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "confidence" "ConfidenceLevel",
    "uncertainties" TEXT[],
    "reasonSummary" TEXT,
    "failureCategory" "AiFailureCategory",
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "researchRunId" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "agentTaskId" UUID NOT NULL,
    "agentType" "AgentType" NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "modelClass" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "toolsetVersion" INTEGER NOT NULL,
    "schemaName" TEXT NOT NULL,
    "status" "AiRunStatus" NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costMinor" INTEGER,
    "costIsEstimate" BOOLEAN NOT NULL DEFAULT true,
    "latencyMs" INTEGER,
    "output" JSONB,
    "error" TEXT,
    "failureCategory" "AiFailureCategory",
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDecision" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "agentTaskId" UUID NOT NULL,
    "aiRunId" UUID,
    "agentType" "AgentType" NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "decision" "AiDecisionKind" NOT NULL,
    "confidence" "ConfidenceLevel",
    "risk" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "reasonSummary" TEXT NOT NULL,
    "evidenceRefs" TEXT[],
    "promptVersion" INTEGER,
    "model" TEXT,
    "validation" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAssessment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "dimension" "AssessmentDimension" NOT NULL,
    "level" "AssessmentLevel" NOT NULL,
    "reasons" TEXT[],
    "evidenceIds" TEXT[],
    "agentTaskId" UUID,
    "aiDecisionId" UUID,
    "assessedAt" TIMESTAMPTZ(3) NOT NULL,
    "supersededAt" TIMESTAMPTZ(3),

    CONSTRAINT "CompanyAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentDefinition_workspaceId_agentType_key" ON "AgentDefinition"("workspaceId", "agentType");

-- CreateIndex
CREATE UNIQUE INDEX "PromptDefinition_agentType_taskType_version_key" ON "PromptDefinition"("agentType", "taskType", "version");

-- CreateIndex
CREATE INDEX "AgentTask_workspaceId_entityType_entityId_createdAt_idx" ON "AgentTask"("workspaceId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentTask_workspaceId_agentType_createdAt_idx" ON "AgentTask"("workspaceId", "agentType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTask_workspaceId_id_key" ON "AgentTask"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTask_workspaceId_agentType_taskType_inputKey_key" ON "AgentTask"("workspaceId", "agentType", "taskType", "inputKey");

-- CreateIndex
CREATE INDEX "AiRun_workspaceId_startedAt_idx" ON "AiRun"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "AiRun_workspaceId_agentType_startedAt_idx" ON "AiRun"("workspaceId", "agentType", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiRun_workspaceId_id_key" ON "AiRun"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "AiDecision_workspaceId_entityType_entityId_createdAt_idx" ON "AiDecision"("workspaceId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyAssessment_workspaceId_companyId_dimension_supersede_idx" ON "CompanyAssessment"("workspaceId", "companyId", "dimension", "supersededAt");

-- AddForeignKey
ALTER TABLE "AgentDefinition" ADD CONSTRAINT "AgentDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_workspaceId_agentTaskId_fkey" FOREIGN KEY ("workspaceId", "agentTaskId") REFERENCES "AgentTask"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDecision" ADD CONSTRAINT "AiDecision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDecision" ADD CONSTRAINT "AiDecision_workspaceId_agentTaskId_fkey" FOREIGN KEY ("workspaceId", "agentTaskId") REFERENCES "AgentTask"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAssessment" ADD CONSTRAINT "CompanyAssessment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAssessment" ADD CONSTRAINT "CompanyAssessment_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
