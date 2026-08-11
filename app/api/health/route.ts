import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/health — container readiness probe.
 *
 * Checks the one dependency whose absence makes the app useless: the database.
 * A process that is listening but cannot reach Postgres is not healthy, and an
 * orchestrator that only checks "does the port answer" would route traffic to it.
 *
 * Deliberately does NOT check Cloudinary. Listing media failing is a degraded
 * feature, not a dead application — the rest of the marketplace still works, and
 * making a third-party outage roll back a deploy or restart-loop the container
 * would turn a partial failure into a total one.
 *
 * Unauthenticated by design (an orchestrator has no session), so it reveals
 * nothing: no version, no configuration, no counts.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
