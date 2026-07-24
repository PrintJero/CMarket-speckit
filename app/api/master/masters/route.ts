import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/auth/currentMaster";
import { prisma } from "@/lib/prisma";
import { createMaster } from "@/server/services/masterAuthService";

export async function GET(): Promise<Response> {
  const caller = await requireMaster();
  if (!caller) {
    return NextResponse.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  const masters = await prisma.masterIdentity.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, masterId: true, email: true, status: true, createdAt: true, createdByMasterId: true },
  });
  return NextResponse.json({ ok: true, masters }, { status: 200 });
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
  const masterId = typeof body?.masterId === "string" ? body.masterId : "";
  const email = typeof body?.email === "string" ? body.email : "";

  const result = await createMaster({ masterId, email, createdByMasterId: caller.masterId });
  if (!result.ok) {
    const status =
      result.reason === "invalid_master_id" || result.reason === "invalid_email"
        ? 400
        : result.reason === "bootstrap_already_completed"
          ? 409
          : 409;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result, { status: 201 });
}
