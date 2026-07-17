import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { createListing, listListings } from "@/server/services/listingService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId } = await params;
  const result = await listListings(communityId, account.accountId);

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  return NextResponse.json(result, { status: 403 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId } = await params;
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title : "";
  const description = typeof body?.description === "string" ? body.description : "";
  const priceCents = typeof body?.priceCents === "number" ? body.priceCents : NaN;

  const result = await createListing({
    communityId,
    ownerId: account.accountId,
    title,
    description,
    priceCents,
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 201 });
  }

  const status =
    result.reason === "not_a_member" ? 403 : result.reason === "display_name_required" ? 409 : 400;
  return NextResponse.json(result, { status });
}
