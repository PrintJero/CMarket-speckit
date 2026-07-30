-- CreateEnum
CREATE TYPE "ListingKind" AS ENUM ('FOR_SALE', 'WANTED');

-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE 'FULFILLED';

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "kind" "ListingKind" NOT NULL DEFAULT 'FOR_SALE',
ALTER COLUMN "priceCents" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "listings_communityId_kind_status_createdAt_idx" ON "listings"("communityId", "kind", "status", "createdAt");
