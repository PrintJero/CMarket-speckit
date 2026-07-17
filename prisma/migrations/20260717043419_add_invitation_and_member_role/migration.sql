-- AlterEnum
ALTER TYPE "MembershipRole" ADD VALUE 'MEMBER';

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_communityId_idx" ON "invitations"("communityId");

-- CreateIndex
CREATE INDEX "invitations_email_communityId_idx" ON "invitations"("email", "communityId");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
