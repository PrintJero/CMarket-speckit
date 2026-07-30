import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getProfile } from "@/server/services/profileService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { formatListingPrice } from "@/lib/formatting/currency";
import { formatAverageRating } from "@/lib/formatting/rating";
import { AppShell } from "../../../../_components/AppShell";
import { BackLink } from "../../../../_components/BackLink";
import { PageHeader } from "../../../../_components/PageHeader";
import { Card } from "../../../../_components/Card";

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ communityId: string; accountId: string }>;
}) {
  const { communityId, accountId } = await params;
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const result = await getProfile({ communityId, accountId, viewerAccountId: account.accountId });
  if (!result.ok) {
    notFound();
  }

  const { profile } = result;

  return (
    <AppShell account={account}>
      <BackLink href={`/communities/${communityId}/listings`}>Back to listings</BackLink>
      <PageHeader title={resolveDisplayName(profile.displayName)} />

      <Card className="mb-5 max-w-xl">
        <p className="text-[13px] text-ink-muted">
          Member since {new Date(profile.memberSince).toLocaleDateString()}
        </p>
        <div className="mt-4 flex gap-8" data-testid="profile-reputation">
          <div>
            <p className="text-[22px] font-bold text-ink">{formatAverageRating(profile.averageRating)}</p>
            <p className="text-[12px] text-ink-muted">
              {profile.reviewCount} {profile.reviewCount === 1 ? "review" : "reviews"}
            </p>
          </div>
          <div>
            <p className="text-[22px] font-bold text-ink">{profile.confirmedTransactionCount}</p>
            <p className="text-[12px] text-ink-muted">Confirmed transactions</p>
          </div>
        </div>
      </Card>

      <Card className="max-w-xl">
        <p className="mb-3 text-[13px] font-bold uppercase tracking-wider text-ink-muted">Active listings</p>
        {profile.activeListings.length === 0 ? (
          <p className="text-ink-muted">No active listings in this community.</p>
        ) : (
          <div className="flex flex-col gap-3" data-testid="profile-active-listings">
            {profile.activeListings.map((listing) => (
              <Link
                key={listing.id}
                href={`/communities/${communityId}/listings/${listing.id}`}
                className="block rounded-card bg-bg p-3 hover:no-underline"
              >
                <p className="font-semibold text-ink">{listing.title}</p>
                <p className="text-[13px] text-ink-muted">
                  {listing.kind === "WANTED" ? "Wanted" : "For sale"} · {formatListingPrice(listing.priceCents)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </AppShell>
  );
}
