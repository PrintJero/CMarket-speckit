import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listMyTransactions } from "@/server/services/transactionService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { formatListingPrice } from "@/lib/formatting/currency";
import { transactionStateLabel } from "@/lib/formatting/transactionState";
import { AppShell } from "../_components/AppShell";
import { PageHeader } from "../_components/PageHeader";
import { Card } from "../_components/Card";
import { AcceptRejectButtons } from "../_components/AcceptRejectButtons";
import { CancelProposalButton } from "../_components/CancelProposalButton";
import { RateActionButton } from "../_components/RateActionButton";

type View = "buying" | "selling";

function tabClassName(active: boolean): string {
  return `rounded-pill px-4 py-2 text-[13px] font-semibold transition-colors ${
    active ? "bg-brand text-white" : "bg-bg text-ink-muted hover:text-ink"
  }`;
}

/**
 * The single, visible place buyers and sellers see their own purchase
 * activity — across every community they belong to (mirrors /chats and
 * /my-listings' own cross-community shape). Reuses 013-purchase-flow-stock's
 * transactionService and 012-profiles-reputation's reviewService directly;
 * introduces no second Transaction/Review model, just listMyTransactions()'s
 * cross-community aggregation over the same rows the per-community
 * /communities/{id}/transactions view already reads.
 */
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const sp = await searchParams;
  const view: View = sp.view === "selling" ? "selling" : "buying";

  const result = await listMyTransactions(account.accountId);
  const transactions = result.transactions;
  const buying = transactions.filter((t) => t.role === "buyer");
  const selling = transactions.filter((t) => t.role === "seller");
  const rows = view === "buying" ? buying : selling;

  return (
    <AppShell account={account}>
      <PageHeader title="Transactions" subtitle="Your purchase proposals and sales, across every community." />

      <div className="mb-6 flex gap-2" role="tablist" aria-label="Transactions view">
        <Link
          href="/transactions?view=buying"
          role="tab"
          aria-selected={view === "buying"}
          className={tabClassName(view === "buying")}
        >
          Buying
        </Link>
        <Link
          href="/transactions?view=selling"
          role="tab"
          aria-selected={view === "selling"}
          className={tabClassName(view === "selling")}
        >
          Selling
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-ink-muted">
          {view === "buying" ? "You haven't proposed any purchases yet." : "You haven't sold anything yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-3" data-testid={`transactions-${view}`}>
          {rows.map((transaction) => (
            <Card key={transaction.id} className="max-w-xl" data-testid="my-transaction-row">
              <Link
                href={`/communities/${transaction.communityId}/transactions/${transaction.id}`}
                className="block hover:no-underline"
              >
                <p className="text-[15px] font-semibold text-ink">{transaction.listingTitle}</p>
              </Link>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                {view === "buying" ? "Seller: " : "Buyer: "}
                <Link
                  href={`/communities/${transaction.communityId}/members/${transaction.counterpartId}`}
                  className="hover:underline"
                >
                  {resolveDisplayName(transaction.counterpartDisplayName)}
                </Link>
              </p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                {transaction.quantity} {transaction.quantity === 1 ? "unit" : "units"} ·{" "}
                {formatListingPrice(transaction.totalCents)} · {transaction.communityName}
              </p>
              <p className="mt-1 flex items-center gap-2 text-[13px]">
                <span className="font-semibold text-ink">{transactionStateLabel(transaction.state)}</span>
                <span className="text-ink-muted">
                  · {new Date(transaction.createdAt).toLocaleDateString()}
                </span>
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  href={`/communities/${transaction.communityId}/transactions/${transaction.id}`}
                  className="text-[13px] font-semibold text-brand hover:underline"
                >
                  View details
                </Link>

                {transaction.state === "PENDING" && view === "selling" && (
                  <AcceptRejectButtons
                    communityId={transaction.communityId}
                    transactionId={transaction.id}
                    counterpartDisplayName={transaction.counterpartDisplayName}
                  />
                )}
                {transaction.state === "PENDING" && view === "buying" && (
                  <CancelProposalButton communityId={transaction.communityId} transactionId={transaction.id} />
                )}
                {transaction.state === "ACCEPTED" && (
                  <RateActionButton
                    communityId={transaction.communityId}
                    transactionId={transaction.id}
                    counterpartDisplayName={transaction.counterpartDisplayName}
                    myRating={transaction.myRating}
                  />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
