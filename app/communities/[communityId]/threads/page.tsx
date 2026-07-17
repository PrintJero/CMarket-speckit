import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listThreads } from "@/server/services/messageService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { AppShell } from "../../../_components/AppShell";
import { BackLink } from "../../../_components/BackLink";
import { PageHeader } from "../../../_components/PageHeader";
import { Card } from "../../../_components/Card";

export default async function ThreadsInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ communityId: string }>;
  searchParams: Promise<{ listingId?: string }>;
}) {
  const { communityId } = await params;
  const { listingId } = await searchParams;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const result = await listThreads(communityId, account.accountId, { listingId });
  if (!result.ok) {
    notFound();
  }

  return (
    <AppShell account={account}>
      <BackLink href={`/communities/${communityId}/listings`}>Back to listings</BackLink>
      <PageHeader title="Messages" />

      {result.threads.length === 0 ? (
        <p>No messages yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {result.threads.map((thread) => (
            <Link key={thread.id} href={`/communities/${communityId}/threads/${thread.id}`}>
              <Card className="max-w-xl" data-testid="thread-row">
                <p className="font-semibold text-ink">{thread.listingTitle}</p>
                <p className="text-[13px] text-ink-muted">{resolveDisplayName(thread.counterpartDisplayName)}</p>
                <p className="mt-1 text-sm text-ink-muted">{thread.lastMessagePreview}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
