import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { acceptInvitation, getInvitationMetadata } from "@/server/services/invitationService";

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ ok: false, reason: "invalid_or_consumed" }, { status: 400 });
  }

  const result = await getInvitationMetadata(token);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function POST(request: Request): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";

  const result = await acceptInvitation({ token, accountId: account.accountId });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  const status =
    result.reason === "email_mismatch" || result.reason === "not_verified"
      ? 403
      : result.reason === "already_member"
        ? 409
        : 400;
  return NextResponse.json(result, { status });
}
