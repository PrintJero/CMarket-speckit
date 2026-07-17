import { NextResponse } from "next/server";
import { createCommunity } from "@/server/services/communityService";

/**
 * FR-016: development-only, disabled-by-default exception to FR-002. This is
 * the ONE allow-listed file under app/ permitted to reach communityService —
 * see tests/unit/test_community_creation_not_networked.ts. Reuses
 * createCommunity() exactly as-is; no new validation, no bypass.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.OPERATOR_PANEL_ENABLED !== "true") {
    return new NextResponse(null, { status: 404 });
  }

  const body = await request.json();
  if (
    typeof body?.name !== "string" ||
    typeof body?.founderEmail !== "string" ||
    typeof body?.invokedBy !== "string"
  ) {
    return NextResponse.json({ ok: false, reason: "invalid_name" }, { status: 400 });
  }

  const result = await createCommunity({
    name: body.name,
    founderEmail: body.founderEmail,
    invokedBy: body.invokedBy,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
