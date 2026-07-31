-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "activeCommunityId" TEXT;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_activeCommunityId_fkey" FOREIGN KEY ("activeCommunityId") REFERENCES "communities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
