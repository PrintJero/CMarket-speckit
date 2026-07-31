import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { proposePurchase } from "@/server/services/transactionService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; listingId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, listingId } = await params;
  const body = await request.json().catch(() => null);
  const quantity = typeof body?.quantity === "number" ? body.quantity : NaN;
  const totalCents = typeof body?.totalCents === "number" ? body.totalCents : NaN;

  const result = await proposePurchase({
    communityId,
    listingId,
    buyerAccountId: account.accountId,
    quantity,
    totalCents,
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 201 });
  }

  const status =
    result.reason === "invalid_input"
      ? 400
      : result.reason === "not_a_member" || result.reason === "self_purchase"
        ? 403
        : result.reason === "not_found"
          ? 404
          : 409; // listing_not_active | stock_not_specified | exceeds_stock | seller_not_a_member
  return NextResponse.json(result, { status });
}
