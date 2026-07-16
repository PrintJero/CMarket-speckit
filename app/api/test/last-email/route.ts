import { NextResponse } from "next/server";
import { getCapturedEmails } from "@/lib/email/sendEmail";

/**
 * Test-only endpoint (quickstart.md's "local inbox catcher"). Inert unless
 * EMAIL_TEST_CAPTURE=true, which must never be set in a real deployment —
 * this guard is defense in depth on top of that.
 */
export async function GET(request: Request) {
  if (process.env.EMAIL_TEST_CAPTURE !== "true") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const to = new URL(request.url).searchParams.get("to");
  if (!to) {
    return NextResponse.json({ error: "to is required" }, { status: 400 });
  }

  const messages = getCapturedEmails(to);
  const latest = messages.at(-1);
  if (!latest) {
    return NextResponse.json({ error: "no email captured for this address" }, { status: 404 });
  }

  return NextResponse.json({ subject: latest.subject, text: latest.text });
}
