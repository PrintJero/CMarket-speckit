import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { ListingForm } from "../ListingForm";

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
    <div className="operator-shell">
      <div className="operator-container">
        <div className="operator-header">
          <h1>New listing</h1>
        </div>
        <section className="operator-panel-card">
          <ListingForm communityId={communityId} currentDisplayName={account.displayName} />
        </section>
      </div>
    </div>
  );
}
