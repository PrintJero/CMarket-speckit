import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getThread } from "@/server/services/messageService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string; threadId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, threadId } = await params;
  const result = await getThread({ communityId, threadId, callerAccountId: account.accountId });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  const status =
    result.reason === "not_a_member" || result.reason === "not_a_participant" ? 403 : 404;
  return NextResponse.json(result, { status });
}
