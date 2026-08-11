import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCloudinaryConfig, uploadEndpoint } from "@/lib/cloudinary/config";
import { signUploadParams, type SignedUploadParams } from "@/lib/cloudinary/signature";
import { verifyAsset } from "@/lib/cloudinary/admin";
import { MAX_PHOTOS_PER_LISTING, requireCommunityMembership } from "@/server/services/listingService";
import { enqueueCleanup, renumberListingPhotos } from "@/server/services/mediaCleanupService";

/**
 * Listing media orchestration (017-cloudinary-listing-media).
 *
 * Lives here rather than in listingService.ts — which is already ~900 lines —
 * so listingService keeps only what genuinely belongs to a listing. Every
 * mutation here is OWNER-ONLY: never requireCommunityAdministrator(), matching
 * updateListing()'s existing pattern (Principle III).
 */

const ACCEPTED_FORMATS = "jpg,png,webp";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** FR-009: comfortably longer than the client's 10-minute refresh threshold. */
const PENDING_MEDIA_TTL_MS = 30 * 60 * 1000;

export interface UploadAuthorization {
  url: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicId: string;
  type: "authenticated";
  context: string;
}

export type AuthorizeUploadResult =
  | { ok: true; upload: UploadAuthorization }
  | { ok: false; reason: "invalid_input" }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_owner" }
  | { ok: false; reason: "community_not_active" }
  | { ok: false; reason: "photo_limit_reached" }
  | { ok: false; reason: "unauthorized_asset" }
  | { ok: false; reason: "authorization_expired" };

export interface AuthorizeUploadInput {
  accountId: string;
  communityId: string;
  draftId: string;
  /** Present on the edit path only; must equal draftId. */
  listingId?: string;
  /**
   * RETRY MODE selector. When a previously server-issued public ID is supplied,
   * this reissues signed params for that exact asset instead of minting a new
   * one (research.md #7).
   */
  publicId?: string;
}

function assetPrefix(envFolder: string, draftId: string): string {
  // No `folder` upload parameter is ever sent — the complete public ID carries
  // the path, so behaviour cannot depend on the account's folder mode
  // (research.md #5).
  return `cmarket/${envFolder}/listings/${draftId}/`;
}

function buildContext(accountId: string, draftId: string): string {
  return `account=${accountId}|draft=${draftId}`;
}

function signAuthorization(publicId: string, context: string): UploadAuthorization {
  const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);

  // No max_file_size: it is an upload-preset setting, not an upload-API
  // parameter, and signing it makes Cloudinary reject every upload. Size is
  // enforced at association time instead — see MAX_FILE_SIZE_BYTES below.
  const params: SignedUploadParams = {
    timestamp,
    public_id: publicId,
    type: "authenticated",
    allowed_formats: ACCEPTED_FORMATS,
    context,
  };

  return {
    url: uploadEndpoint(cloudName),
    apiKey,
    timestamp,
    // Derived from the secret; contains it nowhere and cannot be reversed.
    signature: signUploadParams(params, apiSecret),
    publicId,
    type: "authenticated",
    context,
  };
}

/**
 * FR-022, FR-026–FR-029, FR-033. Two modes, one authorization gate.
 *
 * The gate order is deliberate: the MASTER check belongs to the ROUTE (a MASTER
 * has no membership, so a membership-first order here would report
 * `not_a_member` and hide the real reason — Principle IX).
 */
export async function authorizeUpload(
  input: AuthorizeUploadInput,
): Promise<AuthorizeUploadResult> {
  if (!input.communityId || !input.draftId) return { ok: false, reason: "invalid_input" };
  if (input.listingId !== undefined && input.listingId !== input.draftId) {
    return { ok: false, reason: "invalid_input" };
  }

  if (!(await requireCommunityMembership(input.accountId, input.communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  // Edit path: the draftId IS the listingId, so ownership is checkable now.
  if (input.listingId) {
    const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
    if (!listing) return { ok: false, reason: "invalid_input" };
    if (listing.ownerId !== input.accountId) return { ok: false, reason: "not_owner" };
    if (listing.communityId !== input.communityId) return { ok: false, reason: "not_owner" };
  }

  const { envFolder } = requireCloudinaryConfig();
  const prefix = assetPrefix(envFolder, input.draftId);
  const context = buildContext(input.accountId, input.draftId);

  // ---- RETRY MODE ------------------------------------------------------
  // Reuse the pending row's public ID. No new row, and NO cap check: the file
  // is already counted, and re-counting it would make retrying the eighth
  // photo fail with photo_limit_reached for no comprehensible reason.
  if (input.publicId) {
    const pending = await prisma.pendingListingMedia.findUnique({
      where: { cloudinaryPublicId: input.publicId },
    });
    if (
      !pending ||
      pending.accountId !== input.accountId ||
      pending.draftId !== input.draftId
    ) {
      return { ok: false, reason: "unauthorized_asset" };
    }
    if (pending.expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: "authorization_expired" };
    }
    return { ok: true, upload: signAuthorization(pending.cloudinaryPublicId, context) };
  }

  // ---- INITIAL MODE ----------------------------------------------------
  const [associatedCount, pendingCount] = await Promise.all([
    input.listingId
      ? prisma.listingPhoto.count({ where: { listingId: input.listingId } })
      : Promise.resolve(0),
    prisma.pendingListingMedia.count({
      where: { accountId: input.accountId, draftId: input.draftId, expiresAt: { gt: new Date() } },
    }),
  ]);
  if (associatedCount + pendingCount >= MAX_PHOTOS_PER_LISTING) {
    return { ok: false, reason: "photo_limit_reached" };
  }

  const publicId = `${prefix}${randomBytes(16).toString("hex")}`;

  await prisma.pendingListingMedia.create({
    data: {
      accountId: input.accountId,
      communityId: input.communityId,
      draftId: input.draftId,
      listingId: input.listingId ?? null,
      cloudinaryPublicId: publicId,
      expiresAt: new Date(Date.now() + PENDING_MEDIA_TTL_MS),
    },
  });

  return { ok: true, upload: signAuthorization(publicId, context) };
}

export interface ListingMediaView {
  id: string;
  width: number;
  height: number;
  displayOrder: number;
  isCover: boolean;
}

export type AssociatePhotosResult =
  | { ok: true; photos: ListingMediaView[] }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_owner" }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "community_not_active" }
  | { ok: false; reason: "invalid_input" }
  | { ok: false; reason: "photo_limit_reached" }
  | { ok: false; reason: "unauthorized_asset" }
  | { ok: false; reason: "asset_not_found" }
  | { ok: false; reason: "file_too_large" }
  | { ok: false; reason: "provider_unavailable" };

export interface AssociatePhotosInput {
  accountId: string;
  listingId: string;
  draftId: string;
  /** The FULL desired ordered set, not a delta — this is what makes FR-017 hold. */
  photos: { publicId: string; displayOrder: number }[];
  coverPublicId?: string;
}

/**
 * FR-019, FR-030, FR-031: associate uploaded assets with a listing.
 *
 * The client sends its chosen order as data, wholly independent of the order
 * uploads happened to complete in (FR-017, SC-003).
 */
export async function associatePhotos(
  input: AssociatePhotosInput,
): Promise<AssociatePhotosResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.accountId) return { ok: false, reason: "not_owner" };

  const community = await prisma.community.findUnique({
    where: { id: listing.communityId },
    select: { status: true },
  });
  if (community?.status !== "ACTIVE") return { ok: false, reason: "community_not_active" };

  // FR-069/race: re-verify membership rather than trusting the earlier
  // authorization — an account can lose membership between the two calls.
  if (!(await requireCommunityMembership(input.accountId, listing.communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const publicIds = input.photos.map((photo) => photo.publicId);
  if (new Set(publicIds).size !== publicIds.length) return { ok: false, reason: "invalid_input" };
  if (publicIds.length > MAX_PHOTOS_PER_LISTING) {
    return { ok: false, reason: "photo_limit_reached" };
  }
  if (input.coverPublicId && !publicIds.includes(input.coverPublicId)) {
    return { ok: false, reason: "invalid_input" };
  }

  const alreadyAssociated = await prisma.listingPhoto.findMany({
    where: { cloudinaryPublicId: { in: publicIds }, listingId: input.listingId },
    select: { cloudinaryPublicId: true },
  });
  const alreadyAssociatedIds = new Set(alreadyAssociated.map((p) => p.cloudinaryPublicId));

  const toVerify = publicIds.filter((id) => !alreadyAssociatedIds.has(id));

  // Step 1: every new public ID must already appear in a PendingListingMedia row
  // OWNED BY THIS ACCOUNT. A forged or unrelated id has no row, so it never
  // associates — FR-031 falls out of the design rather than needing a bespoke check.
  const pendingRows = await prisma.pendingListingMedia.findMany({
    where: {
      cloudinaryPublicId: { in: toVerify },
      accountId: input.accountId,
      draftId: input.draftId,
    },
  });
  if (pendingRows.length !== toVerify.length) return { ok: false, reason: "unauthorized_asset" };
  if (pendingRows.some((row) => row.expiresAt.getTime() <= Date.now())) {
    return { ok: false, reason: "unauthorized_asset" };
  }

  // Step 2: verify each asset with Cloudinary — prefix, context, resource_type,
  // and delivery type. Prefix-plus-context rather than a folder comparison keeps
  // this correct regardless of the account's folder mode (research.md #5).
  const { envFolder } = requireCloudinaryConfig();
  const expectations = {
    expectedPrefix: assetPrefix(envFolder, input.draftId),
    expectedAccountId: input.accountId,
    expectedDraftId: input.draftId,
  };

  const verified = new Map<
    string,
    { assetId: string; width: number; height: number; format: string; bytes: number }
  >();
  for (const publicId of toVerify) {
    const result = await verifyAsset(publicId, expectations);
    if (!result.ok) {
      if (result.reason === "unavailable") {
        // The member's successful uploads are NOT lost (FR-077): the pending
        // rows survive until expiresAt, so a resubmit succeeds without
        // re-uploading anything.
        return { ok: false, reason: "provider_unavailable" };
      }
      return { ok: false, reason: "asset_not_found" };
    }

    // FR-006, FR-033: the authoritative size check.
    //
    // It lives here rather than in the upload signature because Cloudinary's
    // max_file_size is an upload-preset setting, not a signable request
    // parameter — signing it makes every upload fail (verified against the live
    // service). Checking the byte count Cloudinary itself reports is stronger
    // than trusting a client-side check: an oversized asset never becomes
    // listing media, and it is queued for deletion rather than left to linger.
    if (result.asset.bytes > MAX_FILE_SIZE_BYTES) {
      await prisma.$transaction(async (tx) => {
        await enqueueCleanup(tx, [publicId]);
        await tx.pendingListingMedia.deleteMany({ where: { cloudinaryPublicId: publicId } });
      });
      return { ok: false, reason: "file_too_large" };
    }

    verified.set(publicId, result.asset);
  }

  const orderedPublicIds = [...input.photos]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((photo) => photo.publicId);

  const result = await prisma.$transaction(async (tx) => {
    // Step 3: upsert keyed on cloudinaryPublicId. The unique constraint absorbs
    // a double-submitted form, so FR-019 is structural.
    for (const publicId of orderedPublicIds) {
      const asset = verified.get(publicId);
      if (!asset) continue;
      await tx.listingPhoto.upsert({
        where: { cloudinaryPublicId: publicId },
        create: {
          listingId: input.listingId,
          cloudinaryAssetId: asset.assetId,
          cloudinaryPublicId: publicId,
          width: asset.width,
          height: asset.height,
          format: asset.format,
          bytes: asset.bytes,
          // Parked out of the way; step 4 assigns the real order.
          displayOrder: -1000 - orderedPublicIds.indexOf(publicId),
        },
        update: {},
      });
    }

    // Step 7 (before renumbering, so the survivors are known): enqueue cleanup
    // for anything previously associated but absent from this payload.
    const dropped = await tx.listingPhoto.findMany({
      where: { listingId: input.listingId, cloudinaryPublicId: { notIn: orderedPublicIds } },
      select: { id: true, cloudinaryPublicId: true },
    });
    if (dropped.length > 0) {
      await enqueueCleanup(
        tx,
        dropped.map((photo) => photo.cloudinaryPublicId),
      );
      await tx.listingPhoto.deleteMany({ where: { id: { in: dropped.map((p) => p.id) } } });
    }

    // Step 4: contiguous display order in the member's chosen sequence.
    const rows = await tx.listingPhoto.findMany({
      where: { listingId: input.listingId },
      select: { id: true, cloudinaryPublicId: true },
    });
    const idByPublicId = new Map(rows.map((row) => [row.cloudinaryPublicId, row.id]));
    const orderedIds = orderedPublicIds
      .map((publicId) => idByPublicId.get(publicId))
      .filter((id): id is string => id !== undefined);
    await renumberListingPhotos(tx, input.listingId, orderedIds);

    // Step 5: cover. FR-016 — absent an explicit choice, displayOrder 0 wins.
    const coverPublicId = input.coverPublicId ?? orderedPublicIds[0];
    await tx.listing.update({
      where: { id: input.listingId },
      data: { coverPhotoId: coverPublicId ? (idByPublicId.get(coverPublicId) ?? null) : null },
    });

    // Step 6: consume the pending rows.
    if (toVerify.length > 0) {
      await tx.pendingListingMedia.deleteMany({
        where: { cloudinaryPublicId: { in: toVerify } },
      });
    }

    return readListingMedia(tx, input.listingId);
  });

  return { ok: true, photos: result };
}

export type ReorderPhotosResult =
  | { ok: true; photos: ListingMediaView[] }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_owner" }
  | { ok: false; reason: "community_not_active" }
  | { ok: false; reason: "stale_photo_set" }
  | { ok: false; reason: "invalid_input" };

export interface ReorderPhotosInput {
  accountId: string;
  listingId: string;
  /** Must be an exact permutation of the listing's current photo set. */
  photoIds: string[];
  coverPhotoId?: string;
}

/**
 * FR-014, FR-015, FR-020: reorder and/or re-cover an already-saved listing.
 *
 * Requiring an exact permutation makes a stale client fail loudly with
 * stale_photo_set rather than silently dropping a photo.
 */
export async function reorderPhotos(input: ReorderPhotosInput): Promise<ReorderPhotosResult> {
  const listing = await prisma.listing.findUnique({ where: { id: input.listingId } });
  if (!listing) return { ok: false, reason: "not_found" };
  if (listing.ownerId !== input.accountId) return { ok: false, reason: "not_owner" };

  const community = await prisma.community.findUnique({
    where: { id: listing.communityId },
    select: { status: true },
  });
  if (community?.status !== "ACTIVE") return { ok: false, reason: "community_not_active" };

  if (input.coverPhotoId && !input.photoIds.includes(input.coverPhotoId)) {
    return { ok: false, reason: "invalid_input" };
  }

  const current = await prisma.listingPhoto.findMany({
    where: { listingId: input.listingId },
    select: { id: true },
  });
  const currentIds = new Set(current.map((photo) => photo.id));
  const requestedIds = new Set(input.photoIds);
  const isPermutation =
    currentIds.size === requestedIds.size &&
    [...currentIds].every((id) => requestedIds.has(id));
  if (!isPermutation) return { ok: false, reason: "stale_photo_set" };

  const photos = await prisma.$transaction(async (tx) => {
    await renumberListingPhotos(tx, input.listingId, input.photoIds);
    await tx.listing.update({
      where: { id: input.listingId },
      data: { coverPhotoId: input.coverPhotoId ?? input.photoIds[0] ?? null },
    });
    return readListingMedia(tx, input.listingId);
  });

  return { ok: true, photos };
}

/**
 * The ordered media view every mutation returns. `isCover` is DERIVED from
 * Listing.coverPhotoId, not a stored column (research.md #4), and no Cloudinary
 * identifier is included (FR-056).
 */
async function readListingMedia(
  tx: Prisma.TransactionClient,
  listingId: string,
): Promise<ListingMediaView[]> {
  const [photos, listing] = await Promise.all([
    tx.listingPhoto.findMany({
      where: { listingId },
      orderBy: { displayOrder: "asc" },
      select: { id: true, width: true, height: true, displayOrder: true },
    }),
    tx.listing.findUnique({ where: { id: listingId }, select: { coverPhotoId: true } }),
  ]);

  return photos.map((photo) => ({
    id: photo.id,
    width: photo.width,
    height: photo.height,
    displayOrder: photo.displayOrder,
    isCover: listing?.coverPhotoId === photo.id,
  }));
}
