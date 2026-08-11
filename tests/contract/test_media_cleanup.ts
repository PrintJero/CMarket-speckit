import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import {
  createListing,
  deleteListing,
  removeListingPhoto,
  updateListing,
} from "@/server/services/listingService";
import {
  drainCleanup,
  enqueueCleanup,
  sweepExpiredPendingMedia,
} from "@/server/services/mediaCleanupService";
import * as cloudinaryAdmin from "@/lib/cloudinary/admin";

/**
 * T072-T075 (017-cloudinary-listing-media, FR-079-FR-085).
 *
 * destroyAsset is spied on rather than called: no test contacts Cloudinary
 * (research.md #8). The spy also lets the non-blocking test assert that removal
 * makes ZERO provider calls, which is the actual property that makes listing
 * editing outage-proof.
 */

function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: {
      email,
      passwordHash: "irrelevant-hash",
      emailVerifiedAt: new Date(),
      displayName: "Cleanup Test Member",
    },
  });
}

async function seedListing(suffix: string) {
  const admin = await createVerifiedAccount(`cleanup-test-${suffix}@example.com`);
  const result = await createCommunity({
    name: `Cleanup Test Community ${suffix}`,
    founderEmail: admin.email,
    invokedBy: "test-operator",
  });
  if (!result.ok) throw new Error("expected community creation to succeed");
  const created = await createListing({
    communityId: result.community.id,
    ownerId: admin.id,
    title: "Chair",
    description: "Wooden chair",
    priceCents: 1500,
  });
  if (!created.ok) throw new Error("expected listing creation to succeed");
  return { admin, community: result.community, listing: created.listing };
}

let fixtureCounter = 0;
async function attachPhoto(listingId: string, displayOrder: number) {
  fixtureCounter += 1;
  const n = String(fixtureCounter).padStart(6, "0");
  return prisma.listingPhoto.create({
    data: {
      listingId,
      cloudinaryAssetId: `cleanup-asset-${n}`,
      cloudinaryPublicId: `cmarket/test/listings/cleanup/${n}`,
      width: 1600,
      height: 1200,
      format: "jpg",
      bytes: 100_000,
      displayOrder,
    },
  });
}

/**
 * Force a task to be unambiguously due.
 *
 * `nextAttemptAt` defaults to the DATABASE's CURRENT_TIMESTAMP, while
 * drainCleanup() compares it against the APPLICATION's `new Date()`. Those are
 * two different clocks: the Postgres container's and the host's. They normally
 * agree within a few milliseconds, but Docker Desktop's VM clock drifts after a
 * suspend/resume, and when the container runs even a few milliseconds ahead a
 * freshly inserted row is not yet "due" — so an immediate drain matches nothing
 * and the test fails intermittently.
 *
 * Production never hits this: the drain is scheduled minutes after the enqueue.
 * Backdating here removes the race while testing exactly the same behaviour —
 * that a due row gets drained.
 */
async function makeDue(cloudinaryPublicId: string): Promise<void> {
  await prisma.mediaCleanupTask.update({
    where: { cloudinaryPublicId },
    data: { nextAttemptAt: new Date(Date.now() - 60_000) },
  });
}

async function resetFixtures() {
  // Clears the ENTIRE queue, not just this file's own prefix. Other contract
  // files (test_listings.ts in particular) enqueue cleanup as a side effect of
  // removing photos and deleting listings, and those rows are indistinguishable
  // from this file's once they are in the queue. Since this is the file that
  // asserts on queue behaviour, it starts from a known-empty queue.
  await prisma.mediaCleanupTask.deleteMany({});
  await prisma.pendingListingMedia.deleteMany({
    where: { cloudinaryPublicId: { contains: "cmarket/test/listings/cleanup/" } },
  });
  await prisma.community.deleteMany({ where: { name: { contains: "Cleanup Test Community" } } });
  await prisma.account.deleteMany({ where: { email: { contains: "cleanup-test-" } } });
}

describe("media cleanup (contract)", () => {
  beforeEach(resetFixtures);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await resetFixtures();
    await prisma.$disconnect();
  });

  it("enqueues idempotently — the same public id twice yields one row", async () => {
    await prisma.$transaction(async (tx) => {
      await enqueueCleanup(tx, ["cmarket/test/listings/cleanup/dupe"]);
      await enqueueCleanup(tx, ["cmarket/test/listings/cleanup/dupe"]);
    });

    expect(
      await prisma.mediaCleanupTask.count({
        where: { cloudinaryPublicId: "cmarket/test/listings/cleanup/dupe" },
      }),
    ).toBe(1);

    await prisma.mediaCleanupTask.deleteMany({
      where: { cloudinaryPublicId: "cmarket/test/listings/cleanup/dupe" },
    });
  });

  it("removes a photo, renumbers contiguously, and enqueues exactly one task (FR-020, FR-079)", async () => {
    const { admin, listing } = await seedListing("remove");
    const first = await attachPhoto(listing.id, 0);
    const second = await attachPhoto(listing.id, 1);
    const third = await attachPhoto(listing.id, 2);
    await prisma.listing.update({ where: { id: listing.id }, data: { coverPhotoId: first.id } });

    const result = await removeListingPhoto({
      listingId: listing.id,
      photoId: first.id,
      callerAccountId: admin.id,
    });
    expect(result).toEqual({ ok: true });

    // FR-020: contiguous from 0, NOT a gap left where index 0 used to be. This is
    // a deliberate change from the previous implementation.
    const remaining = await prisma.listingPhoto.findMany({
      where: { listingId: listing.id },
      orderBy: { displayOrder: "asc" },
    });
    expect(remaining.map((p) => p.displayOrder)).toEqual([0, 1]);
    expect(remaining.map((p) => p.id)).toEqual([second.id, third.id]);

    // FR-018: the cover was removed, so the lowest-ordered survivor is promoted.
    const updated = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(updated.coverPhotoId).toBe(second.id);

    expect(
      await prisma.mediaCleanupTask.count({
        where: { cloudinaryPublicId: first.cloudinaryPublicId },
      }),
    ).toBe(1);
  });

  it("enqueues cleanup for EVERY photo when a listing is deleted, before the cascade (FR-080)", async () => {
    const { admin, listing } = await seedListing("delete");
    const photos = await Promise.all([
      attachPhoto(listing.id, 0),
      attachPhoto(listing.id, 1),
      attachPhoto(listing.id, 2),
    ]);

    expect(await deleteListing({ listingId: listing.id, callerAccountId: admin.id })).toEqual({
      ok: true,
    });

    // THE ORDERING TRAP. ListingPhoto has onDelete: Cascade, so the delete
    // destroys the only record of which assets existed. Zero rows here would mean
    // cleanup was enqueued AFTER the cascade — silently orphaning every asset of
    // every deleted listing, with nothing left to say they were ever there.
    const tasks = await prisma.mediaCleanupTask.findMany({
      where: { cloudinaryPublicId: { in: photos.map((p) => p.cloudinaryPublicId) } },
    });
    expect(tasks).toHaveLength(3);
    expect(await prisma.listingPhoto.count({ where: { listingId: listing.id } })).toBe(0);
  });

  /**
   * These two assert on the SPECIFIC row rather than on drainCleanup's aggregate
   * counters. The counters describe a queue that every other test in the suite
   * also writes to, so asserting `result.deleted >= 1` is order-dependent and
   * says nothing about the row under test — a drain bounded by `take: limit` can
   * legitimately process someone else's rows instead. The row's own end state is
   * both the thing that matters and the thing that is deterministic.
   */
  it("drains a due task and deletes the row on success", async () => {
    const destroy = vi.spyOn(cloudinaryAdmin, "destroyAsset").mockResolvedValue(true);
    const publicId = `cmarket/test/listings/cleanup/drain-${Date.now()}`;
    await prisma.$transaction((tx) => enqueueCleanup(tx, [publicId]));
    await makeDue(publicId);

    // Large enough that this row cannot be crowded out of the batch by rows
    // other tests left behind.
    await drainCleanup({ limit: 200 });

    expect(destroy).toHaveBeenCalledWith(publicId);
    expect(await prisma.mediaCleanupTask.count({ where: { cloudinaryPublicId: publicId } })).toBe(0);
  });

  it("records a failure for retry with backoff instead of losing the asset (FR-082)", async () => {
    vi.spyOn(cloudinaryAdmin, "destroyAsset").mockResolvedValue(false);
    const publicId = `cmarket/test/listings/cleanup/fail-${Date.now()}`;
    await prisma.$transaction((tx) => enqueueCleanup(tx, [publicId]));
    await makeDue(publicId);

    const before = new Date();
    await drainCleanup({ limit: 200 });

    // The asset is NOT lost: the row survives, carrying why and when to retry.
    const task = await prisma.mediaCleanupTask.findUniqueOrThrow({
      where: { cloudinaryPublicId: publicId },
    });
    expect(task.attempts).toBe(1);
    expect(task.lastError).toBeTruthy();
    expect(task.nextAttemptAt.getTime()).toBeGreaterThan(before.getTime());

    await prisma.mediaCleanupTask.deleteMany({ where: { cloudinaryPublicId: publicId } });
  });

  it("sweeps an expired, never-associated pending upload into cleanup (FR-083)", async () => {
    const { admin, community } = await seedListing("sweep");
    await prisma.pendingListingMedia.create({
      data: {
        accountId: admin.id,
        communityId: community.id,
        draftId: "abandoned-draft",
        cloudinaryPublicId: "cmarket/test/listings/cleanup/abandoned",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const swept = await sweepExpiredPendingMedia();

    expect(swept).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.mediaCleanupTask.count({
        where: { cloudinaryPublicId: "cmarket/test/listings/cleanup/abandoned" },
      }),
    ).toBe(1);
    // The pending row itself is consumed, so it is not swept twice.
    expect(
      await prisma.pendingListingMedia.count({
        where: { cloudinaryPublicId: "cmarket/test/listings/cleanup/abandoned" },
      }),
    ).toBe(0);
  });

  /**
   * T075. Asserted as TWO HALVES, because the single-statement version of this
   * test ("removal succeeds while destroyAsset fails") would pass vacuously:
   * removal never calls Cloudinary at all, so stubbing a failure proves nothing.
   */
  describe("a Cloudinary outage never becomes a listing-editing outage (FR-085)", () => {
    it("half 1: removing a photo succeeds WITHOUT calling Cloudinary, committing one task", async () => {
      const destroy = vi.spyOn(cloudinaryAdmin, "destroyAsset").mockResolvedValue(false);
      const { admin, listing } = await seedListing("nonblock-a");
      const photo = await attachPhoto(listing.id, 0);

      const removal = await removeListingPhoto({
        listingId: listing.id,
        photoId: photo.id,
        callerAccountId: admin.id,
      });

      expect(removal).toEqual({ ok: true });
      // The property that actually makes removal outage-proof: it does not
      // contact the provider, so provider health is irrelevant to it.
      expect(destroy).not.toHaveBeenCalled();
      expect(
        await prisma.mediaCleanupTask.count({
          where: { cloudinaryPublicId: photo.cloudinaryPublicId },
        }),
      ).toBe(1);
    });

    it("half 2: a failing drain leaves the task retryable and the listing edit committed", async () => {
      vi.spyOn(cloudinaryAdmin, "destroyAsset").mockResolvedValue(false);
      const { admin, listing } = await seedListing("nonblock-b");
      const photo = await attachPhoto(listing.id, 0);

      await removeListingPhoto({
        listingId: listing.id,
        photoId: photo.id,
        callerAccountId: admin.id,
      });

      // An unrelated listing edit, to prove it stays committed across the drain.
      const edit = await updateListing({
        listingId: listing.id,
        callerAccountId: admin.id,
        title: "Chair (reduced)",
      });
      expect(edit.ok).toBe(true);

      await makeDue(photo.cloudinaryPublicId);
      await drainCleanup({ limit: 200 });

      const task = await prisma.mediaCleanupTask.findUniqueOrThrow({
        where: { cloudinaryPublicId: photo.cloudinaryPublicId },
      });
      expect(task.attempts).toBe(1);
      expect(task.lastError).toBeTruthy();
      expect(task.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      const persisted = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(persisted.title).toBe("Chair (reduced)");
      expect(await prisma.listingPhoto.count({ where: { listingId: listing.id } })).toBe(0);
    });
  });
});
