import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { addListingPhoto } from "@/server/services/listingService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { listingId } = await params;
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("photo");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, reason: "invalid_photo" }, { status: 400 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const result = await addListingPhoto({
    listingId,
    callerAccountId: account.accountId,
    data,
    mimeType: file.type,
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 201 });
  }

  const status =
    result.reason === "not_owner"
      ? 403
      : result.reason === "not_found"
        ? 404
        : result.reason === "photo_limit_reached"
          ? 409
          : 400;
  return NextResponse.json(result, { status });
}
