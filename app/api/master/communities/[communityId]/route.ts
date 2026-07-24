import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { getCommunityForMaster, editCommunity } from "@/server/services/masterAdministrationService";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ communityId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { communityId } = await params;
  const result = await getCommunityForMaster(communityId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result, { status: 200 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { communityId } = await params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : undefined;

  const result = await editCommunity(caller.masterId, communityId, { name });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.reason === "not_found" ? 404 : 400 });
  }
  return NextResponse.json(result, { status: 200 });
}
