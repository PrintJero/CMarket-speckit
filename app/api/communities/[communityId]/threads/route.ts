import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listThreads } from "@/server/services/messageService";

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
  const listingId = url.searchParams.get("listingId") ?? undefined;
  const result = await listThreads(communityId, account.accountId, { listingId });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  return NextResponse.json(result, { status: 403 });
}
