import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteMasterSession } from "@/server/services/masterSessionService";
import { MASTER_SESSION_COOKIE_NAME } from "@/lib/auth/masterSessionCookie";

export async function POST(): Promise<Response> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MASTER_SESSION_COOKIE_NAME)?.value;

  if (token) {
    await deleteMasterSession(token);
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.delete(MASTER_SESSION_COOKIE_NAME);
  return response;
}
