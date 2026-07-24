import { prisma } from "@/lib/prisma";
import { requireCommunityAdministrator } from "@/server/services/invitationService";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS_PER_LISTING = 6;
const ALLOWED_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface CommunityGateOptions {
  /** FR-052: viewing existing content and replying in existing threads tolerate SUSPENDED. */
  allowSuspended?: boolean;
}

/**
 * research.md #2: the "any role" counterpart to invitationService.ts's
 * requireCommunityAdministrator() — used to gate creation and viewing.
 * 009-platform-administration, research.md #8/#15: also requires the
 * community itself to be ACTIVE (or SUSPENDED when the caller explicitly
 * tolerates that, e.g. viewing existing content) and that the caller's own
 * membership row is stamped with the community's *current* operationalEpoch
 * — a membership predating a restoration no longer counts as current.
 */
export async function requireCommunityMembership(
  accountId: string,
  communityId: string,
  options: CommunityGateOptions = {},
): Promise<boolean> {
  const community = await prisma.community.findUnique({ where: { id: communityId } });
  if (!community) return false;
  if (community.status === "ARCHIVED") return false;
  if (community.status === "SUSPENDED" && !options.allowSuspended) return false;

  const membership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId, communityId } },
  });
  return membership !== null && membership.operationalEpoch === community.operationalEpoch;
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
 * arrives (research.md #3 of that feature). 009-platform-administration:
 * creating a listing is a growth action, so the membership check defaults to
 * requiring ACTIVE (no allowSuspended) — a SUSPENDED community rejects this
 * the same way a non-member would (FR-053). The new row is stamped with the
 * community's current operationalEpoch (research.md #8).
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

  const community = await prisma.community.findUnique({
    where: { id: input.communityId },
    select: { operationalEpoch: true },
  });

  const listing = await prisma.listing.create({
    data: {
      communityId: input.communityId,
      ownerId: input.ownerId,
      title: input.title,
      description: input.description,
      priceCents: input.priceCents,
      operationalEpoch: community?.operationalEpoch ?? 1,
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
  | { ok: false; reason: "photo_limit_reached" }
  | { ok: false; reason: "community_not_active" };

export interface AddListingPhotoInput {
  listingId: string;
  callerAccountId: string;
  data: Buffer;
  mimeType: string;
}

/**
 * FR-003, FR-006. sizeBytes is derived from `data`, never trusted from the
 * caller. 009-platform-administration, FR-053: adding a photo is a listing
 * content edit, blocked while the community is SUSPENDED or ARCHIVED.
 */
export async function addListingPhoto(input: AddListingPhotoInput): Promise<AddListingPhotoResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };
  if (!(await isCommunityActive(listing.communityId))) {
    return { ok: false, reason: "community_not_active" };
  }

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
 * 009-platform-administration, FR-052: viewing tolerates a SUSPENDED community.
 * Every returned row is additionally filtered to the community's current
 * operationalEpoch (research.md #8) via the same findMany's `where`.
 */
export async function listListings(
  communityId: string,
  callerAccountId: string,
  options: ListListingsOptions = {},
): Promise<ListListingsResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
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

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { operationalEpoch: true },
  });

  const listings = await prisma.listing.findMany({
    where: {
      communityId,
      status: "ACTIVE",
      operationalEpoch: community?.operationalEpoch ?? 1,
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

/**
 * FR-011, FR-012: any status, but only within the caller's own community.
 * 009-platform-administration, FR-052: tolerates a SUSPENDED community; a
 * pre-restoration listing (a stale operationalEpoch) reads as not_found,
 * identically to a listing that never existed (research.md #8).
 */
export async function getListing(
  communityId: string,
  listingId: string,
  callerAccountId: string,
): Promise<GetListingResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { operationalEpoch: true },
  });

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      photos: { orderBy: { position: "asc" } },
      owner: { select: { displayName: true } },
    },
  });
  if (
    !listing ||
    listing.communityId !== communityId ||
    listing.operationalEpoch !== (community?.operationalEpoch ?? 1)
  ) {
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

/**
 * FR-003, FR-012: streams a photo's bytes, gated by membership in communityId.
 * 009-platform-administration, FR-052: tolerates a SUSPENDED community.
 */
export async function getListingPhoto(
  communityId: string,
  listingId: string,
  photoId: string,
  callerAccountId: string,
): Promise<GetListingPhotoResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
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
  | { ok: false; reason: "invalid_input" }
  | { ok: false; reason: "community_not_active" };

export interface UpdateListingInput {
  listingId: string;
  callerAccountId: string;
  title?: string;
  description?: string;
  priceCents?: number;
}

/**
 * FR-006. Ownership check alone — never requireCommunityAdministrator (FR-010).
 * 009-platform-administration, FR-053: a listing content edit is blocked
 * while the community is SUSPENDED or ARCHIVED.
 */
export async function updateListing(input: UpdateListingInput): Promise<UpdateListingResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };
  if (!(await isCommunityActive(listing.communityId))) {
    return { ok: false, reason: "community_not_active" };
  }

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
  | { ok: false; reason: "not_owner" }
  | { ok: false; reason: "community_not_active" };

export interface RemoveListingPhotoInput {
  listingId: string;
  photoId: string;
  callerAccountId: string;
}

/**
 * FR-006. Same ownership check as updateListing. Leaves a gap in position (data-model.md).
 * FR-017 (2026-07-17 amendment): if the removed photo was the cover, promotes the remaining
 * photo with the lowest position, or clears coverPhotoId if none remain.
 * 009-platform-administration, FR-053: blocked while the community is SUSPENDED/ARCHIVED.
 */
export async function removeListingPhoto(input: RemoveListingPhotoInput): Promise<RemoveListingPhotoResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };
  if (!(await isCommunityActive(listing.communityId))) {
    return { ok: false, reason: "community_not_active" };
  }

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
  | { ok: false; reason: "not_owner" }
  | { ok: false; reason: "community_not_active" };

export interface SetCoverPhotoInput {
  listingId: string;
  photoId: string;
  callerAccountId: string;
}

/**
 * FR-016 (2026-07-17 amendment). Same ownership check as updateListing/removeListingPhoto.
 * 009-platform-administration, FR-053: blocked while the community is SUSPENDED/ARCHIVED.
 */
export async function setCoverPhoto(input: SetCoverPhotoInput): Promise<SetCoverPhotoResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };
  if (!(await isCommunityActive(listing.communityId))) {
    return { ok: false, reason: "community_not_active" };
  }

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
  | { ok: false; reason: "not_authorized" }
  | { ok: false; reason: "community_not_active" };

export interface PauseListingInput {
  listingId: string;
  callerAccountId: string;
}

/** Community-level status only (ARCHIVED excludes both; SUSPENDED excludes only via `requireActive`). */
async function isCommunityActive(communityId: string): Promise<boolean> {
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { status: true } });
  return community?.status === "ACTIVE";
}

async function communityAllowsExistingContent(communityId: string): Promise<boolean> {
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { status: true } });
  return community?.status === "ACTIVE" || community?.status === "SUSPENDED";
}

/**
 * FR-007, FR-009: the owner, or that community's own administrator, may
 * pause/reactivate — no transaction is needed since setting status is
 * idempotent by construction (research.md #3). 009-platform-administration,
 * FR-054: pausing is explicitly allowed while SUSPENDED (it reduces
 * exposure); FR-053: reactivating a paused listing is not.
 */
async function canModerateListing(
  listing: { ownerId: string; communityId: string },
  callerAccountId: string,
  options: CommunityGateOptions = {},
): Promise<boolean> {
  if (listing.ownerId === callerAccountId) return true;
  return requireCommunityAdministrator(callerAccountId, listing.communityId, options);
}

export async function pauseListing(input: PauseListingInput): Promise<PauseListingResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (!(await communityAllowsExistingContent(listing.communityId))) {
    return { ok: false, reason: "community_not_active" };
  }
  if (!(await canModerateListing(listing, input.callerAccountId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_authorized" };
  }

  await prisma.listing.update({ where: { id: input.listingId }, data: { status: "PAUSED" } });
  return { ok: true };
}

export async function reactivateListing(input: PauseListingInput): Promise<PauseListingResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (!(await isCommunityActive(listing.communityId))) {
    return { ok: false, reason: "community_not_active" };
  }
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
 * needed — data-model.md's Atomicity note). Not restricted by community
 * suspension (spec.md Edge Cases names only pausing as explicitly permitted;
 * deletion is left unrestricted rather than speculatively gated).
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
 *
 * 009-platform-administration, research.md #8: "current" membership means a
 * `Membership.operationalEpoch` matching that community's *own* current
 * `operationalEpoch` — a membership predating a restoration no longer
 * counts. Each candidate community's current epoch is fetched once (via the
 * membership include) into a small map, then both the community-id filter
 * and the returned listings themselves are checked against it, so a listing
 * that predates a restoration is excluded even though its `ownerId` is
 * unchanged. Bounded by the caller's own membership count — never a
 * full-table scan.
 */
export async function listMyListings(callerAccountId: string): Promise<ListMyListingsResult> {
  const memberships = await prisma.membership.findMany({
    where: { accountId: callerAccountId },
    include: { community: { select: { operationalEpoch: true } } },
  });
  const currentEpochByCommunity = new Map<string, number>();
  for (const membership of memberships) {
    if (membership.operationalEpoch === membership.community.operationalEpoch) {
      currentEpochByCommunity.set(membership.communityId, membership.community.operationalEpoch);
    }
  }
  if (currentEpochByCommunity.size === 0) {
    return { ok: true, listings: [] };
  }

  const listings = await prisma.listing.findMany({
    where: { ownerId: callerAccountId, communityId: { in: [...currentEpochByCommunity.keys()] } },
    orderBy: { createdAt: "desc" },
    include: {
      community: { select: { name: true } },
      _count: { select: { threads: true } },
    },
  });

  return {
    ok: true,
    listings: listings
      .filter((listing) => listing.operationalEpoch === currentEpochByCommunity.get(listing.communityId))
      .map((listing) => ({
        id: listing.id,
        communityId: listing.communityId,
        communityName: listing.community.name,
        title: listing.title,
        status: listing.status,
        threadCount: listing._count.threads,
      })),
  };
}
