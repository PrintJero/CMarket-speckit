import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { fulfillListing } from "@/server/services/listingService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { listingId } = await params;
  const result = await fulfillListing({ listingId, callerAccountId: account.accountId });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  const status = result.reason === "not_owner" ? 403 : result.reason === "not_found" ? 404 : 409;
  return NextResponse.json(result, { status });
}
