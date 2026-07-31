import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getTransaction } from "@/server/services/transactionService";
import { getMyReview } from "@/server/services/reviewService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { formatListingPrice } from "@/lib/formatting/currency";
import { transactionStateLabel, transactionResolvedCaption, paymentPathLabel } from "@/lib/formatting/transactionState";
import { AppShell } from "../../../../_components/AppShell";
import { BackLink } from "../../../../_components/BackLink";
import { PageHeader } from "../../../../_components/PageHeader";
import { Card } from "../../../../_components/Card";
import { NonIntermediaryDisclosure } from "../../../../_components/NonIntermediaryDisclosure";
import { AcceptRejectButtons } from "../../../../_components/AcceptRejectButtons";
import { CancelProposalButton } from "../../../../_components/CancelProposalButton";
import { ReviewForm } from "./ReviewForm";

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ communityId: string; transactionId: string }>;
}) {
  const { communityId, transactionId } = await params;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const result = await getTransaction({ communityId, transactionId, callerAccountId: account.accountId });
  if (!result.ok) {
    notFound();
  }

  const { transaction } = result;
  const myReview =
    transaction.state === "ACCEPTED" ? await getMyReview(transaction.id, account.accountId) : null;
  const resolvedCaption = transactionResolvedCaption(transaction.state, transaction.resolvedAt);

  return (
    <AppShell account={account}>
      <BackLink href={`/communities/${communityId}/transactions`}>Back to transactions</BackLink>
      <PageHeader title={transaction.listingTitle} />

      <Card className="max-w-xl">
        <NonIntermediaryDisclosure />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-pill bg-brand-tint px-2.5 py-1 text-[12px] font-bold uppercase tracking-wider text-brand-dark">
            {transactionStateLabel(transaction.state)}
          </span>
          <span className="text-[13px] text-ink-muted">{paymentPathLabel(transaction.paymentPath)}</span>
        </div>

        <p className="mb-1 text-[13px] text-ink-muted">
          {transaction.role === "buyer" ? "Purchase from" : "Sale to"}{" "}
          <Link
            href={`/communities/${communityId}/members/${transaction.counterpartId}`}
            className="hover:underline"
          >
            {resolveDisplayName(transaction.counterpartDisplayName)}
          </Link>
        </p>
        <p className="mb-1 text-[13px] text-ink-muted">
          {transaction.quantity} {transaction.quantity === 1 ? "unit" : "units"} ·{" "}
          {formatListingPrice(transaction.totalCents)}
        </p>
        <p className="mb-3 text-[13px] text-ink-muted">
          Proposed on {new Date(transaction.createdAt).toLocaleString()}
          {resolvedCaption ? ` · ${resolvedCaption}` : ""}
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
        {transaction.state === "ACCEPTED" &&
          (myReview ? (
            <p className="mt-3 text-[13px] text-ink-muted" data-testid="my-review">
              You rated this transaction {myReview.rating} out of 5.
            </p>
          ) : (
            <ReviewForm communityId={communityId} transactionId={transaction.id} />
          ))}
      </Card>
    </AppShell>
  );
}
