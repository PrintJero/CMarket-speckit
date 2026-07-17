import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getListing } from "@/server/services/listingService";
import { requireCommunityAdministrator } from "@/server/services/invitationService";
import { ListingForm } from "../ListingForm";
import { ListingActions } from "./ListingActions";

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ communityId: string; listingId: string }>;
}) {
  const { communityId, listingId } = await params;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const result = await getListing(communityId, listingId, account.accountId);
  if (!result.ok) {
    notFound();
  }

  const { listing } = result;
  const isOwner = listing.ownerId === account.accountId;
  const isAdministrator =
    !isOwner && (await requireCommunityAdministrator(account.accountId, communityId));

  return (
    <div className="operator-shell">
      <div className="operator-container">
        <div className="operator-header">
          <h1>{listing.title}</h1>
        </div>

        {isOwner ? (
          <section className="operator-panel-card">
            <ListingForm
              communityId={communityId}
              listingId={listing.id}
              initialTitle={listing.title}
              initialDescription={listing.description}
              initialPriceCents={listing.priceCents}
            />
          </section>
        ) : (
          <section className="operator-panel-card">
            <p>{listing.description}</p>
            <p>${(listing.priceCents / 100).toFixed(2)}</p>
          </section>
        )}

        <ListingActions
          communityId={communityId}
          listingId={listing.id}
          initialStatus={listing.status}
          canModerate={isOwner || isAdministrator}
          isOwner={isOwner}
        />
      </div>
    </div>
  );
}
