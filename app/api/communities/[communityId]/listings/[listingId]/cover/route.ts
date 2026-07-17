import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { setCoverPhoto } from "@/server/services/listingService";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { listingId } = await params;
  const body = await request.json().catch(() => null);
  if (typeof body?.photoId !== "string") {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const result = await setCoverPhoto({
    listingId,
    photoId: body.photoId,
    callerAccountId: account.accountId,
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  const status = result.reason === "not_owner" ? 403 : 404;
  return NextResponse.json(result, { status });
}
