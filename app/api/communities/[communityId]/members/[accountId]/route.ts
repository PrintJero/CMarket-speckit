import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getProfile } from "@/server/services/profileService";

/**
 * 014-account-public-profiles: the URL's communityId is kept only for
 * route/back-link continuity — it is no longer forwarded into getProfile(),
 * which now decides access purely by the viewer/target shared-community
 * intersection (contracts/account-profiles-api.md). The retired
 * "not_a_member" 403 no longer applies; a shared-nothing lookup returns the
 * same 404 as a nonexistent account.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { accountId } = await params;
  const result = await getProfile({ accountId, viewerAccountId: account.accountId });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  return NextResponse.json(result, { status: 404 });
}
