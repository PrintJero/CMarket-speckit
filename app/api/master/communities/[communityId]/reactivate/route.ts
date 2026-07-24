import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { reactivateCommunity } from "@/server/services/communityLifecycleService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ communityId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { communityId } = await params;
  const result = await reactivateCommunity(caller.masterId, communityId);
  if (!result.ok) {
    return NextResponse.json(result, { status: result.reason === "not_found" ? 404 : 409 });
  }
  return NextResponse.json(result, { status: 200 });
}
