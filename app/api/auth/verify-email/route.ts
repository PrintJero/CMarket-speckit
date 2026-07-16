import { NextResponse } from "next/server";
import { consumeVerificationToken } from "@/server/services/verificationService";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "this link is no longer valid" }, { status: 400 });
  }

  const result = await consumeVerificationToken(token);

  if (!result.ok) {
    return NextResponse.json({ error: "this link is no longer valid" }, { status: 400 });
  }

  return NextResponse.json({ message: "Email verified." }, { status: 200 });
}
