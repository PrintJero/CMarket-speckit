import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listTransactions } from "@/server/services/transactionService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId } = await params;
  const result = await listTransactions(communityId, account.accountId);

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  return NextResponse.json(result, { status: 403 });
}
