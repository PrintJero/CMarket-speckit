import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { promoteMembershipAsMaster } from "@/server/services/masterAdministrationService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ communityId: string; membershipId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { communityId, membershipId } = await params;
  const result = await promoteMembershipAsMaster(caller.masterId, communityId, membershipId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json(result, { status: 200 });
}
