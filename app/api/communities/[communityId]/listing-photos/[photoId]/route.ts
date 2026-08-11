import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getListingPhoto } from "@/server/services/listingService";
import { requireCloudinaryConfig } from "@/lib/cloudinary/config";
import { CloudinaryDeliveryError, fetchAssetBytes } from "@/lib/cloudinary/delivery";
import { resolveVariant } from "@/lib/cloudinary/variants";

/**
 * GET /api/communities/{communityId}/listing-photos/{photoId}?v={variant}
 * (017-cloudinary-listing-media, FR-049–FR-058, FR-107, FR-109).
 *
 * The ONLY way a browser obtains listing image bytes. Supersedes the byte GET
 * that previously lived under .../listings/{listingId}/photos/{photoId}.
 *
 * This route is where Principle II (Community Isolation) lives. Two properties
 * are easy to get wrong and are called out below:
 *
 *   1. AUTHORIZATION PRECEDES THE 304 (FR-109). The natural instinct is to
 *      check If-None-Match early as a cheap fast path. That returns "your cached
 *      copy is still good" to a caller who has since lost membership or become a
 *      different account. The gate runs first, always.
 *   2. IT STREAMS, NEVER REDIRECTS (FR-107). A 302 to a signed Cloudinary URL
 *      would be cheaper on bandwidth and is prohibited: the signed URL would
 *      land in the browser's history, network log, and referrers — leaking a
 *      read capability while appearing to satisfy "no Cloudinary URL in the body".
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string; photoId: string }> },
): Promise<Response> {
  // ---- Steps 1-3: AUTHORIZATION. Nothing below may run before these. ----

  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, photoId } = await params;

  // Reuses getListingPhoto()'s existing gate verbatim: current membership
  // (tolerating SUSPENDED, per 009 FR-052), then the photo's listing must belong
  // to the community named in the path and match its current operationalEpoch.
  const result = await getListingPhoto(communityId, photoId, account.accountId);
  if (!result.ok) {
    // FR-054: a membership failure is 403; a nonexistent photo, a photo in
    // another community, and a stale-epoch listing all collapse to one
    // indistinguishable 404. A distinguishable "exists but not yours" would
    // confirm the existence of another community's photo.
    return new NextResponse(null, { status: result.reason === "not_a_member" ? 403 : 404 });
  }

  // FR-060/FR-061: the query value is used ONLY as an allowlist lookup key. An
  // unrecognized name resolves to `card`; the supplied string never reaches a
  // Cloudinary transformation.
  const { variant } = resolveVariant(new URL(request.url).searchParams.get("v"));

  // Weak validator: f_auto negotiates format from Accept, so the same photo at
  // the same variant legitimately returns WebP to one client and JPEG to
  // another. A strong ETag would assert byte-equality that is not true.
  const etag = `W/"${result.photo.cloudinaryAssetId}-${variant}"`;

  let cacheControl: string;
  try {
    cacheControl = `private, ${requireCloudinaryConfig().cacheMode}`;
  } catch (cause) {
    console.error(
      `[listing-media] delivery misconfigured: ${cause instanceof Error ? cause.message : "unknown"}`,
    );
    return new NextResponse(null, { status: 500 });
  }

  // ---- Step 4: only NOW may a conditional request short-circuit. ----
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl, Vary: "Accept" },
    });
  }

  // ---- Steps 5-7: fetch server-side and stream. ----
  try {
    const asset = await fetchAssetBytes(
      result.photo.cloudinaryPublicId,
      variant,
      request.headers.get("accept"),
    );

    return new NextResponse(asset.bytes, {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        // `private` keeps a shared cache from serving one member's authorized
        // bytes to an unauthorized caller. `no-cache` lets the browser STORE
        // them but forces revalidation before REUSE, so losing membership or
        // switching accounts is caught on the very next request — which is why
        // a max-age is prohibited outright (FR-058).
        "Cache-Control": cacheControl,
        Vary: "Accept",
        ETag: etag,
      },
    });
  } catch (cause) {
    // Generic status only. The Cloudinary detail is already logged server-side
    // by the delivery module, with the signed URL omitted (FR-104).
    const status = cause instanceof CloudinaryDeliveryError ? 502 : 500;
    return new NextResponse(null, { status });
  }
}
