import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { requireMaster } from "@/lib/auth/currentMaster";
import { reorderPhotos } from "@/server/services/listingMediaService";

/**
 * PATCH /api/communities/{communityId}/listings/{listingId}/photos/order
 * (017-cloudinary-listing-media, FR-014, FR-015, FR-020).
 *
 * Reorder and/or change the cover on an already-saved listing, without
 * re-uploading anything. `photoIds` must be an exact permutation of the
 * listing's current set, so a stale client fails loudly with `stale_photo_set`
 * rather than silently dropping a photo.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<Response> {
  if (await requireMaster()) {
    return NextResponse.json({ ok: false, reason: "not_authorized" }, { status: 403 });
  }

  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { listingId } = await params;
  const body = (await request.json().catch(() => null)) as {
    photoIds?: unknown;
    coverPhotoId?: unknown;
  } | null;

  if (
    !body ||
    !Array.isArray(body.photoIds) ||
    !body.photoIds.every((id) => typeof id === "string") ||
    (body.coverPhotoId !== undefined && typeof body.coverPhotoId !== "string")
  ) {
    return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });
  }

  const result = await reorderPhotos({
    accountId: account.accountId,
    listingId,
    photoIds: body.photoIds as string[],
    coverPhotoId: body.coverPhotoId,
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  const status =
    result.reason === "invalid_input"
      ? 400
      : result.reason === "not_found"
        ? 404
        : result.reason === "not_owner"
          ? 403
          : 409;
  return NextResponse.json(result, { status });
}
