import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getThread } from "@/server/services/messageService";
import { listTransactionsForThread } from "@/server/services/transactionService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { ThreadReplyForm } from "./ThreadReplyForm";
import { AppShell } from "../../../../_components/AppShell";
import { BackLink } from "../../../../_components/BackLink";
import { PageHeader } from "../../../../_components/PageHeader";
import { Card } from "../../../../_components/Card";
import { NonIntermediaryDisclosure } from "../../_components/NonIntermediaryDisclosure";
import { RecordTransactionButton } from "../../_components/RecordTransactionButton";
import { ConfirmTransactionButton } from "../../_components/ConfirmTransactionButton";

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
  const transactionsResult = await listTransactionsForThread({
    communityId,
    threadId,
    callerAccountId: account.accountId,
  });
  const transactions = transactionsResult.ok ? transactionsResult.transactions : [];

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

      <Card className="mb-5 max-w-xl">
        <NonIntermediaryDisclosure />
        {transactions.length > 0 && (
          <div className="mb-4 flex flex-col gap-3">
            {transactions.map((transaction) => (
              <div key={transaction.id} data-testid="transaction-row" className="rounded-card bg-bg p-3">
                <p className="text-[13px] font-semibold">
                  {transaction.confirmationState === "CONFIRMED" ? "Confirmed" : "Unconfirmed"} transaction with{" "}
                  <Link
                    href={`/communities/${communityId}/members/${transaction.counterpartId}`}
                    className="hover:underline"
                  >
                    {resolveDisplayName(transaction.counterpartDisplayName)}
                  </Link>
                </p>
                {transaction.confirmationState === "UNCONFIRMED" && transaction.role === "counterpart" && (
                  <ConfirmTransactionButton communityId={communityId} transactionId={transaction.id} />
                )}
              </div>
            ))}
          </div>
        )}
        <RecordTransactionButton communityId={communityId} threadId={thread.id} />
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
