import { NextResponse } from "next/server";
import { signInWithPassword } from "@/server/services/accountService";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/sessionCookie";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "invalid email or password" }, { status: 401 });
  }

  const result = await signInWithPassword(email, password);

  if (!result.ok) {
    // FR-010: identical for "no such account" and "wrong password".
    return NextResponse.json({ error: "invalid email or password" }, { status: 401 });
  }

  const response = NextResponse.json({ message: "Signed in." }, { status: 200 });
  response.cookies.set(SESSION_COOKIE_NAME, result.sessionToken, {
    ...sessionCookieOptions,
    expires: result.expiresAt,
  });
  return response;
}
