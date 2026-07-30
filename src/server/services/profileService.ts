import { prisma } from "@/lib/prisma";
import { requireCommunityMembership } from "@/server/services/listingService";
import { getReputationSummary } from "@/server/services/reviewService";

export type GetProfileResult =
  | {
      ok: true;
      profile: {
        accountId: string;
        displayName: string | null;
        memberSince: Date;
        activeListings: {
          id: string;
          title: string;
          kind: "FOR_SALE" | "WANTED";
          priceCents: number | null;
          coverPhotoId: string | null;
        }[];
        confirmedTransactionCount: number;
        averageRating: number | null;
        reviewCount: number;
      };
    }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" };

export interface GetProfileInput {
  communityId: string;
  accountId: string;
  viewerAccountId: string;
}

/**
 * FR-001, FR-002, FR-006–FR-009. Access gates (data-model.md): the viewer
 * MUST currently hold membership in communityId (FR-006); the profile
 * account MUST too (research.md #1 — Membership has no soft-delete column,
 * so a departed member has no Membership.createdAt left to source a
 * member-since date from). Member-since date and active listings are scoped
 * to communityId (FR-007); confirmed-transaction count and the reputation
 * summary are global across every community (FR-008, FR-009, Clarifications)
 * — never filtered by communityId.
 */
export async function getProfile(input: GetProfileInput): Promise<GetProfileResult> {
  const { communityId, accountId, viewerAccountId } = input;

  if (!(await requireCommunityMembership(viewerAccountId, communityId))) {
    return { ok: false, reason: "not_a_member" };
  }

  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { operationalEpoch: true },
  });
  const currentEpoch = community?.operationalEpoch ?? 1;

  const membership = await prisma.membership.findUnique({
    where: { accountId_communityId: { accountId, communityId } },
  });
  if (!membership || membership.operationalEpoch !== currentEpoch) {
    return { ok: false, reason: "not_found" };
  }

  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { displayName: true } });

  const [activeListings, confirmedTransactionCount, reputationSummary] = await Promise.all([
    prisma.listing.findMany({
      where: { ownerId: accountId, communityId, status: "ACTIVE", operationalEpoch: currentEpoch },
      orderBy: { createdAt: "desc" },
    }),
    prisma.transaction.count({
      where: {
        confirmationState: "CONFIRMED",
        OR: [{ recorderId: accountId }, { counterpartId: accountId }],
      },
    }),
    getReputationSummary(accountId),
  ]);

  return {
    ok: true,
    profile: {
      accountId,
      displayName: account?.displayName ?? null,
      memberSince: membership.createdAt,
      activeListings: activeListings.map((listing) => ({
        id: listing.id,
        title: listing.title,
        kind: listing.kind,
        priceCents: listing.priceCents,
        coverPhotoId: listing.coverPhotoId,
      })),
      confirmedTransactionCount,
      ...reputationSummary,
    },
  };
}
