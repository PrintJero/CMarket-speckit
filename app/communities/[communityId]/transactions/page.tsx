import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listTransactions } from "@/server/services/transactionService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { AppShell } from "../../../_components/AppShell";
import { BackLink } from "../../../_components/BackLink";
import { PageHeader } from "../../../_components/PageHeader";
import { Card } from "../../../_components/Card";
import { AcceptRejectButtons } from "../../../_components/AcceptRejectButtons";
import { CancelProposalButton } from "../../../_components/CancelProposalButton";

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

  const transactions = result.transactions;

  // 013-purchase-flow-stock, FR-025, US5: two owner-scoped views of the same
  // ACCEPTED rows — the buyer's purchase history and the seller's sales
  // history — derived from the one query above rather than fetched twice.
  const purchaseHistory = transactions.filter((t) => t.role === "buyer" && t.state === "ACCEPTED");
  const salesHistory = transactions.filter((t) => t.role === "seller" && t.state === "ACCEPTED");

  function historyRow(transaction: (typeof transactions)[number]) {
    return (
      <Card key={transaction.id} className="max-w-xl" data-testid="history-row">
        <Link href={`/communities/${communityId}/transactions/${transaction.id}`} className="block hover:no-underline">
          <p className="text-[15px] font-semibold">{transaction.listingTitle}</p>
        </Link>
        <p className="text-[13px] text-ink-muted">
          {transaction.role === "buyer" ? "Purchased from" : "Sold to"}{" "}
          <Link href={`/communities/${communityId}/members/${transaction.counterpartId}`} className="hover:underline">
            {resolveDisplayName(transaction.counterpartDisplayName)}
          </Link>{" "}
          · {new Date(transaction.createdAt).toLocaleString()}
        </p>
      </Card>
    );
  }

  return (
    <AppShell account={account}>
      <BackLink href={`/communities/${communityId}`}>Back to community</BackLink>
      <PageHeader title="Transactions" />

      <h2 className="mb-2 text-[15px] font-bold text-ink">Purchase history</h2>
      {purchaseHistory.length === 0 ? (
        <Card className="mb-5 max-w-xl">
          <p>No completed purchases yet.</p>
        </Card>
      ) : (
        <div className="mb-5 flex flex-col gap-3">{purchaseHistory.map(historyRow)}</div>
      )}

      <h2 className="mb-2 text-[15px] font-bold text-ink">Sales history</h2>
      {salesHistory.length === 0 ? (
        <Card className="mb-5 max-w-xl">
          <p>No completed sales yet.</p>
        </Card>
      ) : (
        <div className="mb-5 flex flex-col gap-3">{salesHistory.map(historyRow)}</div>
      )}

      <h2 className="mb-2 text-[15px] font-bold text-ink">All proposals</h2>
      {transactions.length === 0 ? (
        <Card className="max-w-xl">
          <p>No transactions recorded yet.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {transactions.map((transaction) => (
            <Card key={transaction.id} className="max-w-xl" data-testid="transaction-list-row">
              <Link
                href={`/communities/${communityId}/transactions/${transaction.id}`}
                className="block hover:no-underline"
              >
                <p className="text-[15px] font-semibold">{transaction.listingTitle}</p>
              </Link>
              <p className="text-[13px] text-ink-muted">
                {transaction.role === "buyer" ? "Purchase from" : "Sale to"}{" "}
                <Link
                  href={`/communities/${communityId}/members/${transaction.counterpartId}`}
                  className="hover:underline"
                >
                  {resolveDisplayName(transaction.counterpartDisplayName)}
                </Link>{" "}
                · {transaction.state} · {new Date(transaction.createdAt).toLocaleString()}
              </p>
              {transaction.state === "PENDING" && transaction.role === "seller" && (
                <AcceptRejectButtons
                  communityId={communityId}
                  transactionId={transaction.id}
                  counterpartDisplayName={transaction.counterpartDisplayName}
                />
              )}
              {transaction.state === "PENDING" && transaction.role === "buyer" && (
                <CancelProposalButton communityId={communityId} transactionId={transaction.id} />
              )}
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
