import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listListings } from "@/server/services/listingService";
import { getReputationSummaries } from "@/server/services/reviewService";
import { prisma } from "@/lib/prisma";
import { formatListingPrice } from "@/lib/formatting/currency";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { MainViewControls } from "./MainViewControls";
import { AppShell } from "../../_components/AppShell";
import { PageHeader } from "../../_components/PageHeader";
import { LinkButton } from "../../_components/Button";
import { ListingImage, ListingImagePlaceholder } from "../../_components/ListingImage";

/**
 * 015-navigation-shell-community-selector, User Story 2 (FR-006–FR-008),
 * contracts/navigation-shell-api.md. The active community's own home: search
 * + a For sale/Wanted feed, scoped ONLY to this one communityId via the
 * existing listListings() gate — never a union of more than one community
 * (Principle II). This page's server render performs no writes of any kind;
 * the deep-link "become active" sync lives in MainViewControls.tsx
 * (research.md #4a).
 */
export default async function CommunityMainViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ communityId: string }>;
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  const { communityId } = await params;
  const sp = await searchParams;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const kind = sp.kind === "WANTED" ? "WANTED" : "FOR_SALE";
  const result = await listListings(communityId, account.accountId, { search: sp.q, kind });
  if (!result.ok) {
    notFound();
  }
  const { listings } = result;

  const community = account.memberships.find((membership) => membership.communityId === communityId);

  const ownerIds = [...new Set(listings.map((listing) => listing.ownerId))];
  const [reputationByOwner, currentMemberIds] = await Promise.all([
    getReputationSummaries(ownerIds),
    ownerIds.length === 0
      ? Promise.resolve(new Set<string>())
      : (async () => {
          const communityRecord = await prisma.community.findUnique({
            where: { id: communityId },
            select: { operationalEpoch: true },
          });
          const memberships = await prisma.membership.findMany({
            where: {
              communityId,
              accountId: { in: ownerIds },
              operationalEpoch: communityRecord?.operationalEpoch ?? 1,
            },
            select: { accountId: true },
          });
          return new Set(memberships.map((membership) => membership.accountId));
        })(),
  ]);

  return (
    <AppShell account={account}>
      <PageHeader
        title={community?.communityName ?? "Community"}
        actions={<LinkButton href={`/communities/${communityId}/listings/new`}>New listing</LinkButton>}
      />

      <MainViewControls
        communityId={communityId}
        initialQuery={sp.q ?? ""}
        initialKind={kind}
      />

      {listings.length === 0 ? (
        <p className="py-16 text-center text-ink-muted">No listings match. Try a different search.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
          {listings.map((listing) => {
            const reputation = reputationByOwner.get(listing.ownerId);
            return (
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
                    {listing.coverPhoto ? (
                      <ListingImage
                        communityId={communityId}
                        photoId={listing.coverPhoto.id}
                        variant="card"
                        width={listing.coverPhoto.width}
                        height={listing.coverPhoto.height}
                        alt={`${listing.title} — cover photo`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ListingImagePlaceholder />
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
                <div className="flex items-center gap-1.5 px-4 pb-4">
                  <Link
                    href={`/communities/${communityId}/members/${listing.ownerId}`}
                    className="min-w-0 truncate text-[13px] text-ink-muted hover:underline"
                  >
                    {resolveDisplayName(listing.ownerDisplayName)}
                  </Link>
                  {currentMemberIds.has(listing.ownerId) && (
                    <span
                      data-testid="verified-member-badge"
                      title="Verified community member"
                      className="flex-none text-[13px] font-bold text-brand"
                    >
                      ✓
                    </span>
                  )}
                  {reputation && reputation.reviewCount > 0 && (
                    <span className="flex-none text-[12px] text-ink-muted">
                      · {reputation.averageRating?.toFixed(1)}★ ({reputation.reviewCount})
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
