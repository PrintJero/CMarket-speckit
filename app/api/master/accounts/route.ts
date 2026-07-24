import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { listAccountsForMaster } from "@/server/services/masterAdministrationService";

export async function GET(request: Request): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const result = await listAccountsForMaster({ search: url.searchParams.get("search") ?? undefined });
  return NextResponse.json(result, { status: 200 });
}
