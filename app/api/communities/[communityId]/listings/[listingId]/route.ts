import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getListing, updateListing, deleteListing } from "@/server/services/listingService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string; listingId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, listingId } = await params;
  const result = await getListing(communityId, listingId, account.accountId);

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  const status = result.reason === "not_a_member" ? 403 : 404;
  return NextResponse.json(result, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { listingId } = await params;
  const body = await request.json().catch(() => null);

  const result = await updateListing({
    listingId,
    callerAccountId: account.accountId,
    ...(typeof body?.title === "string" ? { title: body.title } : {}),
    ...(typeof body?.description === "string" ? { description: body.description } : {}),
    ...(typeof body?.priceCents === "number" ? { priceCents: body.priceCents } : {}),
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  const status = result.reason === "not_owner" ? 403 : result.reason === "not_found" ? 404 : 400;
  return NextResponse.json(result, { status });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { listingId } = await params;
  const result = await deleteListing({ listingId, callerAccountId: account.accountId });

  if (result.ok) {
    return new NextResponse(null, { status: 204 });
  }
  const status = result.reason === "not_owner" ? 403 : 404;
  return NextResponse.json(result, { status });
}
