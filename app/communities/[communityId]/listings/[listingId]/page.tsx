import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getListing } from "@/server/services/listingService";
import { requireCommunityAdministrator } from "@/server/services/invitationService";
import { formatListingPrice } from "@/lib/formatting/currency";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { ListingForm } from "../ListingForm";
import { ListingActions } from "./ListingActions";
import { AppShell } from "../../../../_components/AppShell";
import { BackLink } from "../../../../_components/BackLink";
import { PageHeader } from "../../../../_components/PageHeader";
import { Card } from "../../../../_components/Card";

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
    <AppShell account={account}>
      <BackLink href={`/communities/${communityId}/listings`}>Back to listings</BackLink>
      <PageHeader
        title={listing.title}
        subtitle={`Listed by ${resolveDisplayName(listing.ownerDisplayName)}`}
      />

      {listing.photos.length > 0 && (
        <div data-testid="listing-gallery" className="mb-5 flex flex-wrap gap-3">
          {listing.photos.map((photo) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.id}
              src={`/api/communities/${communityId}/listings/${listing.id}/photos/${photo.id}`}
              alt=""
              className="h-[105px] w-[140px] rounded-[10px] border border-border object-cover"
            />
          ))}
        </div>
      )}

      <Card className="mb-5 max-w-xl">
        {isOwner ? (
          <ListingForm
            communityId={communityId}
            listingId={listing.id}
            initialTitle={listing.title}
            initialDescription={listing.description}
            initialPriceCents={listing.priceCents}
          />
        ) : (
          <>
            <p>{listing.description}</p>
            <p>{formatListingPrice(listing.priceCents)}</p>
          </>
        )}
      </Card>

      <ListingActions
        communityId={communityId}
        listingId={listing.id}
        initialStatus={listing.status}
        canModerate={isOwner || isAdministrator}
        isOwner={isOwner}
      />
    </AppShell>
  );
}
