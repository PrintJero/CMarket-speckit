-- DropIndex
DROP INDEX "listings_communityId_idx";

-- CreateIndex
CREATE INDEX "listings_communityId_status_createdAt_idx" ON "listings"("communityId", "status", "createdAt");
