import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { removeMembershipAsMaster, type RemoveMembershipDisposition } from "@/server/services/masterAdministrationService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; membershipId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { communityId, membershipId } = await params;
  const body = await request.json().catch(() => null);
  const disposition = body?.disposition as RemoveMembershipDisposition | undefined;
  const replacementAdministratorMembershipId =
    typeof body?.replacementAdministratorMembershipId === "string"
      ? body.replacementAdministratorMembershipId
      : undefined;

  if (
    disposition !== "demote" &&
    disposition !== "revoke_membership" &&
    disposition !== "disable_account" &&
    disposition !== "delete_account"
  ) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 400 });
  }

  const result = await removeMembershipAsMaster(caller.masterId, communityId, membershipId, {
    disposition,
    replacementAdministratorMembershipId,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.reason === "not_found" ? 404 : 409 });
  }
  return NextResponse.json(result, { status: 200 });
}
