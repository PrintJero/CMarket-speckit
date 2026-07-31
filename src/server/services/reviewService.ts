import { prisma } from "@/lib/prisma";
import { requireCommunityMembership } from "@/server/services/listingService";

function isValidRating(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * FR-008, FR-023, FR-024, research.md #5: a single unfiltered aggregate —
 * global across every community, never a communityId in the where clause, so
 * there is no per-community intermediate result to ever leak (FR-011).
 * Recomputed fresh on every call, never cached on Account.
 */
export async function getReputationSummary(
  accountId: string,
): Promise<{ averageRating: number | null; reviewCount: number }> {
  const result = await prisma.review.aggregate({
    where: { reviewedId: accountId },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return {
    averageRating: result._count.rating > 0 ? (result._avg.rating ?? null) : null,
    reviewCount: result._count.rating,
  };
}

export type CreateReviewResult =
  | { ok: true; review: { id: string; rating: number; createdAt: Date } }
  | { ok: false; reason: "invalid_rating" }
  | { ok: false; reason: "not_a_member" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_a_participant" }
  | { ok: false; reason: "transaction_not_confirmed" }
  | { ok: false; reason: "reviewed_not_a_member" }
  | { ok: false; reason: "duplicate_review" };

export interface CreateReviewInput {
  communityId: string;
  transactionId: string;
  reviewerAccountId: string;
  rating: number;
}

/**
 * FR-010, FR-012–FR-020. Gate order per data-model.md's creation gates: rating
 * shape (no DB access) → reviewer membership (SUSPENDED tolerated, research.md
 * #4) → transaction lookup → participant derivation (the reviewed account is
 * always "whichever of the pair the reviewer is not," research.md #3 — makes
 * FR-016's self-review rejection structural, not a separate branch) →
 * confirmed state → the derived reviewed account's own current membership →
 * duplicate check. No row is persisted if any gate fails.
 */
export async function createReview(input: CreateReviewInput): Promise<CreateReviewResult> {
  const { communityId, transactionId, reviewerAccountId, rating } = input;

  if (!isValidRating(rating)) {
    return { ok: false, reason: "invalid_rating" };
  }

  if (!(await requireCommunityMembership(reviewerAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "not_a_member" };
  }

  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.communityId !== communityId) {
    return { ok: false, reason: "not_found" };
  }

  const isBuyer = transaction.buyerId === reviewerAccountId;
  const isSeller = transaction.sellerId === reviewerAccountId;
  if (!isBuyer && !isSeller) {
    return { ok: false, reason: "not_a_participant" };
  }
  const reviewedAccountId = isBuyer ? transaction.sellerId : transaction.buyerId;

  // 013-purchase-flow-stock, research.md #11, FR-029: ACCEPTED is this entity's
  // replacement for 010's CONFIRMED as the reviewable/reputation-eligible state.
  if (transaction.state !== "ACCEPTED") {
    return { ok: false, reason: "transaction_not_confirmed" };
  }

  if (!(await requireCommunityMembership(reviewedAccountId, communityId, { allowSuspended: true }))) {
    return { ok: false, reason: "reviewed_not_a_member" };
  }

  const existing = await prisma.review.findUnique({
    where: { reviewerId_transactionId: { reviewerId: reviewerAccountId, transactionId } },
  });
  if (existing) {
    return { ok: false, reason: "duplicate_review" };
  }

  const created = await prisma.review.create({
    data: { reviewerId: reviewerAccountId, reviewedId: reviewedAccountId, transactionId, rating },
  });

  return { ok: true, review: { id: created.id, rating: created.rating, createdAt: created.createdAt } };
}

/** Supports the transaction detail page's "already rated" read-only state — not itself an FR gate. */
export async function getMyReview(
  transactionId: string,
  reviewerAccountId: string,
): Promise<{ rating: number } | null> {
  const review = await prisma.review.findUnique({
    where: { reviewerId_transactionId: { reviewerId: reviewerAccountId, transactionId } },
    select: { rating: true },
  });
  return review;
}
