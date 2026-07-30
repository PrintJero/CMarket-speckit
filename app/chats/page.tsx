import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listMyThreads } from "@/server/services/messageService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { AppShell } from "../_components/AppShell";
import { PageHeader } from "../_components/PageHeader";
import { Card } from "../_components/Card";

/**
 * FR-017-FR-020 (2026-07-17 amendment): every thread the caller participates
 * in, across every community they currently belong to. `listMyThreads()`
 * already scopes and orders this by database query alone (research.md #1,
 * spec.md Assumptions) — grouping the result by community below is a
 * presentational transform over that already-scoped, already-ordered array,
 * not a re-implementation of scoping or ordering.
 */
export default async function ChatsPage() {
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const result = await listMyThreads(account.accountId);

  const communities = new Map<string, { communityName: string; threads: typeof result.threads }>();
  for (const thread of result.threads) {
    const existing = communities.get(thread.communityId);
    if (existing) {
      existing.threads.push(thread);
    } else {
      communities.set(thread.communityId, { communityName: thread.communityName, threads: [thread] });
    }
  }

  return (
    <AppShell account={account}>
      <PageHeader title="Chats" />

      {result.threads.length === 0 ? (
        <p>No conversations yet.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(communities.entries()).map(([communityId, group]) => (
            <section key={communityId} data-testid="chats-community">
              <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wider text-ink-muted">
                {group.communityName}
              </h2>
              <div className="flex flex-col gap-3">
                {group.threads.map((thread) => (
                  <Card key={thread.id} className="max-w-xl" data-testid="chats-thread-row">
                    <Link
                      href={`/communities/${communityId}/threads/${thread.id}`}
                      className="block hover:no-underline"
                    >
                      <p className="font-semibold text-ink">{thread.listingTitle}</p>
                    </Link>
                    <p className="text-[13px] text-ink-muted">
                      {thread.role === "owner" ? "You own this listing" : "You contacted the owner"}
                      {" · "}
                      <Link
                        href={`/communities/${communityId}/members/${thread.counterpartId}`}
                        className="hover:underline"
                      >
                        {resolveDisplayName(thread.counterpartDisplayName)}
                      </Link>
                    </p>
                    <Link
                      href={`/communities/${communityId}/threads/${thread.id}`}
                      className="block hover:no-underline"
                    >
                      <p className="mt-1 text-sm text-ink-muted">{thread.lastMessagePreview}</p>
                    </Link>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
