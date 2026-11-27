import { NextResponse } from "next/server";
import { EMAIL_DELIVERY_FAILED_MESSAGE } from "@/lib/email/sendEmail";
import { resendVerification } from "@/server/services/accountService";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";

  if (email) {
    const result = await resendVerification(email);
    // Hotfix v1.0.1: a send that actually failed is reported, so the member
    // knows to retry instead of waiting for an email that will never arrive.
    if (!result.ok) {
      return NextResponse.json({ error: EMAIL_DELIVERY_FAILED_MESSAGE }, { status: 503 });
    }
  }

  // FR-014 / non-enumeration: identical acknowledgement regardless of
  // whether the email exists, is already verified, or is malformed.
  return NextResponse.json(
    { message: "If this email needs verifying, we've sent a new link." },
    { status: 202 },
  );
}
