import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listMyThreads } from "@/server/services/messageService";

export async function GET(): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const result = await listMyThreads(account.accountId);
  return NextResponse.json(result, { status: 200 });
}
