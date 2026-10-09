-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PROPOSED', 'PENDING_CONFIRMATION', 'BOOKED', 'RESCHEDULING', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingQualificationRule" AS ENUM ('NONE', 'NEED', 'QUALIFIED');

-- CreateEnum
CREATE TYPE "MeetingOutcomeType" AS ENUM ('ADVANCED', 'NO_CHANGE', 'FOLLOW_UP', 'NURTURE', 'DISQUALIFIED', 'LOST', 'NO_SHOW');

-- AlterEnum
ALTER TYPE "AgentType" ADD VALUE 'SCHEDULING';

-- AlterEnum
ALTER TYPE "ConversationStage" ADD VALUE 'MEETING_BOOKED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityType" ADD VALUE 'MEETING';
ALTER TYPE "EntityType" ADD VALUE 'MEETING_TYPE';

-- CreateTable
CREATE TABLE "MeetingType" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 15,
    "requiredQualification" "MeetingQualificationRule" NOT NULL DEFAULT 'NONE',
    "aiBookingAllowed" BOOLEAN NOT NULL DEFAULT true,
    "briefEnabled" BOOLEAN NOT NULL DEFAULT true,
    "locationType" TEXT NOT NULL DEFAULT 'VIDEO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MeetingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingProfile" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "timezone" TEXT NOT NULL,
    "workingDays" INTEGER[],
    "meetingStartMinute" INTEGER NOT NULL DEFAULT 600,
    "meetingEndMinute" INTEGER NOT NULL DEFAULT 960,
    "lunchStartMinute" INTEGER,
    "lunchEndMinute" INTEGER,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 15,
    "maxMeetingsPerDay" INTEGER NOT NULL DEFAULT 5,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 240,
    "calendarIntegrationId" UUID,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "acceptsMeetings" BOOLEAN NOT NULL DEFAULT true,
    "unavailableUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SchedulingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "opportunityId" UUID,
    "conversationId" UUID,
    "meetingTypeId" UUID NOT NULL,
    "ownerUserId" UUID,
    "primaryPersonId" UUID,
    "title" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'PROPOSED',
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "pendingStartAt" TIMESTAMPTZ(3),
    "pendingEndAt" TIMESTAMPTZ(3),
    "timezone" TEXT NOT NULL,
    "timezoneSource" TEXT NOT NULL,
    "timezoneConfidence" "ConfidenceLevel" NOT NULL,
    "ownerTimezone" TEXT NOT NULL,
    "routingReason" TEXT,
    "requestText" TEXT,
    "requestMessageId" UUID,
    "preference" JSONB,
    "offeredSlots" JSONB NOT NULL DEFAULT '[]',
    "slotsCheckedAt" TIMESTAMPTZ(3),
    "offeredAt" TIMESTAMPTZ(3),
    "calendarIntegrationId" UUID,
    "calendarId" TEXT,
    "providerEventId" TEXT,
    "providerEtag" TEXT,
    "lastSyncedAt" TIMESTAMPTZ(3),
    "bookedVia" TEXT,
    "bookedAt" TIMESTAMPTZ(3),
    "externalActionId" UUID,
    "locationType" TEXT NOT NULL DEFAULT 'VIDEO',
    "meetingUrl" TEXT,
    "statusReason" TEXT,
    "cancelSource" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdByType" "ActorType" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendee" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "personId" UUID,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "expected" BOOLEAN NOT NULL DEFAULT true,
    "attended" BOOLEAN,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingBrief" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "gaps" TEXT[],
    "method" TEXT NOT NULL DEFAULT 'RULES',
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingOutcome" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "outcome" "MeetingOutcomeType" NOT NULL,
    "summary" TEXT,
    "notes" TEXT,
    "nextStep" TEXT,
    "recommendedStage" "StageSemantic",
    "stageApplied" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" UUID,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingChange" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStartAt" TIMESTAMPTZ(3),
    "toStartAt" TIMESTAMPTZ(3),
    "toEndAt" TIMESTAMPTZ(3),
    "source" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingType_workspaceId_key_key" ON "MeetingType"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingType_workspaceId_id_key" ON "MeetingType"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingProfile_workspaceId_userId_key" ON "SchedulingProfile"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_status_startAt_idx" ON "Meeting"("workspaceId", "status", "startAt");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_ownerUserId_startAt_idx" ON "Meeting"("workspaceId", "ownerUserId", "startAt");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_companyId_idx" ON "Meeting"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_opportunityId_idx" ON "Meeting"("workspaceId", "opportunityId");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_conversationId_idx" ON "Meeting"("workspaceId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_workspaceId_id_key" ON "Meeting"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_calendarIntegrationId_providerEventId_key" ON "Meeting"("calendarIntegrationId", "providerEventId");

-- CreateIndex
CREATE INDEX "MeetingAttendee_meetingId_idx" ON "MeetingAttendee"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingBrief_meetingId_version_key" ON "MeetingBrief"("meetingId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingOutcome_meetingId_key" ON "MeetingOutcome"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingOutcome_workspaceId_meetingId_key" ON "MeetingOutcome"("workspaceId", "meetingId");

-- CreateIndex
CREATE INDEX "MeetingChange_meetingId_at_idx" ON "MeetingChange"("meetingId", "at");

-- AddForeignKey
ALTER TABLE "MeetingType" ADD CONSTRAINT "MeetingType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingProfile" ADD CONSTRAINT "SchedulingProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_workspaceId_meetingTypeId_fkey" FOREIGN KEY ("workspaceId", "meetingTypeId") REFERENCES "MeetingType"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "Meeting"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingBrief" ADD CONSTRAINT "MeetingBrief_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingBrief" ADD CONSTRAINT "MeetingBrief_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "Meeting"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingOutcome" ADD CONSTRAINT "MeetingOutcome_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingOutcome" ADD CONSTRAINT "MeetingOutcome_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "Meeting"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingChange" ADD CONSTRAINT "MeetingChange_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingChange" ADD CONSTRAINT "MeetingChange_workspaceId_meetingId_fkey" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "Meeting"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written invariants (docs/09 §59-64, screen #8 §12) --------------------------------------------------------

-- Booked means confirmed: a time, and either the calendar's event id or a person's recorded external booking.
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_booked_is_confirmed" CHECK (
  "status" NOT IN ('BOOKED', 'RESCHEDULING', 'COMPLETED', 'NO_SHOW')
  OR ("startAt" IS NOT NULL AND "endAt" IS NOT NULL AND "bookedVia" IS NOT NULL AND ("bookedVia" <> 'PROVIDER' OR "providerEventId" IS NOT NULL))
);
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_ends_after_start" CHECK ("startAt" IS NULL OR "endAt" > "startAt");
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_pending_ends_after_start" CHECK ("pendingStartAt" IS NULL OR "pendingEndAt" > "pendingStartAt");

-- One meeting being scheduled per conversation — a double click or two replies never make two.
CREATE UNIQUE INDEX "Meeting_scheduling_per_conversation_key" ON "Meeting"("conversationId")
  WHERE "status" IN ('PROPOSED', 'PENDING_CONFIRMATION') AND "conversationId" IS NOT NULL;

ALTER TABLE "MeetingType" ADD CONSTRAINT "MeetingType_sane_duration" CHECK ("durationMinutes" BETWEEN 5 AND 480 AND "bufferMinutes" BETWEEN 0 AND 240);
ALTER TABLE "SchedulingProfile" ADD CONSTRAINT "SchedulingProfile_sane_hours" CHECK (
  "meetingStartMinute" >= 0 AND "meetingEndMinute" <= 1440 AND "meetingEndMinute" > "meetingStartMinute"
  AND ("lunchStartMinute" IS NULL OR ("lunchEndMinute" IS NOT NULL AND "lunchEndMinute" > "lunchStartMinute"))
  AND "maxMeetingsPerDay" BETWEEN 1 AND 30 AND "bufferMinutes" BETWEEN 0 AND 240 AND "minNoticeMinutes" >= 0
);
