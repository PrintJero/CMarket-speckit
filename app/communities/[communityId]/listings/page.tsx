import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listListings } from "@/server/services/listingService";
import { formatListingPrice } from "@/lib/formatting/currency";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { ListingDiscoveryControls } from "./ListingDiscoveryControls";

function buildPageHref(
  communityId: string,
  current: Record<string, string | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  if (current.q) params.set("q", current.q);
  if (current.minPrice) params.set("minPrice", current.minPrice);
  if (current.maxPrice) params.set("maxPrice", current.maxPrice);
  params.set("page", String(page));
  return `/communities/${communityId}/listings?${params.toString()}`;
}

/**
 * Member-only (any role) feed of a community's own ACTIVE listings, extended
 * (007-listing-discovery) with keyword search, a price range, and pagination —
 * all driven by the URL's query string and resolved in listListings()'s
 * single Prisma query (research.md #4). Same notFound() convention as
 * /communities/{id}/admin, but gated on any Membership row, not just
 * ADMINISTRATOR (FR-001).
 *
 * Renders as cards (cover photo, title, price), calling listListings()
 * directly rather than an inlined query, so this page never drifts from the
 * contract-tested function (2026-07-17 amendment, FR-018, FR-021).
 */
export default async function ListingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ communityId: string }>;
  searchParams: Promise<{ q?: string; minPrice?: string; maxPrice?: string; page?: string }>;
}) {
  const { communityId } = await params;
  const sp = await searchParams;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const page = sp.page ? Number(sp.page) : 1;
  const result = await listListings(communityId, account.accountId, {
    search: sp.q,
    minPriceCents: sp.minPrice ? Number(sp.minPrice) : undefined,
    maxPriceCents: sp.maxPrice ? Number(sp.maxPrice) : undefined,
    page,
  });
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

        <ListingDiscoveryControls
          communityId={communityId}
          initialQuery={sp.q ?? ""}
          initialMinPrice={sp.minPrice ?? ""}
          initialMaxPrice={sp.maxPrice ?? ""}
        />

        {listings.length === 0 ? (
          <p className="operator-empty">No listings match. Try a different search or filter.</p>
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

        <p className="operator-notice">
          {result.page > 1 && (
            <Link href={buildPageHref(communityId, sp, result.page - 1)}>Previous</Link>
          )}
          {result.page > 1 && result.hasMore && " · "}
          {result.hasMore && (
            <Link href={buildPageHref(communityId, sp, result.page + 1)}>Next</Link>
          )}
        </p>
      </div>
    </div>
  );
}
