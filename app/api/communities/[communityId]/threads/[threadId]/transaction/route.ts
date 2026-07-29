import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { recordTransaction } from "@/server/services/transactionService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; threadId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, threadId } = await params;
  const result = await recordTransaction({ communityId, threadId, recorderAccountId: account.accountId });

  if (result.ok) {
    return NextResponse.json(result, { status: 201 });
  }

  const status =
    result.reason === "not_a_member" || result.reason === "not_a_participant"
      ? 403
      : result.reason === "not_found"
        ? 404
        : 409; // community_not_active | counterpart_not_a_member
  return NextResponse.json(result, { status });
}
