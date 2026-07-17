import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentAccount } from "@/lib/auth/currentAccount";

const priceFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Member-only (any role) feed of a community's own ACTIVE listings.
 * Same notFound() convention as /communities/{id}/admin, but gated on any
 * Membership row, not just ADMINISTRATOR (FR-011, FR-012).
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

  const membership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId: account.accountId, communityId } },
  });
  if (!membership) {
    notFound();
  }

  const listings = await prisma.listing.findMany({
    where: { communityId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });

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
          <div className="operator-table-wrap">
            <table className="operator-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => (
                  <tr key={listing.id}>
                    <td>
                      <Link href={`/communities/${communityId}/listings/${listing.id}`}>
                        {listing.title}
                      </Link>
                    </td>
                    <td>{priceFormatter.format(listing.priceCents / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
