import { prisma } from "@/lib/prisma";
import { requireCommunityAdministrator } from "@/server/services/invitationService";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS_PER_LISTING = 6;
const ALLOWED_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * research.md #2: the "any role" counterpart to invitationService.ts's
 * requireCommunityAdministrator() — used to gate creation and viewing.
 */
export async function requireCommunityMembership(
  accountId: string,
  communityId: string,
): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId, communityId } },
  });
  return membership !== null;
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function isValidPriceCents(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export type CreateListingResult =
  | {
      ok: true;
      listing: {
        id: string;
        communityId: string;
        ownerId: string;
        title: string;
        description: string;
        priceCents: number;
        status: "ACTIVE" | "PAUSED";
      };
    }
  | { ok: false; reason: "invalid_input" }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "display_name_required" };

export interface CreateListingInput {
  communityId: string;
  ownerId: string;
  title: string;
  description: string;
  priceCents: number;
}

/**
 * FR-001, FR-002, FR-005. FR-008 (006-user-display-names): the caller MUST
 * already have a displayName — checked here, not only in the listing-
 * creation form, so the guarantee holds regardless of how the request
 * arrives (research.md #3 of that feature).
 */
export async function createListing(input: CreateListingInput): Promise<CreateListingResult> {
  if (isBlank(input.title) || isBlank(input.description) || !isValidPriceCents(input.priceCents)) {
    return { ok: false, reason: "invalid_input" };
  }

  if (!(await requireCommunityMembership(input.ownerId, input.communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const owner = await prisma.account.findUnique({ where: { id: input.ownerId } });
  if (!owner?.displayName) {
    return { ok: false, reason: "display_name_required" };
  }

  const listing = await prisma.listing.create({
    data: {
      communityId: input.communityId,
      ownerId: input.ownerId,
      title: input.title,
      description: input.description,
      priceCents: input.priceCents,
    },
  });

  return {
    ok: true,
    listing: {
      id: listing.id,
      communityId: listing.communityId,
      ownerId: listing.ownerId,
      title: listing.title,
      description: listing.description,
      priceCents: listing.priceCents,
      status: listing.status,
    },
  };
}

export type AddListingPhotoResult =
  | { ok: true; photo: { id: string; position: number } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_owner" }
  | { ok: false; reason: "invalid_photo" }
  | { ok: false; reason: "photo_limit_reached" };

export interface AddListingPhotoInput {
  listingId: string;
  callerAccountId: string;
  data: Buffer;
  mimeType: string;
}

/** FR-003, FR-006. sizeBytes is derived from `data`, never trusted from the caller. */
export async function addListingPhoto(input: AddListingPhotoInput): Promise<AddListingPhotoResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };

  if (!ALLOWED_PHOTO_MIME_TYPES.has(input.mimeType) || input.data.length > MAX_PHOTO_BYTES) {
    return { ok: false, reason: "invalid_photo" };
  }

  const existingCount = await prisma.listingPhoto.count({ where: { listingId: input.listingId } });
  if (existingCount >= MAX_PHOTOS_PER_LISTING) {
    return { ok: false, reason: "photo_limit_reached" };
  }

  const photo = await prisma.listingPhoto.create({
    data: {
      listingId: input.listingId,
      data: Uint8Array.from(input.data),
      mimeType: input.mimeType,
      sizeBytes: input.data.length,
      position: existingCount,
    },
  });

  if (listing.coverPhotoId === null) {
    await prisma.listing.update({
      where: { id: input.listingId },
      data: { coverPhotoId: photo.id },
    });
  }

  return { ok: true, photo: { id: photo.id, position: photo.position } };
}

export type ListListingsResult =
  | {
      ok: true;
      listings: {
        id: string;
        title: string;
        priceCents: number;
        status: "ACTIVE" | "PAUSED";
        ownerId: string;
        createdAt: Date;
        coverPhotoId: string | null;
        ownerDisplayName: string | null;
      }[];
      page: number;
      pageSize: number;
      hasMore: boolean;
    }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "invalid_input" };

export interface ListListingsOptions {
  search?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * FR-011, FR-012: only ACTIVE listings, only for a caller with membership in
 * communityId. 007-listing-discovery extends this with keyword search, a
 * price range, and pagination — all folded into the one findMany call below
 * (research.md #1-#4): never a second query, never an in-memory filter/sort/slice.
 */
export async function listListings(
  communityId: string,
  callerAccountId: string,
  options: ListListingsOptions = {},
): Promise<ListListingsResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const { search, minPriceCents, maxPriceCents } = options;
  if (
    minPriceCents !== undefined &&
    maxPriceCents !== undefined &&
    minPriceCents > maxPriceCents
  ) {
    return { ok: false, reason: "invalid_input" };
  }

  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(options.pageSize ?? DEFAULT_PAGE_SIZE)));

  const listings = await prisma.listing.findMany({
    where: {
      communityId,
      status: "ACTIVE",
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(minPriceCents !== undefined || maxPriceCents !== undefined
        ? {
            priceCents: {
              ...(minPriceCents !== undefined ? { gte: minPriceCents } : {}),
              ...(maxPriceCents !== undefined ? { lte: maxPriceCents } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
    include: { owner: { select: { displayName: true } } },
  });

  const hasMore = listings.length > pageSize;
  const pageListings = listings.slice(0, pageSize);

  return {
    ok: true,
    listings: pageListings.map((listing) => ({
      id: listing.id,
      title: listing.title,
      priceCents: listing.priceCents,
      status: listing.status,
      ownerId: listing.ownerId,
      createdAt: listing.createdAt,
      coverPhotoId: listing.coverPhotoId,
      ownerDisplayName: listing.owner.displayName,
    })),
    page,
    pageSize,
    hasMore,
  };
}

export type GetListingResult =
  | {
      ok: true;
      listing: {
        id: string;
        communityId: string;
        ownerId: string;
        title: string;
        description: string;
        priceCents: number;
        status: "ACTIVE" | "PAUSED";
        coverPhotoId: string | null;
        ownerDisplayName: string | null;
        photos: { id: string; position: number }[];
      };
    }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" };

/** FR-011, FR-012: any status, but only within the caller's own community. */
export async function getListing(
  communityId: string,
  listingId: string,
  callerAccountId: string,
): Promise<GetListingResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      photos: { orderBy: { position: "asc" } },
      owner: { select: { displayName: true } },
    },
  });
  if (!listing || listing.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }

  return {
    ok: true,
    listing: {
      id: listing.id,
      communityId: listing.communityId,
      ownerId: listing.ownerId,
      title: listing.title,
      description: listing.description,
      priceCents: listing.priceCents,
      status: listing.status,
      coverPhotoId: listing.coverPhotoId,
      ownerDisplayName: listing.owner.displayName,
      photos: listing.photos.map((photo) => ({ id: photo.id, position: photo.position })),
    },
  };
}

export type GetListingPhotoResult =
  | { ok: true; photo: { data: Buffer; mimeType: string } }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" };

/** FR-003, FR-012: streams a photo's bytes, gated by membership in communityId. */
export async function getListingPhoto(
  communityId: string,
  listingId: string,
  photoId: string,
  callerAccountId: string,
): Promise<GetListingPhotoResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const photo = await prisma.listingPhoto.findUnique({
    where: { id: photoId },
    include: { listing: true },
  });
  if (!photo || photo.listingId !== listingId || photo.listing.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, photo: { data: Buffer.from(photo.data), mimeType: photo.mimeType } };
}

export type UpdateListingResult =
  | {
      ok: true;
      listing: {
        id: string;
        communityId: string;
        ownerId: string;
        title: string;
        description: string;
        priceCents: number;
        status: "ACTIVE" | "PAUSED";
      };
    }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_owner" }
  | { ok: false; reason: "invalid_input" };

export interface UpdateListingInput {
  listingId: string;
  callerAccountId: string;
  title?: string;
  description?: string;
  priceCents?: number;
}

/** FR-006. Ownership check alone — never requireCommunityAdministrator (FR-010). */
export async function updateListing(input: UpdateListingInput): Promise<UpdateListingResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };

  if (input.title !== undefined && isBlank(input.title)) return { ok: false, reason: "invalid_input" };
  if (input.description !== undefined && isBlank(input.description)) {
    return { ok: false, reason: "invalid_input" };
  }
  if (input.priceCents !== undefined && !isValidPriceCents(input.priceCents)) {
    return { ok: false, reason: "invalid_input" };
  }

  const updated = await prisma.listing.update({
    where: { id: input.listingId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
    },
  });

  return {
    ok: true,
    listing: {
      id: updated.id,
      communityId: updated.communityId,
      ownerId: updated.ownerId,
      title: updated.title,
      description: updated.description,
      priceCents: updated.priceCents,
      status: updated.status,
    },
  };
}

export type RemoveListingPhotoResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_owner" };

export interface RemoveListingPhotoInput {
  listingId: string;
  photoId: string;
  callerAccountId: string;
}

/**
 * FR-006. Same ownership check as updateListing. Leaves a gap in position (data-model.md).
 * FR-017 (2026-07-17 amendment): if the removed photo was the cover, promotes the remaining
 * photo with the lowest position, or clears coverPhotoId if none remain.
 */
export async function removeListingPhoto(input: RemoveListingPhotoInput): Promise<RemoveListingPhotoResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };

  const photo = await prisma.listingPhoto.findUnique({ where: { id: input.photoId } });
  if (!photo || photo.listingId !== input.listingId) return { ok: false, reason: "not_found" };

  await prisma.$transaction(async (tx) => {
    await tx.listingPhoto.delete({ where: { id: input.photoId } });

    if (listing.coverPhotoId === input.photoId) {
      const nextCover = await tx.listingPhoto.findFirst({
        where: { listingId: input.listingId },
        orderBy: { position: "asc" },
      });
      await tx.listing.update({
        where: { id: input.listingId },
        data: { coverPhotoId: nextCover?.id ?? null },
      });
    }
  });

  return { ok: true };
}

export type SetCoverPhotoResult =
  | { ok: true; listing: { id: string; coverPhotoId: string } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_owner" };

export interface SetCoverPhotoInput {
  listingId: string;
  photoId: string;
  callerAccountId: string;
}

/** FR-016 (2026-07-17 amendment). Same ownership check as updateListing/removeListingPhoto. */
export async function setCoverPhoto(input: SetCoverPhotoInput): Promise<SetCoverPhotoResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };

  const photo = await prisma.listingPhoto.findUnique({ where: { id: input.photoId } });
  if (!photo || photo.listingId !== input.listingId) return { ok: false, reason: "not_found" };

  const updated = await prisma.listing.update({
    where: { id: input.listingId },
    data: { coverPhotoId: photo.id },
  });

  return { ok: true, listing: { id: updated.id, coverPhotoId: updated.coverPhotoId! } };
}

export type PauseListingResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_authorized" };

export interface PauseListingInput {
  listingId: string;
  callerAccountId: string;
}

/**
 * FR-007, FR-009: the owner, or that community's own administrator, may
 * pause/reactivate — no transaction is needed since setting status is
 * idempotent by construction (research.md #3).
 */
async function canModerateListing(
  listing: { ownerId: string; communityId: string },
  callerAccountId: string,
): Promise<boolean> {
  if (listing.ownerId === callerAccountId) return true;
  return requireCommunityAdministrator(callerAccountId, listing.communityId);
}

export async function pauseListing(input: PauseListingInput): Promise<PauseListingResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (!(await canModerateListing(listing, input.callerAccountId))) {
    return { ok: false, reason: "not_authorized" };
  }

  await prisma.listing.update({ where: { id: input.listingId }, data: { status: "PAUSED" } });
  return { ok: true };
}

export async function reactivateListing(input: PauseListingInput): Promise<PauseListingResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (!(await canModerateListing(listing, input.callerAccountId))) {
    return { ok: false, reason: "not_authorized" };
  }

  await prisma.listing.update({ where: { id: input.listingId }, data: { status: "ACTIVE" } });
  return { ok: true };
}

export type DeleteListingResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_owner" };

export interface DeleteListingInput {
  listingId: string;
  callerAccountId: string;
}

/**
 * FR-008, FR-010: ownership check alone — never requireCommunityAdministrator,
 * by design. Cascades to ListingPhoto via onDelete: Cascade (no $transaction
 * needed — data-model.md's Atomicity note).
 */
export async function deleteListing(input: DeleteListingInput): Promise<DeleteListingResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };

  await prisma.listing.delete({ where: { id: input.listingId } });
  return { ok: true };
}

export type ListMyListingsResult = {
  ok: true;
  listings: {
    id: string;
    communityId: string;
    communityName: string;
    title: string;
    status: "ACTIVE" | "PAUSED";
    threadCount: number;
  }[];
};

/**
 * FR-021, FR-022, FR-024 (008-listing-messaging, 2026-07-17 amendment): every
 * listing the caller owns, in any status, across every community they
 * currently belong to, each with a database-computed thread count. Scoped
 * entirely from the caller's own current `Membership` rows (never a
 * caller-supplied community list), mirroring `messageService.ts`'s
 * `listMyThreads()`. No error branch — always succeeds, `listings: []` for
 * an account that owns nothing (Edge Cases).
 */
export async function listMyListings(callerAccountId: string): Promise<ListMyListingsResult> {
  const memberships = await prisma.membership.findMany({
    where: { accountId: callerAccountId },
    select: { communityId: true },
  });
  const communityIds = memberships.map((membership) => membership.communityId);
  if (communityIds.length === 0) {
    return { ok: true, listings: [] };
  }

  const listings = await prisma.listing.findMany({
    where: { ownerId: callerAccountId, communityId: { in: communityIds } },
    orderBy: { createdAt: "desc" },
    include: {
      community: { select: { name: true } },
      _count: { select: { threads: true } },
    },
  });

  return {
    ok: true,
    listings: listings.map((listing) => ({
      id: listing.id,
      communityId: listing.communityId,
      communityName: listing.community.name,
      title: listing.title,
      status: listing.status,
      threadCount: listing._count.threads,
    })),
  };
}
