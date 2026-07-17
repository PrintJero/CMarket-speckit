import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getListingPhoto, removeListingPhoto } from "@/server/services/listingService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string; listingId: string; photoId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, listingId, photoId } = await params;
  const result = await getListingPhoto(communityId, listingId, photoId, account.accountId);

  if (!result.ok) {
    const status = result.reason === "not_a_member" ? 403 : 404;
    return NextResponse.json(result, { status });
  }

  return new NextResponse(new Uint8Array(result.photo.data), {
    status: 200,
    headers: { "Content-Type": result.photo.mimeType },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listingId: string; photoId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { listingId, photoId } = await params;
  const result = await removeListingPhoto({ listingId, photoId, callerAccountId: account.accountId });

  if (result.ok) {
    return new NextResponse(null, { status: 204 });
  }
  const status = result.reason === "not_owner" ? 403 : 404;
  return NextResponse.json(result, { status });
}
