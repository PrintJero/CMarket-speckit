import { NextResponse } from "next/server";
import { signUp } from "@/server/services/accountService";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName : "";

  if (!email || !password || !displayName) {
    return NextResponse.json(
      { error: "display name, email and password are required" },
      { status: 400 },
    );
  }

  const result = await signUp(email, password, displayName);

  if (!result.ok) {
    if (result.reason === "invalid_email") {
      return NextResponse.json({ error: "email is not a valid address" }, { status: 400 });
    }
    if (result.reason === "invalid_display_name") {
      return NextResponse.json(
        { error: "display name must be 1-50 characters" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error:
          result.passwordReason === "too_short"
            ? "password must be at least 8 characters"
            : "password has appeared in a data breach — choose a different one",
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { message: "If this email can be used, we've sent verification instructions." },
    { status: 202 },
  );
}
