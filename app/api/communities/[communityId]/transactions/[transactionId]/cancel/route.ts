import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { cancelProposal } from "@/server/services/transactionService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; transactionId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, transactionId } = await params;
  const result = await cancelProposal({ communityId, transactionId, callerAccountId: account.accountId });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  const status =
    result.reason === "not_a_member" || result.reason === "not_a_buyer"
      ? 403
      : result.reason === "not_found"
        ? 404
        : 409; // not_pending
  return NextResponse.json(result, { status });
}
