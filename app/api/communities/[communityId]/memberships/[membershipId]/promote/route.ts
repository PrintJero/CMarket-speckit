import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { promoteMember } from "@/server/services/invitationService";

/**
 * 009-platform-administration, User Story 6: community-administrator peer
 * promotion — the existing per-community namespace, not /master. A
 * community administrator promoting a peer member never touches
 * app/api/master/*.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ communityId: string; membershipId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, membershipId } = await params;
  const result = await promoteMember({ communityId, membershipId, callerAccountId: account.accountId });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  const status = result.reason === "not_administrator" ? 403 : 409;
  return NextResponse.json(result, { status });
}
