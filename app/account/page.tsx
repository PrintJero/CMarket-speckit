import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { getSelfProfile } from "@/server/services/profileService";
import { resolveDisplayName } from "@/lib/formatting/displayName";
import { formatListingPrice } from "@/lib/formatting/currency";
import { formatAverageRating } from "@/lib/formatting/rating";
import { AppShell } from "../_components/AppShell";
import { PageHeader } from "../_components/PageHeader";
import { Card } from "../_components/Card";
import { DisplayNameForm } from "./DisplayNameForm";

export default async function AccountPage() {
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const profile = await getSelfProfile(account.accountId);

  return (
    <AppShell account={account}>
      <PageHeader title="Account" />

      <Card className="mb-5 max-w-xl">
        <p className="text-[16px] font-bold text-ink">{resolveDisplayName(profile.displayName)}</p>
        <DisplayNameForm currentDisplayName={profile.displayName} />
        <p className="mt-2 text-[13px] text-ink-muted">{profile.email}</p>
        <p className="mt-1 text-[13px] text-ink-muted">
          Member since {new Date(profile.accountCreatedAt).toLocaleDateString()}
        </p>
        <div className="mt-4 flex gap-8" data-testid="profile-reputation">
          <div>
            <p className="text-[22px] font-bold text-ink">{formatAverageRating(profile.averageRating)}</p>
            <p className="text-[12px] text-ink-muted">
              {profile.reviewCount} {profile.reviewCount === 1 ? "review" : "reviews"}
            </p>
          </div>
          <div>
            <p className="text-[22px] font-bold text-ink">{profile.completedTransactionCount}</p>
            <p className="text-[12px] text-ink-muted">Completed transactions</p>
          </div>
        </div>
      </Card>

      <h2 className="mb-3 text-[15px] font-bold text-ink">My communities</h2>
      {profile.communities.length === 0 ? (
        <Card className="max-w-xl">
          <p className="text-ink-muted">You haven&apos;t joined any communities yet.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4" data-testid="self-profile-communities">
          {profile.communities.map((community) => (
            <Card key={community.communityId} className="max-w-xl" data-testid="self-profile-community">
              <div className="flex items-center justify-between">
                <Link
                  href={`/communities/${community.communityId}/listings`}
                  className="text-[15px] font-bold text-ink hover:underline"
                >
                  {community.communityName}
                </Link>
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                  {community.role === "ADMINISTRATOR" ? "Administrator" : "Member"}
                </span>
              </div>
              <p className="mb-3 text-[13px] text-ink-muted">
                Member since {new Date(community.memberSince).toLocaleDateString()}
              </p>

              {community.listings.length === 0 ? (
                <p className="text-ink-muted">No active listings in this community.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {community.listings.map((listing) => (
                    <Link
                      key={listing.id}
                      href={`/communities/${community.communityId}/listings/${listing.id}`}
                      className="block rounded-card bg-bg p-3 hover:no-underline"
                    >
                      <p className="font-semibold text-ink">{listing.title}</p>
                      <p className="text-[13px] text-ink-muted">
                        {listing.kind === "WANTED" ? "Wanted" : "For sale"} · {formatListingPrice(listing.priceCents)}
                        {listing.kind === "FOR_SALE" && listing.stockQuantity !== null
                          ? ` · ${listing.stockQuantity} in stock`
                          : ""}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
