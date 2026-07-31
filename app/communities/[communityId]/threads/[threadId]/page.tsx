import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getThread } from "@/server/services/messageService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { ThreadReplyForm } from "./ThreadReplyForm";
import { AppShell } from "../../../../_components/AppShell";
import { BackLink } from "../../../../_components/BackLink";
import { PageHeader } from "../../../../_components/PageHeader";
import { Card } from "../../../../_components/Card";

export default async function ThreadDetailPage({
  params,
}: {
  params: Promise<{ communityId: string; threadId: string }>;
}) {
  const { communityId, threadId } = await params;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const result = await getThread({ communityId, threadId, callerAccountId: account.accountId });
  if (!result.ok) {
    notFound();
  }

  const { thread, messages } = result;

  return (
    <AppShell account={account}>
      <BackLink href={`/communities/${communityId}/listings/${thread.listingId}`}>Back to listing</BackLink>
      <PageHeader title={thread.listingTitle} />

      <Card className="mb-5 max-w-xl">
        <div className="flex flex-col gap-4">
          {messages.map((message) => (
            <div key={message.id} data-testid="message">
              <p className="mb-1 text-[13px] font-semibold text-ink-muted">
                <Link href={`/communities/${communityId}/members/${message.senderId}`} className="hover:underline">
                  {resolveDisplayName(message.senderDisplayName)}
                </Link>{" "}
                · {new Date(message.createdAt).toLocaleString()}
              </p>
              <p>{message.body}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="max-w-xl">
        <ThreadReplyForm
          communityId={communityId}
          threadId={thread.id}
          currentDisplayName={account.displayName}
        />
      </Card>
    </AppShell>
  );
}
