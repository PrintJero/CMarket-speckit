import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { inviteToCommunity } from "@/server/services/invitationService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId } = await params;
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";

  const result = await inviteToCommunity({
    communityId,
    email,
    invitedByAccountId: account.accountId,
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 201 });
  }

  const status = result.reason === "not_administrator" ? 403 : result.reason === "already_member" ? 409 : 400;
  return NextResponse.json(result, { status });
}
