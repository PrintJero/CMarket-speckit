import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getThread } from "@/server/services/messageService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { ThreadReplyForm } from "./ThreadReplyForm";
import { ChatScrollArea } from "./ChatScrollArea";
import { AppShell } from "../../../../_components/AppShell";
import { BackLink } from "../../../../_components/BackLink";

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

      <div
        data-testid="chat-panel"
        className="mx-auto flex max-h-[75vh] min-h-105 w-full max-w-xl flex-col overflow-hidden rounded-card bg-surface shadow-card"
      >
        <div data-testid="chat-header" className="border-b border-border px-6 py-4">
          <Link
            href={`/communities/${communityId}/members/${thread.counterpartId}`}
            className="text-[1.125rem] font-bold text-ink hover:underline"
          >
            {resolveDisplayName(thread.counterpartDisplayName)}
          </Link>
          <p className="mt-0.5 text-[13px] text-ink-muted">{thread.listingTitle}</p>
        </div>

        <ChatScrollArea messageCount={messages.length}>
          {messages.length === 0 ? (
            <p data-testid="chat-empty-state" className="text-center text-[13px] text-ink-muted">
              Start the conversation
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((message) => {
                const isOwnMessage = message.senderId === account.accountId;
                return (
                  <div
                    key={message.id}
                    data-testid="message"
                    className={`max-w-[75%] ${isOwnMessage ? "self-end" : "self-start"}`}
                  >
                    <div
                      className={`rounded-card px-4 py-2.5 ${
                        isOwnMessage ? "bg-brand-tint text-ink" : "border border-border bg-surface text-ink"
                      }`}
                    >
                      <p data-testid="message-body" className="whitespace-pre-wrap wrap-break-word text-[14px]">
                        {message.body}
                      </p>
                      <p data-testid="message-timestamp" className="mt-1 text-[11px] text-ink-muted">
                        {new Date(message.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ChatScrollArea>

        <div data-testid="chat-composer" className="border-t border-border px-6 py-4">
          <ThreadReplyForm
            communityId={communityId}
            threadId={thread.id}
            currentDisplayName={account.displayName}
          />
        </div>
      </div>
    </AppShell>
  );
}
