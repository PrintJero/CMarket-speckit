import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { ListingForm } from "../ListingForm";
import { AppShell } from "../../../../_components/AppShell";
import { BackLink } from "../../../../_components/BackLink";
import { PageHeader } from "../../../../_components/PageHeader";
import { Card } from "../../../../_components/Card";

export default async function NewListingPage({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const membership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId: account.accountId, communityId } },
  });
  if (!membership) {
    notFound();
  }

  return (
    <AppShell account={account}>
      <BackLink href={`/communities/${communityId}`}>Back to community</BackLink>
      <PageHeader title="New listing" />
      <Card className="max-w-xl">
        <ListingForm communityId={communityId} currentDisplayName={account.displayName} />
      </Card>
    </AppShell>
  );
}
