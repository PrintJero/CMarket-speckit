import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { requireMaster } from "@/lib/auth/currentMaster";
import { associatePhotos } from "@/server/services/listingMediaService";

/**
 * POST /api/communities/{communityId}/listings/{listingId}/photos
 * (017-cloudinary-listing-media, FR-030, FR-031).
 *
 * Associates already-uploaded Cloudinary assets with a listing. REPLACES the
 * previous multipart handler entirely — no FormData, no Buffer, no bytes. Upload
 * bytes go browser-to-Cloudinary directly and never reach this server.
 *
 * The client sends the FULL desired ordered set rather than a delta, which is
 * what makes the member's chosen order independent of upload-completion order
 * (FR-017, SC-003).
 */
export async function POST(
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
    draftId?: unknown;
    photos?: unknown;
    coverPublicId?: unknown;
  } | null;

  if (
    !body ||
    typeof body.draftId !== "string" ||
    !Array.isArray(body.photos) ||
    (body.coverPublicId !== undefined && typeof body.coverPublicId !== "string")
  ) {
    return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });
  }

  const photos: { publicId: string; displayOrder: number }[] = [];
  for (const entry of body.photos) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { publicId?: unknown }).publicId !== "string" ||
      typeof (entry as { displayOrder?: unknown }).displayOrder !== "number" ||
      !Number.isInteger((entry as { displayOrder: number }).displayOrder) ||
      (entry as { displayOrder: number }).displayOrder < 0
    ) {
      return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });
    }
    photos.push(entry as { publicId: string; displayOrder: number });
  }

  let result;
  try {
    result = await associatePhotos({
      accountId: account.accountId,
      listingId,
      draftId: body.draftId,
      photos,
      coverPublicId: body.coverPublicId,
    });
  } catch (cause) {
    console.error(
      `[listing-media] associate failed: ${cause instanceof Error ? cause.message : "unknown"}`,
    );
    return NextResponse.json({ ok: false, reason: "provider_unconfigured" }, { status: 500 });
  }

  if (result.ok) {
    // Deliberately returns only id/width/height/displayOrder/isCover. No
    // publicId, no format, no URL: this is a listing read, and a persisted
    // Cloudinary identifier does not belong in one (FR-056).
    return NextResponse.json(result, { status: 200 });
  }

  const status =
    result.reason === "invalid_input"
      ? 400
      : result.reason === "not_found"
        ? 404
        : result.reason === "not_owner" ||
            result.reason === "not_a_member" ||
            result.reason === "unauthorized_asset"
          ? 403
          : result.reason === "asset_not_found" || result.reason === "file_too_large"
            ? 422
            : result.reason === "provider_unavailable"
              ? 503
              : 409;
  return NextResponse.json(result, { status });
}
