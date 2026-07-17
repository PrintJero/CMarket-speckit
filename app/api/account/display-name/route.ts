import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { setDisplayName } from "@/server/services/accountService";

export async function PATCH(request: Request): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (typeof body?.displayName !== "string") {
    return NextResponse.json({ ok: false, reason: "invalid_display_name" }, { status: 400 });
  }

  const result = await setDisplayName(account.accountId, body.displayName);

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  return NextResponse.json(result, { status: 400 });
}
