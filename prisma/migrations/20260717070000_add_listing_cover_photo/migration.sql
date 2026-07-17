-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "coverPhotoId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "listings_coverPhotoId_key" ON "listings"("coverPhotoId");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_coverPhotoId_fkey" FOREIGN KEY ("coverPhotoId") REFERENCES "listing_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

