-- AlterEnum
ALTER TYPE "DiscoveryStopReason" ADD VALUE 'TARGET_REACHED';

-- AlterTable
ALTER TABLE "DiscoveryMission" ADD COLUMN     "targetCount" INTEGER;
