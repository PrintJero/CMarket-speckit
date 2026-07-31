import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { setActiveCommunityForAccount } from "@/server/services/sessionService";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessionCookie";

/**
 * 015-navigation-shell-community-selector, contracts/navigation-shell-api.md.
 * The one validated write path for "becoming the active community" — the
 * selector, the sidebar switcher, and the main view's deep-link sync
 * (MainViewControls.tsx) all call this route rather than writing the session
 * directly.
 */
export async function POST(request: Request): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return new NextResponse(null, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const result = await setActiveCommunityForAccount(account.accountId, token, body?.communityId);

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  return NextResponse.json(result, { status: result.reason === "not_a_member" ? 403 : 400 });
}
