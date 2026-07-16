import { NextResponse } from "next/server";
import { resendVerification } from "@/server/services/accountService";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";

  if (email) {
    await resendVerification(email);
  }

  // FR-014 / non-enumeration: identical acknowledgement regardless of
  // whether the email exists, is already verified, or is malformed.
  return NextResponse.json(
    { message: "If this email needs verifying, we've sent a new link." },
    { status: 202 },
  );
}
