import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { prisma } from "@/lib/prisma";
import { createCommunityAsMaster } from "@/server/services/communityLifecycleService";
import type { CommunityStatus } from "@prisma/client";

export async function GET(request: Request): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") as CommunityStatus | null;

  const communities = await prisma.community.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { memberships: true } } },
  });

  return NextResponse.json(
    {
      ok: true,
      communities: communities.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        createdAt: c.createdAt,
        suspendedAt: c.suspendedAt,
        archiveScheduledAt: c.archiveScheduledAt,
        archivedAt: c.archivedAt,
        memberCount: c._count.memberships,
      })),
    },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }
  if (caller.mustChangePassword) {
    return NextResponse.json({ ok: false, reason: "password_change_required" }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  const mode = body?.administrator?.mode;
  const email = typeof body?.administrator?.email === "string" ? body.administrator.email : "";

  if (mode !== "existing" && mode !== "provision") {
    return NextResponse.json({ ok: false, reason: "invalid_name" }, { status: 400 });
  }

  const result = await createCommunityAsMaster(
    mode === "existing"
      ? { callerMasterId: caller.masterId, name, administrator: { mode: "existing", email } }
      : {
          callerMasterId: caller.masterId,
          name,
          administrator: {
            mode: "provision",
            email,
            displayName: typeof body?.administrator?.displayName === "string" ? body.administrator.displayName : "",
          },
        },
  );

  if (!result.ok) {
    const status =
      result.reason === "invalid_name" || result.reason === "invalid_email"
        ? 400
        : result.reason === "account_not_found"
          ? 404
          : 409;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result, { status: 201 });
}
