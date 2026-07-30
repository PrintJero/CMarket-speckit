import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getProfile } from "@/server/services/profileService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string; accountId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, accountId } = await params;
  const result = await getProfile({ communityId, accountId, viewerAccountId: account.accountId });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  const status = result.reason === "not_found" ? 404 : 403;
  return NextResponse.json(result, { status });
}
