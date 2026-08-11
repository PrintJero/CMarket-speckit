import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { destroyAsset } from "@/lib/cloudinary/admin";

/**
 * Retryable Cloudinary asset cleanup (017-cloudinary-listing-media, FR-079,
 * FR-082, FR-085).
 *
 * The central guarantee: a Cloudinary outage must never become a
 * listing-editing outage. So the write path only ever ENQUEUES — it never calls
 * Cloudinary — and an out-of-band drain does the deleting with backoff.
 */

/** Transaction client, so callers can enqueue inside their own $transaction. */
type Tx = Prisma.TransactionClient;

/**
 * FR-079: record assets that must be removed from Cloudinary.
 *
 * MUST be called inside the caller's transaction, and — for listing deletion —
 * BEFORE the delete that cascades ListingPhoto away. Getting that order wrong
 * destroys the only record of which assets existed and silently orphans every
 * one of them (data-model.md §4).
 *
 * Idempotent: cloudinaryPublicId is unique, so a retried operation cannot queue
 * the same asset twice.
 */
export async function enqueueCleanup(tx: Tx, cloudinaryPublicIds: string[]): Promise<void> {
  if (cloudinaryPublicIds.length === 0) return;
  await tx.mediaCleanupTask.createMany({
    data: cloudinaryPublicIds.map((cloudinaryPublicId) => ({ cloudinaryPublicId })),
    skipDuplicates: true,
  });
}

/** Backoff cap: 24 hours (FR-082). */
const MAX_BACKOFF_MINUTES = 24 * 60;

function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, MAX_BACKOFF_MINUTES);
}

export interface DrainCleanupResult {
  processed: number;
  deleted: number;
  failed: number;
  expiredPendingSwept: number;
}

/**
 * FR-082: drain due cleanup tasks. Called by POST /api/listing-media/cleanup on
 * whatever schedule the deployment already has — no new queue infrastructure.
 *
 * A failure leaves the row in place with attempts incremented, lastError
 * recorded, and nextAttemptAt pushed out, so the asset is retried rather than
 * silently orphaned. Never throws out of the loop: one poisoned row must not
 * stop the rest of the drain.
 */
export async function drainCleanup(options: { limit?: number } = {}): Promise<DrainCleanupResult> {
  const limit = Math.min(Math.max(1, options.limit ?? 50), 200);

  const expiredPendingSwept = await sweepExpiredPendingMedia();

  const due = await prisma.mediaCleanupTask.findMany({
    where: { nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });

  let deleted = 0;
  let failed = 0;

  for (const task of due) {
    let succeeded = false;
    let message = "destroy returned false";
    try {
      succeeded = await destroyAsset(task.cloudinaryPublicId);
    } catch (cause) {
      succeeded = false;
      message = cause instanceof Error ? cause.message : "unknown error";
    }

    if (succeeded) {
      await prisma.mediaCleanupTask.delete({ where: { id: task.id } });
      deleted += 1;
      continue;
    }

    const attempts = task.attempts + 1;
    await prisma.mediaCleanupTask.update({
      where: { id: task.id },
      data: {
        attempts,
        lastError: message.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + backoffMinutes(attempts) * 60_000),
      },
    });
    failed += 1;
  }

  return { processed: due.length, deleted, failed, expiredPendingSwept };
}

/**
 * FR-083: an authorized upload that was never associated is only identifiable
 * because PendingListingMedia is persisted rather than being a stateless token.
 * Expired rows with no referencing ListingPhoto become cleanup tasks.
 */
export async function sweepExpiredPendingMedia(): Promise<number> {
  const expired = await prisma.pendingListingMedia.findMany({
    where: { expiresAt: { lt: new Date() } },
    take: 200,
  });
  if (expired.length === 0) return 0;

  const publicIds = expired.map((row) => row.cloudinaryPublicId);
  const associated = await prisma.listingPhoto.findMany({
    where: { cloudinaryPublicId: { in: publicIds } },
    select: { cloudinaryPublicId: true },
  });
  const associatedIds = new Set(associated.map((row) => row.cloudinaryPublicId));
  const orphaned = publicIds.filter((id) => !associatedIds.has(id));

  await prisma.$transaction(async (tx) => {
    await enqueueCleanup(tx, orphaned);
    await tx.pendingListingMedia.deleteMany({
      where: { id: { in: expired.map((row) => row.id) } },
    });
  });

  return orphaned.length;
}

/**
 * FR-020: rewrite a listing's displayOrder contiguously from 0, preserving
 * current relative order.
 *
 * Two passes through a temporary NEGATIVE offset, because
 * @@unique([listingId, displayOrder]) makes a direct renumber collide with rows
 * it has not moved yet — a swap of orders 0 and 1 transiently needs two rows at
 * the same value. Negative values can never collide with a real order.
 *
 * Lives here rather than in listingService because both listingService's
 * removal path and listingMediaService's association/reorder paths need it.
 */
export async function renumberListingPhotos(
  tx: Tx,
  listingId: string,
  orderedPhotoIds?: string[],
): Promise<void> {
  const photos =
    orderedPhotoIds ??
    (
      await tx.listingPhoto.findMany({
        where: { listingId },
        orderBy: { displayOrder: "asc" },
        select: { id: true },
      })
    ).map((photo) => photo.id);

  for (const [index, id] of photos.entries()) {
    await tx.listingPhoto.update({ where: { id }, data: { displayOrder: -(index + 1) } });
  }
  for (const [index, id] of photos.entries()) {
    await tx.listingPhoto.update({ where: { id }, data: { displayOrder: index } });
  }
}
