-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CommunityStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MasterStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('MASTER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "communities" ADD COLUMN     "archiveScheduledAt" TIMESTAMP(3),
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "operationalEpoch" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "status" "CommunityStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "operationalEpoch" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "operationalEpoch" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "operationalEpoch" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "message_threads" ADD COLUMN     "operationalEpoch" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "master_identities" (
    "id" TEXT NOT NULL,
    "masterId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByMasterId" TEXT,
    "statusChangedAt" TIMESTAMP(3),

    CONSTRAINT "master_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_sessions" (
    "id" TEXT NOT NULL,
    "masterId" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administrative_audit_entries" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorMasterId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "outcome" "AuditOutcome" NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrative_audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_identities_masterId_key" ON "master_identities"("masterId");

-- CreateIndex
CREATE UNIQUE INDEX "master_identities_email_key" ON "master_identities"("email");

-- CreateIndex
CREATE UNIQUE INDEX "master_sessions_sessionTokenHash_key" ON "master_sessions"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "master_sessions_masterId_idx" ON "master_sessions"("masterId");

-- CreateIndex
CREATE INDEX "administrative_audit_entries_createdAt_idx" ON "administrative_audit_entries"("createdAt");

-- CreateIndex
CREATE INDEX "administrative_audit_entries_actorMasterId_idx" ON "administrative_audit_entries"("actorMasterId");

-- CreateIndex
CREATE INDEX "administrative_audit_entries_targetType_targetId_idx" ON "administrative_audit_entries"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "master_sessions" ADD CONSTRAINT "master_sessions_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "master_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
