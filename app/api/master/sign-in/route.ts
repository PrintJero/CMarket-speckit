import { NextResponse } from "next/server";
import { signInAsMaster } from "@/server/services/masterAuthService";
import { MASTER_SESSION_COOKIE_NAME, masterSessionCookieOptions } from "@/lib/auth/masterSessionCookie";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const masterId = typeof body?.masterId === "string" ? body.masterId : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!masterId || !password) {
    return NextResponse.json({ ok: false, reason: "invalid_credentials" }, { status: 401 });
  }

  const result = await signInAsMaster(masterId, password);
  if (!result.ok) {
    return NextResponse.json(result, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, mustChangePassword: result.mustChangePassword }, { status: 200 });
  response.cookies.set(MASTER_SESSION_COOKIE_NAME, result.sessionToken, {
    ...masterSessionCookieOptions,
    expires: result.expiresAt,
  });
  return response;
}
