import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { confirmTransaction } from "@/server/services/transactionService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; transactionId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, transactionId } = await params;
  const result = await confirmTransaction({ communityId, transactionId, callerAccountId: account.accountId });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  const status =
    result.reason === "not_a_member" || result.reason === "not_a_counterpart"
      ? 403
      : 404;
  return NextResponse.json(result, { status });
}
