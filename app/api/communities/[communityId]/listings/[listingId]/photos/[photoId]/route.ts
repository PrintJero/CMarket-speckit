import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { requireMaster } from "@/lib/auth/currentMaster";
import { removeListingPhoto } from "@/server/services/listingService";

/**
 * DELETE /api/communities/{communityId}/listings/{listingId}/photos/{photoId}
 *
 * 017-cloudinary-listing-media: the byte-serving GET that used to live here is
 * REMOVED (FR-084). Delivery moved to the community-scoped, authenticated proxy
 * at /api/communities/{communityId}/listing-photos/{photoId}, which streams from
 * Cloudinary instead of reading a PostgreSQL column.
 *
 * DELETE's contract is unchanged — same path, same 204/403/404 mapping. Only its
 * internals changed: it now also enqueues Cloudinary cleanup and renumbers
 * displayOrder contiguously.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listingId: string; photoId: string }> },
): Promise<Response> {
  if (await requireMaster()) {
    return NextResponse.json({ ok: false, reason: "not_authorized" }, { status: 403 });
  }

  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { listingId, photoId } = await params;
  const result = await removeListingPhoto({
    listingId,
    photoId,
    callerAccountId: account.accountId,
  });

  if (result.ok) {
    return new NextResponse(null, { status: 204 });
  }
  const status = result.reason === "not_owner" ? 403 : result.reason === "not_found" ? 404 : 409;
  return NextResponse.json(result, { status });
}
