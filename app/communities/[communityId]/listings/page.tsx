import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listListings } from "@/server/services/listingService";
import { formatListingPrice } from "@/lib/formatting/currency";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { ListingDiscoveryControls } from "./ListingDiscoveryControls";
import { AppShell } from "../../../_components/AppShell";
import { PageHeader } from "../../../_components/PageHeader";
import { LinkButton } from "../../../_components/Button";

function buildPageHref(
  communityId: string,
  current: Record<string, string | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  if (current.q) params.set("q", current.q);
  if (current.minPrice) params.set("minPrice", current.minPrice);
  if (current.maxPrice) params.set("maxPrice", current.maxPrice);
  if (current.kind) params.set("kind", current.kind);
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
  searchParams: Promise<{ q?: string; minPrice?: string; maxPrice?: string; kind?: string; page?: string }>;
}) {
  const { communityId } = await params;
  const sp = await searchParams;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const page = sp.page ? Number(sp.page) : 1;
  const kind = sp.kind === "FOR_SALE" || sp.kind === "WANTED" ? sp.kind : undefined;
  const result = await listListings(communityId, account.accountId, {
    search: sp.q,
    minPriceCents: sp.minPrice ? Number(sp.minPrice) : undefined,
    maxPriceCents: sp.maxPrice ? Number(sp.maxPrice) : undefined,
    kind,
    page,
  });
  if (!result.ok) {
    notFound();
  }
  const { listings } = result;

  return (
    <AppShell account={account}>
      <PageHeader
        title="Listings"
        actions={
          <LinkButton href={`/communities/${communityId}/listings/new`}>New listing</LinkButton>
        }
      />

      <ListingDiscoveryControls
        communityId={communityId}
        initialQuery={sp.q ?? ""}
        initialMinPrice={sp.minPrice ?? ""}
        initialMaxPrice={sp.maxPrice ?? ""}
        initialKind={kind ?? ""}
      />

      {listings.length === 0 ? (
        <p className="py-16 text-center text-ink-muted">No listings match. Try a different search or filter.</p>
      ) : (
        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
          {listings.map((listing) => (
            <div
              key={listing.id}
              data-testid="listing-card"
              className="overflow-hidden rounded-card bg-surface shadow-card"
            >
              <Link
                href={`/communities/${communityId}/listings/${listing.id}`}
                className="block text-inherit hover:no-underline"
              >
                <div className="aspect-[4/3] bg-bg">
                  {listing.coverPhotoId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/communities/${communityId}/listings/${listing.id}/photos/${listing.coverPhotoId}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      data-testid="listing-cover-placeholder"
                      className="flex h-full w-full items-center justify-center text-[13px] font-semibold text-ink-muted"
                    >
                      No photo
                    </div>
                  )}
                </div>
                <div className="px-4 pt-3.5">
                  <p
                    data-testid="listing-kind-badge"
                    className="mb-1.5 inline-block rounded-pill bg-brand-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-brand-dark"
                  >
                    {listing.kind === "WANTED" ? "Wanted" : "For sale"}
                  </p>
                  <p className="mb-1 font-bold text-ink">{listing.title}</p>
                  <p className="text-sm text-ink-muted">{formatListingPrice(listing.priceCents)}</p>
                </div>
              </Link>
              <div className="px-4 pb-4">
                <Link
                  href={`/communities/${communityId}/members/${listing.ownerId}`}
                  className="mt-1 inline-block text-[13px] text-ink-muted hover:underline"
                >
                  {resolveDisplayName(listing.ownerDisplayName)}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {(result.page > 1 || result.hasMore) && (
        <p className="mt-6 text-[13px] text-ink-muted">
          {result.page > 1 && (
            <Link href={buildPageHref(communityId, sp, result.page - 1)} className="font-semibold text-brand">
              Previous
            </Link>
          )}
          {result.page > 1 && result.hasMore && " · "}
          {result.hasMore && (
            <Link href={buildPageHref(communityId, sp, result.page + 1)} className="font-semibold text-brand">
              Next
            </Link>
          )}
        </p>
      )}
    </AppShell>
  );
}
