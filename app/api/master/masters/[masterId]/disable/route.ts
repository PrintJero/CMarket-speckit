import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { disableMaster } from "@/server/services/masterAuthService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ masterId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { masterId } = await params;
  const result = await disableMaster(caller.masterId, masterId);
  if (!result.ok) {
    const status = result.reason === "cannot_disable_self" ? 403 : 409;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result, { status: 200 });
}
