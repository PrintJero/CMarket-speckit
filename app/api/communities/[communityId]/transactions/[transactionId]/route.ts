import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getTransaction } from "@/server/services/transactionService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string; transactionId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, transactionId } = await params;
  const result = await getTransaction({ communityId, transactionId, callerAccountId: account.accountId });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  const status = result.reason === "not_found" ? 404 : 403;
  return NextResponse.json(result, { status });
}
