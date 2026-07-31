import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { createListing, listListings } from "@/server/services/listingService";

function parseIntParam(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId } = await params;
  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const kind = kindParam === "FOR_SALE" || kindParam === "WANTED" ? kindParam : undefined;
  const result = await listListings(communityId, account.accountId, {
    search: url.searchParams.get("q") ?? undefined,
    minPriceCents: parseIntParam(url.searchParams.get("minPrice")),
    maxPriceCents: parseIntParam(url.searchParams.get("maxPrice")),
    kind,
    page: parseIntParam(url.searchParams.get("page")),
    pageSize: parseIntParam(url.searchParams.get("pageSize")),
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  const status = result.reason === "invalid_input" ? 400 : 403;
  return NextResponse.json(result, { status });
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
  const priceCents = typeof body?.priceCents === "number" ? body.priceCents : undefined;
  const kind = body?.kind === "FOR_SALE" || body?.kind === "WANTED" ? body.kind : undefined;
  const stockQuantity = typeof body?.stockQuantity === "number" ? body.stockQuantity : undefined;

  const result = await createListing({
    communityId,
    ownerId: account.accountId,
    title,
    description,
    priceCents,
    kind,
    stockQuantity,
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 201 });
  }

  const status =
    result.reason === "not_a_member" ? 403 : result.reason === "display_name_required" ? 409 : 400;
  return NextResponse.json(result, { status });
}
