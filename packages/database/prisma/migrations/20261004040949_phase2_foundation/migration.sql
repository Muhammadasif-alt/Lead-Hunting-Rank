-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('HUMAN', 'AI_AGENT', 'SYSTEM', 'API_CLIENT', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('WORKSPACE', 'USER', 'COMPANY', 'PERSON', 'EMPLOYMENT', 'CONTACT_POINT', 'EVIDENCE', 'FACT');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('OWNER', 'ADMIN', 'SALES', 'RESEARCHER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ActionClass" AS ENUM ('A', 'B', 'C', 'D', 'E');

-- CreateEnum
CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('OWN', 'ASSIGNED', 'TEAM', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "AuthorityUnit" AS ENUM ('PERCENT', 'COUNT', 'MINOR_CURRENCY');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('DISCOVERED', 'RESEARCHING', 'ACTIVE', 'CUSTOMER', 'FORMER_CUSTOMER', 'DISQUALIFIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AliasType" AS ENUM ('NAME', 'DOMAIN', 'PHONE');

-- CreateEnum
CREATE TYPE "PersonStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContactPointType" AS ENUM ('EMAIL', 'PHONE', 'MOBILE', 'BUSINESS_PHONE', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactPointStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'INVALID', 'STALE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VALID', 'INVALID', 'RISKY', 'UNKNOWN', 'CATCH_ALL', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "FreshnessStatus" AS ENUM ('FRESH', 'AGING', 'STALE');

-- CreateEnum
CREATE TYPE "FactStatus" AS ENUM ('ACTIVE', 'CONFLICTED', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PolicyEffect" AS ENUM ('ALLOW', 'REQUIRE_APPROVAL', 'WAIT', 'BLOCK', 'ESCALATE');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ExternalActionStatus" AS ENUM ('PREPARED', 'APPROVED', 'QUEUED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InboundEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "timezone" TEXT,
    "locale" TEXT,
    "lastActiveAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" "RoleKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionClass" "ActionClass" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "effect" "PermissionEffect" NOT NULL DEFAULT 'ALLOW',
    "scope" "PermissionScope" NOT NULL DEFAULT 'WORKSPACE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorityLimit" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "roleId" UUID,
    "memberId" UUID,
    "key" TEXT NOT NULL,
    "maxValue" DECIMAL(18,4),
    "unit" "AuthorityUnit" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AuthorityLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "normalizedName" TEXT NOT NULL,
    "websiteDomain" TEXT,
    "phone" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'DISCOVERED',
    "companyType" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" CHAR(2),
    "postalCode" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "industry" TEXT,
    "employeeRange" TEXT,
    "revenueRange" TEXT,
    "foundedYear" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAlias" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "aliasType" "AliasType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalEntityMapping" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalEntityMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT NOT NULL,
    "status" "PersonStatus" NOT NULL DEFAULT 'ACTIVE',
    "linkedinUrl" TEXT,
    "professionalUrl" TEXT,
    "timezone" TEXT,
    "language" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "title" TEXT,
    "department" TEXT,
    "seniority" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" DATE,
    "endedAt" DATE,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Employment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPoint" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "type" "ContactPointType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "label" TEXT,
    "status" "ContactPointStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'LOW',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ContactPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactVerification" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactPointId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "providerResult" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "provider" TEXT,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "retrievedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentExcerpt" TEXT,
    "contentHash" TEXT,
    "storageRef" TEXT,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "freshnessStatus" "FreshnessStatus" NOT NULL DEFAULT 'FRESH',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "factType" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "status" "FactStatus" NOT NULL DEFAULT 'ACTIVE',
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "validFrom" TIMESTAMPTZ(3),
    "validUntil" TIMESTAMPTZ(3),
    "firstObservedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastConfirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "supersededById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactEvidence" (
    "workspaceId" UUID NOT NULL,
    "factId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactEvidence_pkey" PRIMARY KEY ("factId","evidenceId")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "stageType" "StageType" NOT NULL DEFAULT 'OPEN',
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "policyType" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'WORKSPACE',
    "scopeId" UUID,
    "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "effectiveFrom" TIMESTAMPTZ(3),
    "effectiveUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "ruleType" TEXT NOT NULL,
    "conditionJson" JSONB NOT NULL,
    "effect" "PolicyEffect" NOT NULL,
    "isHardRule" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "reason" TEXT,
    "requestId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "correlationId" TEXT,
    "causationId" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "domainEventId" UUID,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalAction" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "status" "ExternalActionStatus" NOT NULL DEFAULT 'PREPARED',
    "idempotencyKey" TEXT NOT NULL,
    "policyDecisionId" UUID,
    "approvalRequestId" UUID,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "requestRef" TEXT,
    "responseRef" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "executedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ExternalAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEvent" (
    "id" UUID NOT NULL,
    "workspaceId" UUID,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadRef" TEXT,
    "payload" JSONB,
    "status" "InboundEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "lastError" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_id_key" ON "WorkspaceMember"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Role_workspaceId_key_key" ON "Role"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Role_workspaceId_id_key" ON "Role"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "UserRole_workspaceId_idx" ON "UserRole"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_memberId_roleId_key" ON "UserRole"("memberId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorityLimit_workspaceId_roleId_memberId_key_key" ON "AuthorityLimit"("workspaceId", "roleId", "memberId", "key") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "Company_workspaceId_normalizedName_idx" ON "Company"("workspaceId", "normalizedName");

-- CreateIndex
CREATE INDEX "Company_workspaceId_websiteDomain_idx" ON "Company"("workspaceId", "websiteDomain");

-- CreateIndex
CREATE INDEX "Company_workspaceId_status_idx" ON "Company"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Company_workspaceId_id_key" ON "Company"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "CompanyAlias_workspaceId_aliasType_normalizedValue_idx" ON "CompanyAlias"("workspaceId", "aliasType", "normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAlias_companyId_aliasType_normalizedValue_key" ON "CompanyAlias"("companyId", "aliasType", "normalizedValue");

-- CreateIndex
CREATE INDEX "ExternalEntityMapping_workspaceId_entityType_entityId_idx" ON "ExternalEntityMapping"("workspaceId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalEntityMapping_workspaceId_provider_entityType_exter_key" ON "ExternalEntityMapping"("workspaceId", "provider", "entityType", "externalId");

-- CreateIndex
CREATE INDEX "Person_workspaceId_fullName_idx" ON "Person"("workspaceId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Person_workspaceId_id_key" ON "Person"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "Employment_workspaceId_companyId_idx" ON "Employment"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Employment_workspaceId_personId_idx" ON "Employment"("workspaceId", "personId");

-- CreateIndex
CREATE INDEX "ContactPoint_workspaceId_normalizedValue_idx" ON "ContactPoint"("workspaceId", "normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPoint_workspaceId_id_key" ON "ContactPoint"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPoint_workspaceId_entityType_entityId_type_normalize_key" ON "ContactPoint"("workspaceId", "entityType", "entityId", "type", "normalizedValue");

-- CreateIndex
CREATE INDEX "ContactVerification_workspaceId_contactPointId_verifiedAt_idx" ON "ContactVerification"("workspaceId", "contactPointId", "verifiedAt");

-- CreateIndex
CREATE INDEX "Evidence_workspaceId_entityType_entityId_idx" ON "Evidence"("workspaceId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_workspaceId_id_key" ON "Evidence"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "Fact_workspaceId_entityType_entityId_field_status_idx" ON "Fact"("workspaceId", "entityType", "entityId", "field", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Fact_workspaceId_id_key" ON "Fact"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "FactEvidence_workspaceId_evidenceId_idx" ON "FactEvidence"("workspaceId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_workspaceId_id_key" ON "Pipeline"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_workspaceId_name_key" ON "Pipeline"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_pipelineId_position_key" ON "PipelineStage"("pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_pipelineId_name_key" ON "PipelineStage"("pipelineId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_workspaceId_id_key" ON "Policy"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_workspaceId_name_key" ON "Policy"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRule_policyId_ruleType_key" ON "PolicyRule"("policyId", "ruleType");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_entityType_entityId_createdAt_idx" ON "AuditLog"("workspaceId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "DomainEvent_workspaceId_aggregateType_aggregateId_occurredA_idx" ON "DomainEvent"("workspaceId", "aggregateType", "aggregateId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_eventType_occurredAt_idx" ON "DomainEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "ExternalAction_workspaceId_status_idx" ON "ExternalAction"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAction_workspaceId_idempotencyKey_key" ON "ExternalAction"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "InboundEvent_status_receivedAt_idx" ON "InboundEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEvent_provider_externalEventId_key" ON "InboundEvent"("provider", "externalEventId");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_workspaceId_memberId_fkey" FOREIGN KEY ("workspaceId", "memberId") REFERENCES "WorkspaceMember"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_workspaceId_roleId_fkey" FOREIGN KEY ("workspaceId", "roleId") REFERENCES "Role"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorityLimit" ADD CONSTRAINT "AuthorityLimit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorityLimit" ADD CONSTRAINT "AuthorityLimit_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorityLimit" ADD CONSTRAINT "AuthorityLimit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "WorkspaceMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAlias" ADD CONSTRAINT "CompanyAlias_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAlias" ADD CONSTRAINT "CompanyAlias_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalEntityMapping" ADD CONSTRAINT "ExternalEntityMapping_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_workspaceId_personId_fkey" FOREIGN KEY ("workspaceId", "personId") REFERENCES "Person"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactVerification" ADD CONSTRAINT "ContactVerification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactVerification" ADD CONSTRAINT "ContactVerification_workspaceId_contactPointId_fkey" FOREIGN KEY ("workspaceId", "contactPointId") REFERENCES "ContactPoint"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Fact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactEvidence" ADD CONSTRAINT "FactEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactEvidence" ADD CONSTRAINT "FactEvidence_workspaceId_factId_fkey" FOREIGN KEY ("workspaceId", "factId") REFERENCES "Fact"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactEvidence" ADD CONSTRAINT "FactEvidence_workspaceId_evidenceId_fkey" FOREIGN KEY ("workspaceId", "evidenceId") REFERENCES "Evidence"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_workspaceId_pipelineId_fkey" FOREIGN KEY ("workspaceId", "pipelineId") REFERENCES "Pipeline"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRule" ADD CONSTRAINT "PolicyRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRule" ADD CONSTRAINT "PolicyRule_workspaceId_policyId_fkey" FOREIGN KEY ("workspaceId", "policyId") REFERENCES "Policy"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_domainEventId_fkey" FOREIGN KEY ("domainEventId") REFERENCES "DomainEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalAction" ADD CONSTRAINT "ExternalAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEvent" ADD CONSTRAINT "InboundEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Hand-written guardrails (not expressible in Prisma schema) ───

-- pgvector is used from Phase 14 (KnowledgeChunk embeddings); enable it up front.
CREATE EXTENSION IF NOT EXISTS vector;

-- An authority limit belongs to exactly one of: a role, or a single member override.
ALTER TABLE "AuthorityLimit" ADD CONSTRAINT "AuthorityLimit_role_xor_member"
  CHECK (("roleId" IS NULL) <> ("memberId" IS NULL));
ALTER TABLE "AuthorityLimit" ADD CONSTRAINT "AuthorityLimit_max_non_negative"
  CHECK ("maxValue" IS NULL OR "maxValue" >= 0);

-- Domain sanity checks.
ALTER TABLE "Company" ADD CONSTRAINT "Company_founded_year_range"
  CHECK ("foundedYear" IS NULL OR "foundedYear" BETWEEN 1600 AND 2200);
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_dates_ordered"
  CHECK ("endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_not_self_superseded"
  CHECK ("supersededById" IS NULL OR "supersededById" <> "id");
ALTER TABLE "ExternalAction" ADD CONSTRAINT "ExternalAction_attempts_non_negative"
  CHECK ("attemptCount" >= 0);

-- At most one primary contact point per entity and type.
CREATE UNIQUE INDEX "ContactPoint_one_primary" ON "ContactPoint"("workspaceId", "entityType", "entityId", "type")
  WHERE "isPrimary" AND "archivedAt" IS NULL;

-- AuditLog is append-only: history can't be rewritten, even by the application.
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();