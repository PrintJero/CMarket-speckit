import { prisma } from "@/lib/prisma";
import { getReputationSummary } from "@/server/services/reviewService";
import type { MembershipRole } from "@prisma/client";

interface CurrentMembershipDetail {
  communityName: string;
  role: MembershipRole;
  memberSince: Date;
  currentEpoch: number;
}

/**
 * 014-account-public-profiles, research.md #3: the same "current membership"
 * definition already independently implemented in getCurrentAccount()
 * (src/lib/auth/currentAccount.ts), listMyListings(), and listMyThreads() —
 * a Membership row counts only when its own operationalEpoch matches its
 * Community's current one. Kept local to this file rather than extracted
 * into a shared cross-module utility, matching that same established
 * per-service-duplication convention (Constitution Principle VII).
 */
async function getCurrentMembershipsWithDetails(accountId: string): Promise<Map<string, CurrentMembershipDetail>> {
  const memberships = await prisma.membership.findMany({
    where: { accountId },
    include: { community: { select: { name: true, operationalEpoch: true } } },
  });

  const result = new Map<string, CurrentMembershipDetail>();
  for (const membership of memberships) {
    if (membership.operationalEpoch !== membership.community.operationalEpoch) continue;
    result.set(membership.communityId, {
      communityName: membership.community.name,
      role: membership.role,
      memberSince: membership.createdAt,
      currentEpoch: membership.community.operationalEpoch,
    });
  }
  return result;
}

interface ProfileListing {
  id: string;
  title: string;
  kind: "FOR_SALE" | "WANTED";
  priceCents: number | null;
  stockQuantity: number | null;
  coverPhotoId: string | null;
}

/** FR-007, FR-023, FR-024: ACTIVE only, both kinds, no status field in the returned shape. */
async function getActiveListingsForCommunity(
  accountId: string,
  communityId: string,
  currentEpoch: number,
): Promise<ProfileListing[]> {
  const listings = await prisma.listing.findMany({
    where: { ownerId: accountId, communityId, status: "ACTIVE", operationalEpoch: currentEpoch },
    orderBy: { createdAt: "desc" },
  });
  return listings.map((listing) => ({
    id: listing.id,
    title: listing.title,
    kind: listing.kind,
    priceCents: listing.priceCents,
    stockQuantity: listing.stockQuantity,
    coverPhotoId: listing.coverPhotoId,
  }));
}

export interface SelfProfileCommunity {
  communityId: string;
  communityName: string;
  role: MembershipRole;
  memberSince: Date;
  listings: ProfileListing[];
}

export interface SelfProfile {
  accountId: string;
  displayName: string | null;
  email: string;
  accountCreatedAt: Date;
  averageRating: number | null;
  reviewCount: number;
  completedTransactionCount: number;
  communities: SelfProfileCommunity[];
}

/**
 * 014-account-public-profiles, FR-001–FR-009b. No access gate beyond the
 * caller already being this signed-in account — the route calling this MUST
 * pass the current session's own accountId, never a caller-supplied one
 * (data-model.md's "Self-profile assembly"). Shows every current community
 * (not restricted to any shared set — that restriction is unique to
 * getProfile() below) plus this account's own email and creation date,
 * neither of which ever appears in getProfile()'s public-profile shape.
 */
export async function getSelfProfile(accountId: string): Promise<SelfProfile> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { displayName: true, email: true, createdAt: true },
  });

  const [memberships, completedTransactionCount, reputationSummary] = await Promise.all([
    getCurrentMembershipsWithDetails(accountId),
    prisma.transaction.count({
      where: { state: "ACCEPTED", OR: [{ buyerId: accountId }, { sellerId: accountId }] },
    }),
    getReputationSummary(accountId),
  ]);

  const communities = await Promise.all(
    [...memberships.entries()].map(async ([communityId, detail]) => ({
      communityId,
      communityName: detail.communityName,
      role: detail.role,
      memberSince: detail.memberSince,
      listings: await getActiveListingsForCommunity(accountId, communityId, detail.currentEpoch),
    })),
  );

  return {
    accountId,
    displayName: account.displayName,
    email: account.email,
    accountCreatedAt: account.createdAt,
    completedTransactionCount,
    communities,
    ...reputationSummary,
  };
}

export interface PublicProfileCommunity {
  communityId: string;
  communityName: string;
  memberSince: Date;
  listings: ProfileListing[];
}

export type GetProfileResult =
  | {
      ok: true;
      profile: {
        accountId: string;
        displayName: string | null;
        communities: PublicProfileCommunity[];
        completedTransactionCount: number;
        averageRating: number | null;
        reviewCount: number;
      };
    }
  | { ok: false; reason: "not_found" };

export interface GetProfileInput {
  accountId: string;
  viewerAccountId: string;
}

/**
 * 014-account-public-profiles, FR-010–FR-021. Access is decided solely by
 * whether the viewer's and the target's own current-membership community-id
 * sets intersect (data-model.md's access algorithm, research.md #1) — no
 * communityId parameter exists here at all; a caller's own route may still
 * carry one in its URL purely for navigation, but it plays no role in this
 * decision. A nonexistent accountId and a shared-nothing accountId return
 * the identical not_found response (research.md #2), so a stranger cannot
 * distinguish "doesn't exist" from "exists but shares nothing with me."
 * completedTransactionCount/averageRating/reviewCount remain global, exactly
 * as before this feature (FR-018–FR-021) — unchanged in derivation.
 */
export async function getProfile(input: GetProfileInput): Promise<GetProfileResult> {
  const { accountId, viewerAccountId } = input;

  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { displayName: true } });
  if (!account) {
    return { ok: false, reason: "not_found" };
  }

  const [viewerMemberships, targetMemberships] = await Promise.all([
    getCurrentMembershipsWithDetails(viewerAccountId),
    getCurrentMembershipsWithDetails(accountId),
  ]);

  const sharedCommunityIds = [...targetMemberships.keys()].filter((communityId) =>
    viewerMemberships.has(communityId),
  );
  if (sharedCommunityIds.length === 0) {
    return { ok: false, reason: "not_found" };
  }

  const [communities, completedTransactionCount, reputationSummary] = await Promise.all([
    Promise.all(
      sharedCommunityIds.map(async (communityId) => {
        const detail = targetMemberships.get(communityId)!;
        return {
          communityId,
          communityName: detail.communityName,
          memberSince: detail.memberSince,
          listings: await getActiveListingsForCommunity(accountId, communityId, detail.currentEpoch),
        };
      }),
    ),
    prisma.transaction.count({
      where: { state: "ACCEPTED", OR: [{ buyerId: accountId }, { sellerId: accountId }] },
    }),
    getReputationSummary(accountId),
  ]);

  return {
    ok: true,
    profile: {
      accountId,
      displayName: account.displayName,
      communities,
      completedTransactionCount,
      ...reputationSummary,
    },
  };
}
