import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { resetAccountPassword } from "@/server/services/masterAdministrationService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { accountId } = await params;
  const result = await resetAccountPassword(caller.masterId, accountId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result, { status: 200 });
}
