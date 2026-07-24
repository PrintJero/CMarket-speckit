import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { getAccountForMaster, editAccount } from "@/server/services/masterAdministrationService";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { accountId } = await params;
  const result = await getAccountForMaster(accountId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result, { status: 200 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const { accountId } = await params;
  const body = await request.json().catch(() => null);
  const displayName = typeof body?.displayName === "string" ? body.displayName : undefined;
  const email = typeof body?.email === "string" ? body.email : undefined;

  const result = await editAccount(caller.masterId, accountId, { displayName, email });
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 200 });
}
