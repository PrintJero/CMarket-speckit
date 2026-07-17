import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { sendThreadMessage } from "@/server/services/messageService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; threadId: string }> },
): Promise<Response> {
  const account = await getCurrentAccount();
  if (!account) {
    return new NextResponse(null, { status: 401 });
  }

  const { communityId, threadId } = await params;
  const body = await request.json().catch(() => null);
  const messageBody = typeof body?.body === "string" ? body.body : "";

  const result = await sendThreadMessage({
    communityId,
    threadId,
    senderAccountId: account.accountId,
    body: messageBody,
  });

  if (result.ok) {
    return NextResponse.json(result, { status: 201 });
  }

  const status =
    result.reason === "invalid_message"
      ? 400
      : result.reason === "not_a_member" || result.reason === "not_a_participant"
        ? 403
        : result.reason === "not_found"
          ? 404
          : 409;
  return NextResponse.json(result, { status });
}
