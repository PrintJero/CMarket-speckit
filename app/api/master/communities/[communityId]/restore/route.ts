import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { restoreCommunity } from "@/server/services/communityLifecycleService";

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
  const administratorMembershipId = typeof body?.administratorMembershipId === "string" ? body.administratorMembershipId : "";

  const result = await restoreCommunity(caller.masterId, communityId, administratorMembershipId);
  if (!result.ok) {
    return NextResponse.json(result, { status: result.reason === "not_found" ? 404 : 409 });
  }
  return NextResponse.json(result, { status: 200 });
}
