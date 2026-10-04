-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'ACTIVE', 'DEGRADED', 'AUTH_EXPIRED', 'RATE_LIMITED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProviderHealthState" AS ENUM ('HEALTHY', 'DEGRADED', 'RATE_LIMITED', 'AUTH_REQUIRED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "ProviderCallStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'INTEGRATION';

-- CreateTable
CREATE TABLE "Integration" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountRef" TEXT NOT NULL DEFAULT 'default',
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "capabilities" TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 100,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "credentialRef" TEXT,
    "connectedBy" UUID,
    "connectedAt" TIMESTAMPTZ(3),
    "disconnectedAt" TIMESTAMPTZ(3),
    "lastHealthCheckAt" TIMESTAMPTZ(3),
    "lastSuccessAt" TIMESTAMPTZ(3),
    "lastErrorAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCapabilityHealth" (
    "workspaceId" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "state" "ProviderHealthState" NOT NULL,
    "reason" TEXT,
    "lastSuccessAt" TIMESTAMPTZ(3),
    "lastFailureAt" TIMESTAMPTZ(3),
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationCapabilityHealth_pkey" PRIMARY KEY ("integrationId","capability")
);

-- CreateTable
CREATE TABLE "ProviderCallRecord" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "integrationId" UUID,
    "provider" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" "ProviderCallStatus" NOT NULL,
    "errorKind" TEXT,
    "durationMs" INTEGER NOT NULL,
    "units" INTEGER,
    "costMinor" INTEGER,
    "costIsEstimate" BOOLEAN NOT NULL DEFAULT false,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "entityType" TEXT,
    "entityId" TEXT,
    "correlationId" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderCallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Integration_workspaceId_status_idx" ON "Integration"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_workspaceId_id_key" ON "Integration"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_workspaceId_provider_accountRef_key" ON "Integration"("workspaceId", "provider", "accountRef");

-- CreateIndex
CREATE INDEX "IntegrationCapabilityHealth_workspaceId_idx" ON "IntegrationCapabilityHealth"("workspaceId");

-- CreateIndex
CREATE INDEX "ProviderCallRecord_workspaceId_startedAt_idx" ON "ProviderCallRecord"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "ProviderCallRecord_integrationId_startedAt_idx" ON "ProviderCallRecord"("integrationId", "startedAt");

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCapabilityHealth" ADD CONSTRAINT "IntegrationCapabilityHealth_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCapabilityHealth" ADD CONSTRAINT "IntegrationCapabilityHealth_workspaceId_integrationId_fkey" FOREIGN KEY ("workspaceId", "integrationId") REFERENCES "Integration"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
