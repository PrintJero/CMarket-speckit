import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { suspendAccount, type AccountAdministratorAssignment } from "@/server/services/masterAdministrationService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { accountId } = await params;
  const body = await request.json().catch(() => null);
  const replacementAdministratorAssignments = Array.isArray(body?.replacementAdministratorAssignments)
    ? (body.replacementAdministratorAssignments as AccountAdministratorAssignment[])
    : undefined;

  const result = await suspendAccount(caller.masterId, accountId, { replacementAdministratorAssignments });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.reason === "not_found" ? 404 : 409 });
  }
  return NextResponse.json(result, { status: 200 });
}
