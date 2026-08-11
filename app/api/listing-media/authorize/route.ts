import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { requireMaster } from "@/lib/auth/currentMaster";
import { authorizeUpload } from "@/server/services/listingMediaService";

/**
 * POST /api/listing-media/authorize (017-cloudinary-listing-media, FR-022).
 *
 * Issues short-lived signed upload parameters for a direct browser-to-Cloudinary
 * upload. Called once per file, including on retry — supplying a previously
 * issued `publicId` selects RETRY MODE, which reuses that same asset identity
 * rather than minting a new one (research.md #7).
 *
 * The response deliberately carries the upload endpoint, apiKey, timestamp,
 * signature, and publicId: the signed upload protocol cannot work otherwise
 * (FR-108). It carries NO api secret, and NO `folder` parameter.
 */
export async function POST(request: Request): Promise<Response> {
  // Principle IX / FR-032: the MASTER check runs FIRST. A MASTER holds no
  // membership, so a membership-first order would reject with `not_a_member`
  // and leave this guarantee resting on an accident rather than a rule.
  if (await requireMaster()) {
    return NextResponse.json({ ok: false, reason: "not_authorized" }, { status: 403 });
  }

  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    communityId?: unknown;
    draftId?: unknown;
    listingId?: unknown;
    publicId?: unknown;
  } | null;

  if (
    !body ||
    typeof body.communityId !== "string" ||
    typeof body.draftId !== "string" ||
    (body.listingId !== undefined && typeof body.listingId !== "string") ||
    (body.publicId !== undefined && typeof body.publicId !== "string")
  ) {
    return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });
  }

  let result;
  try {
    result = await authorizeUpload({
      accountId: account.accountId,
      communityId: body.communityId,
      draftId: body.draftId,
      listingId: body.listingId,
      publicId: body.publicId,
    });
  } catch (cause) {
    // FR-106: requireCloudinaryConfig() throws when misconfigured. Fail loudly
    // and actionably rather than degrading into an image-less application.
    console.error(
      `[listing-media] authorize failed: ${cause instanceof Error ? cause.message : "unknown"}`,
    );
    return NextResponse.json({ ok: false, reason: "provider_unconfigured" }, { status: 500 });
  }

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  const status =
    result.reason === "invalid_input"
      ? 400
      : result.reason === "not_a_member" ||
          result.reason === "not_owner" ||
          result.reason === "unauthorized_asset"
        ? 403
        : 409;
  return NextResponse.json(result, { status });
}
