import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { changeMasterPassword } from "@/server/services/masterAuthService";

/** Reachable even while mustChangePassword is true — this is the route that clears it (FR-010). */
export async function POST(request: Request): Promise<Response> {
  const master = await requireMaster();
  if (!master) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  const result = await changeMasterPassword(master.masterId, currentPassword, newPassword);
  if (!result.ok) {
    const status = result.reason === "invalid_current_password" ? 401 : 400;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result, { status: 200 });
}
