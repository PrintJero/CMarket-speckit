import { prisma } from "@/lib/prisma";
import { requireCommunityAdministrator } from "@/server/services/invitationService";
import { enqueueCleanup, renumberListingPhotos } from "@/server/services/mediaCleanupService";

/**
 * 017-cloudinary-listing-media, FR-004: raised from 6 to 8.
 *
 * MAX_PHOTO_BYTES and ALLOWED_PHOTO_MIME_TYPES are deliberately gone — upload
 * bytes never reach this server any more, so format and size are enforced by
 * signed Cloudinary upload params instead, where a tampering client invalidates
 * the signature (research.md #5, FR-033).
 */
export const MAX_PHOTOS_PER_LISTING = 8;

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

/**
 * 013-purchase-flow-stock, FR-001, research.md #8 (clarify session): a
 * non-negative integer, mirroring isValidPriceCents(). `undefined`/absent is
 * handled separately by callers as "not specified" (null in storage) — this
 * only validates a value the caller actually provided.
 */
function isValidStockQuantity(value: number): boolean {
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
        priceCents: number | null;
        kind: "FOR_SALE" | "WANTED";
        status: "ACTIVE" | "PAUSED" | "FULFILLED";
        stockQuantity: number | null;
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
  priceCents?: number;
  /** 011-wanted-posts, research.md #1/#5: defaults to FOR_SALE; immutable after creation. */
  kind?: "FOR_SALE" | "WANTED";
  /** 013-purchase-flow-stock, FR-001: seller-declared; absent/undefined leaves it null ("not specified"). */
  stockQuantity?: number;
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
 *
 * 011-wanted-posts, FR-002/FR-003: `priceCents` is required and validated
 * when `kind = FOR_SALE` (the default, unchanged rule) — optional, but still
 * validated if present, when `kind = WANTED` (data-model.md's creation gates).
 */
export async function createListing(input: CreateListingInput): Promise<CreateListingResult> {
  const kind = input.kind ?? "FOR_SALE";
  const priceRequired = kind === "FOR_SALE";
  const priceProvided = input.priceCents !== undefined;

  const stockProvided = input.stockQuantity !== undefined;

  if (
    isBlank(input.title) ||
    isBlank(input.description) ||
    (priceRequired && !priceProvided) ||
    (priceProvided && !isValidPriceCents(input.priceCents!)) ||
    (stockProvided && !isValidStockQuantity(input.stockQuantity!))
  ) {
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
      priceCents: priceProvided ? input.priceCents : null,
      kind,
      stockQuantity: stockProvided ? input.stockQuantity : null,
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
      kind: listing.kind,
      status: listing.status,
      stockQuantity: listing.stockQuantity,
    },
  };
}

export type AddListingPhotoResult =
  | { ok: true; photo: { id: string; displayOrder: number } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_owner" }
  | { ok: false; reason: "photo_limit_reached" }
  | { ok: false; reason: "community_not_active" };

export interface AddListingPhotoInput {
  listingId: string;
  callerAccountId: string;
  /** Verified Cloudinary asset metadata. Bytes never reach this server (FR-021). */
  cloudinaryAssetId: string;
  cloudinaryPublicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

/**
 * 017-cloudinary-listing-media: append one already-uploaded, already-verified
 * Cloudinary asset to a listing.
 *
 * The `invalid_photo` branch is gone. Format and size are enforced by signed
 * upload params before the asset exists (FR-033), and provenance is established
 * by listingMediaService before this is called — there is nothing left here for
 * a caller to get wrong about the bytes, because there are no bytes.
 *
 * 009-platform-administration, FR-053: adding a photo is a listing content
 * edit, blocked while the community is SUSPENDED or ARCHIVED.
 */
export async function addListingPhoto(input: AddListingPhotoInput): Promise<AddListingPhotoResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };
  if (!(await isCommunityActive(listing.communityId))) {
    return { ok: false, reason: "community_not_active" };
  }

  const existingCount = await prisma.listingPhoto.count({ where: { listingId: input.listingId } });
  if (existingCount >= MAX_PHOTOS_PER_LISTING) {
    return { ok: false, reason: "photo_limit_reached" };
  }

  const photo = await prisma.listingPhoto.create({
    data: {
      listingId: input.listingId,
      cloudinaryAssetId: input.cloudinaryAssetId,
      cloudinaryPublicId: input.cloudinaryPublicId,
      width: input.width,
      height: input.height,
      format: input.format,
      bytes: input.bytes,
      displayOrder: existingCount,
    },
  });

  if (listing.coverPhotoId === null) {
    await prisma.listing.update({
      where: { id: input.listingId },
      data: { coverPhotoId: photo.id },
    });
  }

  return { ok: true, photo: { id: photo.id, displayOrder: photo.displayOrder } };
}

export type ListListingsResult =
  | {
      ok: true;
      listings: {
        id: string;
        title: string;
        priceCents: number | null;
        kind: "FOR_SALE" | "WANTED";
        status: "ACTIVE" | "PAUSED" | "FULFILLED";
        ownerId: string;
        createdAt: Date;
        coverPhotoId: string | null;
        /**
         * 017-cloudinary-listing-media, FR-063/FR-068: the cover's stored
         * dimensions, so a card can reserve the right proportion. No Cloudinary
         * identifier — a persisted public ID does not belong in a listing read
         * (FR-056).
         */
        coverPhoto: { id: string; width: number; height: number } | null;
        ownerDisplayName: string | null;
        stockQuantity: number | null;
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
  /** 011-wanted-posts, FR-011: omitted returns both kinds, interleaved (research.md #4). */
  kind?: "FOR_SALE" | "WANTED";
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
 * 011-wanted-posts, research.md #4: `kind` is one more optional filter in the
 * same `where`, mirroring the price-range pattern — never a second query.
 * FR-012 covers FULFILLED for free, since only `status: "ACTIVE"` rows match.
 */
export async function listListings(
  communityId: string,
  callerAccountId: string,
  options: ListListingsOptions = {},
): Promise<ListListingsResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const { search, minPriceCents, maxPriceCents, kind } = options;
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
      ...(kind ? { kind } : {}),
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
    include: {
      owner: { select: { displayName: true } },
      // 017-cloudinary-listing-media: the cover's dimensions ride along on the
      // same findMany — never a second query per listing (this file's existing
      // "never an N+1" discipline).
      coverPhoto: { select: { id: true, width: true, height: true } },
    },
  });

  const hasMore = listings.length > pageSize;
  const pageListings = listings.slice(0, pageSize);

  return {
    ok: true,
    listings: pageListings.map((listing) => ({
      id: listing.id,
      title: listing.title,
      priceCents: listing.priceCents,
      kind: listing.kind,
      status: listing.status,
      ownerId: listing.ownerId,
      createdAt: listing.createdAt,
      coverPhotoId: listing.coverPhotoId,
      coverPhoto: listing.coverPhoto
        ? {
            id: listing.coverPhoto.id,
            width: listing.coverPhoto.width,
            height: listing.coverPhoto.height,
          }
        : null,
      ownerDisplayName: listing.owner.displayName,
      stockQuantity: listing.stockQuantity,
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
        priceCents: number | null;
        kind: "FOR_SALE" | "WANTED";
        status: "ACTIVE" | "PAUSED" | "FULFILLED";
        coverPhotoId: string | null;
        ownerDisplayName: string | null;
        /**
         * 017-cloudinary-listing-media, FR-063: everything ListingImage needs to
         * build a proxy URL and reserve layout space — and deliberately NO
         * cloudinaryPublicId or cloudinaryAssetId, keeping persisted Cloudinary
         * identifiers out of listing reads (FR-056).
         */
        photos: { id: string; width: number; height: number; displayOrder: number }[];
        stockQuantity: number | null;
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
      photos: { orderBy: { displayOrder: "asc" } },
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
      kind: listing.kind,
      status: listing.status,
      coverPhotoId: listing.coverPhotoId,
      ownerDisplayName: listing.owner.displayName,
      photos: listing.photos.map((photo) => ({
        id: photo.id,
        width: photo.width,
        height: photo.height,
        displayOrder: photo.displayOrder,
      })),
      stockQuantity: listing.stockQuantity,
    },
  };
}

export type GetListingPhotoResult =
  | {
      ok: true;
      /**
       * SERVER-INTERNAL ONLY (017-cloudinary-listing-media, T031).
       *
       * `cloudinaryAssetId` is here because the delivery ETag is derived from it
       * (W/"{cloudinaryAssetId}-{variant}"), and `cloudinaryPublicId` because the
       * signed fetch resolves by it. FR-056 forbids either reaching a proxy
       * response, a response header, or any listing-read payload — the route
       * uses them to build a header and a URL, and emits neither.
       */
      photo: {
        cloudinaryAssetId: string;
        cloudinaryPublicId: string;
        width: number;
        height: number;
      };
    }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" };

/**
 * FR-051–FR-053: resolve a photo for authenticated delivery, gated by current
 * membership in communityId.
 *
 * 017-cloudinary-listing-media: RETAINED from the previous byte-serving
 * implementation, with only its result shape changed. The authorization gate
 * below is deliberately unchanged — it is exactly what the delivery proxy needs,
 * and deleting this function to reinvent the same gate inside a route handler
 * would have been the worse move (research.md #12).
 *
 * The `listingId` parameter is gone: a photoId already determines its listing,
 * so the delivery route is community-scoped and photo-addressed. The community
 * segment still earns its place — it makes the isolation check assertable
 * against the request's own claim rather than inferred from the record.
 *
 * 009-platform-administration, FR-052: tolerates a SUSPENDED community, and a
 * pre-restoration listing (stale operationalEpoch) reads as not_found —
 * indistinguishable from a photo that never existed (FR-054).
 */
export async function getListingPhoto(
  communityId: string,
  photoId: string,
  callerAccountId: string,
): Promise<GetListingPhotoResult> {
  if (!(await requireCommunityMembership(callerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { operationalEpoch: true },
  });

  const photo = await prisma.listingPhoto.findUnique({
    where: { id: photoId },
    include: { listing: true },
  });
  if (
    !photo ||
    photo.listing.communityId !== communityId ||
    photo.listing.operationalEpoch !== (community?.operationalEpoch ?? 1)
  ) {
    return { ok: false, reason: "not_found" };
  }

  return {
    ok: true,
    photo: {
      cloudinaryAssetId: photo.cloudinaryAssetId,
      cloudinaryPublicId: photo.cloudinaryPublicId,
      width: photo.width,
      height: photo.height,
    },
  };
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
        priceCents: number | null;
        kind: "FOR_SALE" | "WANTED";
        status: "ACTIVE" | "PAUSED" | "FULFILLED";
        stockQuantity: number | null;
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
  /** 013-purchase-flow-stock, FR-001: editable afterward like any other listing field. */
  stockQuantity?: number;
}

/**
 * FR-006. Ownership check alone — never requireCommunityAdministrator (FR-010).
 * 009-platform-administration, FR-053: a listing content edit is blocked
 * while the community is SUSPENDED or ARCHIVED. 011-wanted-posts, research.md
 * #5: `kind` is immutable — `UpdateListingInput` has no `kind` field, so
 * there is nothing for a caller to send that would change it.
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
  if (input.stockQuantity !== undefined && !isValidStockQuantity(input.stockQuantity)) {
    return { ok: false, reason: "invalid_input" };
  }

  const updated = await prisma.listing.update({
    where: { id: input.listingId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
      ...(input.stockQuantity !== undefined ? { stockQuantity: input.stockQuantity } : {}),
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
      kind: updated.kind,
      status: updated.status,
      stockQuantity: updated.stockQuantity,
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
 * FR-006. Same ownership check as updateListing.
 *
 * 017-cloudinary-listing-media, FR-020: display order is now rewritten
 * CONTIGUOUS after removal — a change from the previous implementation, which
 * deliberately left a gap. The rewrite goes through a temporary negative offset
 * because @@unique([listingId, displayOrder]) makes an in-place renumber
 * transiently collide with itself.
 *
 * FR-079: the removed asset is enqueued for Cloudinary deletion in the SAME
 * transaction, so a provider outage cannot lose the record that it needs
 * deleting — and cannot block this edit either (FR-085). Cloudinary is never
 * called from here.
 *
 * FR-018 (2026-07-17 amendment): if the removed photo was the cover, promotes the
 * remaining photo with the lowest display order, or clears coverPhotoId if none
 * remain.
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

    // FR-079: enqueue before anything can go wrong downstream.
    await enqueueCleanup(tx, [photo.cloudinaryPublicId]);

    // FR-020: renumber the survivors contiguously from 0.
    await renumberListingPhotos(tx, input.listingId);

    if (listing.coverPhotoId === input.photoId) {
      const nextCover = await tx.listingPhoto.findFirst({
        where: { listingId: input.listingId },
        orderBy: { displayOrder: "asc" },
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

/**
 * 011-wanted-posts, research.md #3: a listing currently FULFILLED is
 * administrator-untouchable in either direction — FR-008's "does NOT extend
 * to setting or clearing FULFILLED" covers an administrator reactivating (or
 * pausing) one back out of FULFILLED, not just setting it in the first
 * place. Checked before `canModerateListing()` so the owner's own path
 * (checked first inside this function) is unaffected.
 */
function isLeavingFulfilledAsNonOwner(
  listing: { status: "ACTIVE" | "PAUSED" | "FULFILLED"; ownerId: string },
  callerAccountId: string,
): boolean {
  return listing.status === "FULFILLED" && listing.ownerId !== callerAccountId;
}

export async function pauseListing(input: PauseListingInput): Promise<PauseListingResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (!(await communityAllowsExistingContent(listing.communityId))) {
    return { ok: false, reason: "community_not_active" };
  }
  if (isLeavingFulfilledAsNonOwner(listing, input.callerAccountId)) {
    return { ok: false, reason: "not_authorized" };
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
  if (isLeavingFulfilledAsNonOwner(listing, input.callerAccountId)) {
    return { ok: false, reason: "not_authorized" };
  }
  if (!(await canModerateListing(listing, input.callerAccountId))) {
    return { ok: false, reason: "not_authorized" };
  }

  await prisma.listing.update({ where: { id: input.listingId }, data: { status: "ACTIVE" } });
  return { ok: true };
}

export type FulfillListingResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_owner" }
  | { ok: false; reason: "not_a_wanted_post" }
  | { ok: false; reason: "community_not_active" };

export interface FulfillListingInput {
  listingId: string;
  callerAccountId: string;
}

/**
 * 011-wanted-posts, FR-005, FR-006, FR-008, research.md #3: owner-only —
 * never `canModerateListing()`/`requireCommunityAdministrator()`, mirroring
 * `deleteListing()`'s ownership-only pattern, not `pauseListing()`'s
 * owner-or-admin one. Reachable only for `kind = WANTED`. Idempotent: setting
 * FULFILLED on an already-FULFILLED listing is a no-op, not an error.
 */
export async function fulfillListing(input: FulfillListingInput): Promise<FulfillListingResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };
  if (listing.kind !== "WANTED") return { ok: false, reason: "not_a_wanted_post" };
  if (!(await communityAllowsExistingContent(listing.communityId))) {
    return { ok: false, reason: "community_not_active" };
  }

  await prisma.listing.update({ where: { id: input.listingId }, data: { status: "FULFILLED" } });
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
 * needed for that part — data-model.md's Atomicity note). Not restricted by
 * community suspension (spec.md Edge Cases names only pausing as explicitly
 * permitted; deletion is left unrestricted rather than speculatively gated).
 *
 * 013-purchase-flow-stock, FR-028, research.md #9: `Transaction.listingId` has
 * no FK/relation to `Listing` (010 research.md #1's snapshot pattern), so
 * deleting the listing triggers no cascade against it on its own — any
 * `PENDING` proposal referencing this listing is explicitly cancelled here,
 * in the same `$transaction` as the delete, since there is nothing left to
 * fulfill. An already-`ACCEPTED`/`REJECTED`/`CANCELLED` row is untouched (the
 * `updateMany`'s `state: "PENDING"` filter never matches it).
 */
export async function deleteListing(input: DeleteListingInput): Promise<DeleteListingResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.callerAccountId) return { ok: false, reason: "not_owner" };

  await prisma.$transaction(async (tx) => {
    // 017-cloudinary-listing-media, FR-080 — ORDER IS LOAD-BEARING.
    //
    // ListingPhoto has onDelete: Cascade, so tx.listing.delete() below destroys
    // the photo rows — the only record of which Cloudinary assets exist. Reading
    // and enqueueing them MUST happen first. Reversing these two steps silently
    // orphans every asset of every deleted listing, with nothing left to say
    // they were ever there (data-model.md §4).
    const photos = await tx.listingPhoto.findMany({
      where: { listingId: input.listingId },
      select: { cloudinaryPublicId: true },
    });
    await enqueueCleanup(
      tx,
      photos.map((photo) => photo.cloudinaryPublicId),
    );

    await tx.transaction.updateMany({
      where: { listingId: input.listingId, state: "PENDING" },
      data: { state: "CANCELLED", resolvedAt: new Date() },
    });
    await tx.listing.delete({ where: { id: input.listingId } });
  });

  return { ok: true };
}

export type ListMyListingsResult = {
  ok: true;
  listings: {
    id: string;
    communityId: string;
    communityName: string;
    title: string;
    kind: "FOR_SALE" | "WANTED";
    status: "ACTIVE" | "PAUSED" | "FULFILLED";
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
        kind: listing.kind,
        status: listing.status,
        threadCount: listing._count.threads,
      })),
  };
}
