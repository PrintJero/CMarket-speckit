import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteSession } from "@/server/services/sessionService";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessionCookie";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    // Story 2 scenario 3: delete the Session row, not just the cookie.
    await deleteSession(token);
  }

  const response = NextResponse.json({ message: "Signed out." }, { status: 200 });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
