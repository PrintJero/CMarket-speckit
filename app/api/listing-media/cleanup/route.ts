import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { drainCleanup } from "@/server/services/mediaCleanupService";

/**
 * POST /api/listing-media/cleanup (017-cloudinary-listing-media, FR-082, FR-083).
 *
 * Drains the retryable Cloudinary deletion queue. NOT member-facing: the caller
 * is a scheduler, not a person, so it authenticates with a shared secret rather
 * than a session. Idempotent and safe to over-call.
 */
function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths first — but
  // still run the comparison on equal-length buffers to avoid leaking via timing.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CLEANUP_TOKEN;
  if (!expected || expected.trim() === "") {
    console.error("[listing-media] CLEANUP_TOKEN is not configured; refusing to drain");
    return new NextResponse(null, { status: 500 });
  }

  if (!tokenMatches(request.headers.get("x-cleanup-token"), expected)) {
    return new NextResponse(null, { status: 401 });
  }

  const result = await drainCleanup({ limit: 50 });
  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}
