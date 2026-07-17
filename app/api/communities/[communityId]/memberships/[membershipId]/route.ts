import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { revokeMembership } from "@/server/services/invitationService";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ communityId: string; membershipId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, membershipId } = await params;

  const result = await revokeMembership({
    communityId,
    membershipId,
    revokedByAccountId: account.accountId,
  });

  if (result.ok) {
    return new NextResponse(null, { status: 204 });
  }

  const status =
    result.reason === "not_administrator"
      ? 403
      : result.reason === "not_found"
        ? 404
        : 409; // last_admin or conflict
  return NextResponse.json(result, { status });
}
