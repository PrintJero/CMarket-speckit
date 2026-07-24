import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { listAuditEntries } from "@/server/services/auditService";

export async function GET(request: Request): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const result = await listAuditEntries({
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    actorMasterId: url.searchParams.get("actorMasterId") ?? undefined,
    action: url.searchParams.get("action") ?? undefined,
    targetType: url.searchParams.get("targetType") ?? undefined,
    targetId: url.searchParams.get("targetId") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });

  return NextResponse.json({ ok: true, entries: result.entries, nextCursor: result.nextCursor }, { status: 200 });
}
