-- 017-cloudinary-listing-media: replace in-database listing photo bytes with
-- Cloudinary references. DESTRUCTIVE AND IRREVERSIBLE.
--
-- Every existing listing_photos row's only content was its bytes, and the new
-- NOT NULL Cloudinary columns have no derivable value, so the rows are deleted
-- rather than migrated (FR-087, FR-093). Affected listings become image-less and
-- fall back to the existing "No photo" placeholder (FR-089).
--
-- Take a verified database backup before applying to any environment holding
-- real data. This is the first migration in this project where a backup is the
-- ONLY recovery path rather than a precaution.
--
-- Hand-authored in data-model.md §6's order. Step 2 is deliberately a
-- RENAME COLUMN rather than Prisma's default drop-and-add: harmless here only
-- because step 1 already emptied the table, but the rename states the intent.

-- 1. Discard legacy image data. listings."coverPhotoId" self-clears via its
--    existing ON DELETE SET NULL foreign key.
DELETE FROM "listing_photos";

-- 2. position -> displayOrder (FR-040's vocabulary; upload order and display
--    order are genuinely different things now).
ALTER TABLE "listing_photos" RENAME COLUMN "position" TO "displayOrder";

-- 3. Drop the byte columns. This is the point of the feature (FR-045).
ALTER TABLE "listing_photos"
  DROP COLUMN "data",
  DROP COLUMN "mimeType",
  DROP COLUMN "sizeBytes";

-- 4. Add the Cloudinary reference columns. Safe as NOT NULL without defaults
--    because step 1 emptied the table.
ALTER TABLE "listing_photos"
  ADD COLUMN "cloudinaryAssetId" TEXT NOT NULL,
  ADD COLUMN "cloudinaryPublicId" TEXT NOT NULL,
  ADD COLUMN "width" INTEGER NOT NULL,
  ADD COLUMN "height" INTEGER NOT NULL,
  ADD COLUMN "format" TEXT NOT NULL,
  ADD COLUMN "bytes" INTEGER NOT NULL;

-- 5. Uniqueness. cloudinaryPublicId being unique is what makes FR-019 (no
--    duplicate association on a repeated submit) structural rather than policed.
--    The composite unique makes FR-020's contiguous ordering fail loudly on a
--    partial renumber.
CREATE UNIQUE INDEX "listing_photos_cloudinaryAssetId_key" ON "listing_photos"("cloudinaryAssetId");
CREATE UNIQUE INDEX "listing_photos_cloudinaryPublicId_key" ON "listing_photos"("cloudinaryPublicId");
CREATE UNIQUE INDEX "listing_photos_listingId_displayOrder_key" ON "listing_photos"("listingId", "displayOrder");

-- 6. Authorized-but-unassociated uploads, so abandoned assets stay findable
--    (FR-083) and a client-supplied public ID is only ever trusted when the
--    server itself wrote a row for it (FR-030, FR-031).
CREATE TABLE "pending_listing_media" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "listingId" TEXT,
    "cloudinaryPublicId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_listing_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_listing_media_cloudinaryPublicId_key" ON "pending_listing_media"("cloudinaryPublicId");
CREATE INDEX "pending_listing_media_accountId_draftId_idx" ON "pending_listing_media"("accountId", "draftId");
CREATE INDEX "pending_listing_media_expiresAt_idx" ON "pending_listing_media"("expiresAt");

ALTER TABLE "pending_listing_media"
  ADD CONSTRAINT "pending_listing_media_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Retryable Cloudinary deletion. Deliberately NOT community-scoped and with
--    no listingId: it holds only an opaque public ID and outlives the listing it
--    came from (FR-082, FR-085).
CREATE TABLE "media_cleanup_tasks" (
    "id" TEXT NOT NULL,
    "cloudinaryPublicId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_cleanup_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_cleanup_tasks_cloudinaryPublicId_key" ON "media_cleanup_tasks"("cloudinaryPublicId");
CREATE INDEX "media_cleanup_tasks_nextAttemptAt_idx" ON "media_cleanup_tasks"("nextAttemptAt");
