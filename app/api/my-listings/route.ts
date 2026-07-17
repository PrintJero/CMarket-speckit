import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listMyListings } from "@/server/services/listingService";

export async function GET(): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const result = await listMyListings(account.accountId);
  return NextResponse.json(result, { status: 200 });
}
