import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentAccount } from "@/lib/auth/currentAccount";
import { listMyListings } from "@/server/services/listingService";
import { AppShell } from "../_components/AppShell";
import { PageHeader } from "../_components/PageHeader";
import { Card } from "../_components/Card";

/** FR-021, FR-022 (2026-07-17 amendment): every owned listing, any status, across current communities, with a database-computed thread count. */
export default async function MyListingsPage() {
  const account = await getCurrentAccount();
  if (!account) {
    notFound();
  }

  const result = await listMyListings(account.accountId);

  return (
    <AppShell account={account}>
      <PageHeader title="My listings" />

      {result.listings.length === 0 ? (
        <p>You don&apos;t own any listings yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {result.listings.map((listing) => (
            <Card key={listing.id} className="max-w-xl" data-testid="my-listing-row">
              <p className="font-semibold text-ink">{listing.title}</p>
              <p className="text-[13px] text-ink-muted">
                {listing.communityName} · {listing.status} · {listing.threadCount}{" "}
                {listing.threadCount === 1 ? "thread" : "threads"}
              </p>
              <div className="mt-2 flex gap-3 text-sm font-semibold">
                <Link href={`/communities/${listing.communityId}/listings/${listing.id}`} className="text-brand">
                  View listing
                </Link>
                <Link
                  href={`/communities/${listing.communityId}/threads?listingId=${listing.id}`}
                  className="text-brand"
                >
                  View threads
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
