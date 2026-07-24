import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { suspendCommunity } from "@/server/services/communityLifecycleService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { communityId } = await params;
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason : "";

  const result = await suspendCommunity(caller.masterId, communityId, reason);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : result.reason === "invalid_reason" ? 400 : 409;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 200 });
}
