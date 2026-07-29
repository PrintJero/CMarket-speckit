import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listTransactions } from "@/server/services/transactionService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { AppShell } from "../../../_components/AppShell";
import { BackLink } from "../../../_components/BackLink";
import { PageHeader } from "../../../_components/PageHeader";
import { Card } from "../../../_components/Card";

export default async function TransactionsPage({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const result = await listTransactions(communityId, account.accountId);
  if (!result.ok) {
    notFound();
  }

  return (
    <AppShell account={account}>
      <BackLink href={`/communities/${communityId}/listings`}>Back to listings</BackLink>
      <PageHeader title="Transactions" />

      {result.transactions.length === 0 ? (
        <Card className="max-w-xl">
          <p>No transactions recorded yet.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {result.transactions.map((transaction) => (
            <Link
              key={transaction.id}
              href={`/communities/${communityId}/transactions/${transaction.id}`}
              data-testid="transaction-list-row"
            >
              <Card className="max-w-xl">
                <p className="text-[15px] font-semibold">{transaction.listingTitle}</p>
                <p className="text-[13px] text-ink-muted">
                  {transaction.role === "recorder" ? "You recorded this" : "Recorded by"}{" "}
                  {resolveDisplayName(transaction.counterpartDisplayName)} ·{" "}
                  {transaction.confirmationState === "CONFIRMED" ? "Confirmed" : "Unconfirmed"} ·{" "}
                  {new Date(transaction.createdAt).toLocaleString()}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
