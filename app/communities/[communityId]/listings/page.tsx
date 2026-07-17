import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listListings } from "@/server/services/listingService";
import { formatListingPrice } from "@/lib/formatting/currency";
import { resolveDisplayName } from "@/lib/formatting/displayName";

/**
 * Member-only (any role) feed of a community's own ACTIVE listings.
 * Same notFound() convention as /communities/{id}/admin, but gated on any
 * Membership row, not just ADMINISTRATOR (FR-011, FR-012).
 *
 * Renders as cards (cover photo, title, price), calling listListings()
 * directly rather than an inlined query, so this page never drifts from the
 * contract-tested function (2026-07-17 amendment, FR-018, FR-021).
 */
export default async function ListingsPage({
  params,
}: {
  params: Promise<{ communityId: string }>;
}) {
  const { communityId } = await params;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const result = await listListings(communityId, account.accountId);
  if (!result.ok) {
    notFound();
  }
  const { listings } = result;

  return (
    <div className="operator-shell">
      <div className="operator-container">
        <div className="operator-header">
          <h1>Listings</h1>
          <p className="operator-notice">
            <Link href={`/communities/${communityId}/listings/new`}>New listing</Link>
          </p>
        </div>

        {listings.length === 0 ? (
          <p className="operator-empty">No listings yet. Create one to get started.</p>
        ) : (
          <div className="listing-grid">
            {listings.map((listing) => (
              <Link
                key={listing.id}
                href={`/communities/${communityId}/listings/${listing.id}`}
                className="listing-card"
              >
                <div className="listing-card__cover">
                  {listing.coverPhotoId ? (
                    <img
                      src={`/api/communities/${communityId}/listings/${listing.id}/photos/${listing.coverPhotoId}`}
                      alt=""
                    />
                  ) : (
                    <div className="listing-card__cover-placeholder">No photo</div>
                  )}
                </div>
                <div className="listing-card__body">
                  <p className="listing-card__title">{listing.title}</p>
                  <p className="listing-card__price">{formatListingPrice(listing.priceCents)}</p>
                  <p className="listing-card__owner">{resolveDisplayName(listing.ownerDisplayName)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
