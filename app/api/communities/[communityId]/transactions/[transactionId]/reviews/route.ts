import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { createReview } from "@/server/services/reviewService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; transactionId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, transactionId } = await params;
  const body = await request.json().catch(() => null);
  const rating = typeof body?.rating === "number" ? body.rating : Number.NaN;

  const result = await createReview({
    communityId,
    transactionId,
    reviewerAccountId: account.accountId,
    rating,
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 201 });
  }

  if (result.reason === "invalid_rating") {
    return NextResponse.json(result, { status: 400 });
  }
  if (result.reason === "not_a_member" || result.reason === "not_a_participant") {
    return NextResponse.json(result, { status: 403 });
  }
  if (result.reason === "not_found") {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result, { status: 409 });
}
