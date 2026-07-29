import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getTransaction } from "@/server/services/transactionService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { AppShell } from "../../../../_components/AppShell";
import { BackLink } from "../../../../_components/BackLink";
import { PageHeader } from "../../../../_components/PageHeader";
import { Card } from "../../../../_components/Card";
import { NonIntermediaryDisclosure } from "../../_components/NonIntermediaryDisclosure";
import { ConfirmTransactionButton } from "../../_components/ConfirmTransactionButton";

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

  return (
    <AppShell account={account}>
      <BackLink href={`/communities/${communityId}/transactions`}>Back to transactions</BackLink>
      <PageHeader title={transaction.listingTitle} />

      <Card className="max-w-xl">
        <NonIntermediaryDisclosure />
        <p className="mb-1 text-[15px] font-semibold">
          {transaction.confirmationState === "CONFIRMED" ? "Confirmed" : "Unconfirmed"} transaction
        </p>
        <p className="mb-3 text-[13px] text-ink-muted">
          {transaction.role === "recorder" ? "You recorded this with" : "Recorded by"}{" "}
          {resolveDisplayName(transaction.counterpartDisplayName)} on{" "}
          {new Date(transaction.createdAt).toLocaleString()}
        </p>
        {transaction.confirmationState === "UNCONFIRMED" && transaction.role === "counterpart" && (
          <ConfirmTransactionButton communityId={communityId} transactionId={transaction.id} />
        )}
      </Card>
    </AppShell>
  );
}
