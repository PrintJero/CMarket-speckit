import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { createListing } from "@/server/services/listingService";
import { proposePurchase, acceptProposal } from "@/server/services/transactionService";
import { getReputationSummary, createReview } from "@/server/services/reviewService";

function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date(), displayName: "Test Account" },
  });
}

async function createCommunityWithAdmin(communityName: string, adminEmail: string) {
  const admin = await createVerifiedAccount(adminEmail);
  const result = await createCommunity({ name: communityName, founderEmail: adminEmail, invokedBy: "test-operator" });
  if (!result.ok) throw new Error(`expected community creation to succeed, got ${result.reason}`);
  return { community: result.community, admin };
}

async function addMember(communityId: string, email: string) {
  const account = await createVerifiedAccount(email);
  await prisma.membership.create({ data: { accountId: account.id, communityId, role: "MEMBER" } });
  return account;
}

/**
 * 013-purchase-flow-stock, research.md #11: builds the same "reviewable
 * transaction" fixture 010's confirmed transaction log used to provide, now
 * via this feature's propose-then-accept flow — an ACCEPTED transaction is
 * this entity's replacement for a CONFIRMED one as the reviewable state.
 */
async function createConfirmedTransaction(communityId: string, ownerId: string, buyerId: string, title = "Item") {
  const listing = await createListing({
    communityId,
    ownerId,
    title,
    description: "Description",
    priceCents: 1000,
    kind: "FOR_SALE",
    stockQuantity: 10,
  });
  if (!listing.ok) throw new Error("expected listing creation to succeed");
  const proposed = await proposePurchase({
    communityId,
    listingId: listing.listing.id,
    buyerAccountId: buyerId,
    quantity: 1,
    totalCents: 1000,
  });
  if (!proposed.ok) throw new Error("expected proposal creation to succeed");
  const accepted = await acceptProposal({
    communityId,
    transactionId: proposed.transaction.id,
    callerAccountId: ownerId,
  });
  if (!accepted.ok) throw new Error("expected proposal acceptance to succeed");
  return accepted.transaction;
}

describe("reviewService (contract)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "Review Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "review-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("getReputationSummary", () => {
    // T002 (US1)
    it("returns null average and zero count for an account with no reviews received", async () => {
      const account = await createVerifiedAccount("review-test-nameless@example.com");
      const summary = await getReputationSummary(account.id);
      expect(summary).toEqual({ averageRating: null, reviewCount: 0 });
    });

    // T002 (US1, FR-008, research.md #5): global — never scoped by community.
    it("computes the mean and count across every community the account has been reviewed in", async () => {
      const { community: communityC, admin: ownerC } = await createCommunityWithAdmin(
        "Review Test Community C",
        "review-test-owner-c@example.com",
      );
      const { community: communityD, admin: ownerD } = await createCommunityWithAdmin(
        "Review Test Community D",
        "review-test-owner-d@example.com",
      );
      const buyerC = await addMember(communityC.id, "review-test-buyer-c@example.com");
      const buyerD = await addMember(communityD.id, "review-test-buyer-d@example.com");

      const txC = await createConfirmedTransaction(communityC.id, ownerC.id, buyerC.id);
      const txD = await createConfirmedTransaction(communityD.id, ownerD.id, buyerD.id);

      // ownerC and ownerD are different accounts; seed ratings received by ownerC from both
      // transactions to simulate the same reviewed account rated across two communities. Since
      // txC/txD have different owners, directly create Review rows naming ownerC as reviewed for
      // both, mirroring what createReview() would produce for an account active in two communities.
      await prisma.review.create({
        data: { reviewerId: buyerC.id, reviewedId: ownerC.id, transactionId: txC.id, rating: 5 },
      });
      await prisma.review.create({
        data: { reviewerId: buyerD.id, reviewedId: ownerC.id, transactionId: txD.id, rating: 3 },
      });

      const summary = await getReputationSummary(ownerC.id);
      expect(summary.reviewCount).toBe(2);
      expect(summary.averageRating).toBeCloseTo(4, 5);
    });
  });

  describe("createReview", () => {
    // T016 (US2)
    it("creates a review naming the submitter as reviewer and the other participant as reviewed", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Review Test Community One",
        "review-test-owner-1@example.com",
      );
      const buyer = await addMember(community.id, "review-test-buyer-1@example.com");
      const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id);

      const result = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: owner.id,
        rating: 5,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.review.rating).toBe(5);

      const stored = await prisma.review.findUniqueOrThrow({ where: { id: result.review.id } });
      expect(stored.reviewerId).toBe(owner.id);
      expect(stored.reviewedId).toBe(buyer.id);
      expect(stored.transactionId).toBe(transaction.id);
    });

    // T016 (US2, FR-016, FR-018): both participants may independently rate the same transaction.
    it("lets both participants independently rate the same transaction", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Review Test Community Two",
        "review-test-owner-2@example.com",
      );
      const buyer = await addMember(community.id, "review-test-buyer-2@example.com");
      const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id);

      const fromOwner = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: owner.id,
        rating: 4,
      });
      const fromBuyer = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: buyer.id,
        rating: 2,
      });

      expect(fromOwner.ok).toBe(true);
      expect(fromBuyer.ok).toBe(true);
      expect(await prisma.review.count({ where: { transactionId: transaction.id } })).toBe(2);
    });

    // T016 (US2, FR-020): rating must be an integer 1-5.
    it("rejects a rating that is not an integer from 1 to 5", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Review Test Community Three",
        "review-test-owner-3@example.com",
      );
      const buyer = await addMember(community.id, "review-test-buyer-3@example.com");
      const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id);

      for (const rating of [0, 6, 3.5, Number.NaN]) {
        const result = await createReview({
          communityId: community.id,
          transactionId: transaction.id,
          reviewerAccountId: owner.id,
          rating,
        });
        expect(result).toEqual({ ok: false, reason: "invalid_rating" });
      }
      expect(await prisma.review.count({ where: { transactionId: transaction.id } })).toBe(0);
    });

    // T016 (FR-021): no comment/free-text field exists anywhere on a Review.
    it("accepts no comment or free-text field — a review is exactly its rating", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Review Test Community Four",
        "review-test-owner-4@example.com",
      );
      const buyer = await addMember(community.id, "review-test-buyer-4@example.com");
      const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id);

      const result = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: owner.id,
        rating: 5,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");

      const stored = await prisma.review.findUniqueOrThrow({ where: { id: result.review.id } });
      expect(Object.keys(stored)).not.toContain("comment");
      expect(Object.keys(stored)).not.toContain("body");
      expect(Object.keys(stored)).not.toContain("communityId");
    });

    // T021 (US3, FR-015): a non-participant cannot review a transaction.
    it("rejects a caller who is not a participant of the transaction", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Review Test Community Five",
        "review-test-owner-5@example.com",
      );
      const buyer = await addMember(community.id, "review-test-buyer-5@example.com");
      const outsider = await addMember(community.id, "review-test-outsider-5@example.com");
      const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id);

      const result = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: outsider.id,
        rating: 5,
      });
      expect(result).toEqual({ ok: false, reason: "not_a_participant" });
      expect(await prisma.review.count({ where: { transactionId: transaction.id } })).toBe(0);
    });

    // T021 (US3, FR-014): a PENDING (not yet ACCEPTED) transaction cannot be reviewed.
    it("rejects a review attempt against a still-PENDING transaction", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Review Test Community Six",
        "review-test-owner-6@example.com",
      );
      const buyer = await addMember(community.id, "review-test-buyer-6@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: owner.id,
        title: "Item",
        description: "Description",
        priceCents: 1000,
        kind: "FOR_SALE",
        stockQuantity: 10,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");
      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 1000,
      });
      if (!proposed.ok) throw new Error("expected proposal creation to succeed");

      const result = await createReview({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        reviewerAccountId: owner.id,
        rating: 5,
      });
      expect(result).toEqual({ ok: false, reason: "transaction_not_confirmed" });
      expect(await prisma.review.count({ where: { transactionId: proposed.transaction.id } })).toBe(0);
    });

    // T021 (US3, FR-016): self-review is structurally impossible — the reviewed account is
    // always derived as "the other participant," never equal to the reviewer.
    it("never produces a review where reviewerId equals reviewedId, regardless of who calls it", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Review Test Community Seven",
        "review-test-owner-7@example.com",
      );
      const buyer = await addMember(community.id, "review-test-buyer-7@example.com");
      const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id);

      const fromOwner = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: owner.id,
        rating: 5,
      });
      const fromBuyer = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: buyer.id,
        rating: 5,
      });
      expect(fromOwner.ok).toBe(true);
      expect(fromBuyer.ok).toBe(true);

      const rows = await prisma.review.findMany({ where: { transactionId: transaction.id } });
      for (const row of rows) {
        expect(row.reviewerId).not.toBe(row.reviewedId);
      }
    });

    // T021 (US3, FR-017): duplicate review attempts are rejected, existing row untouched.
    it("rejects a second review from the same reviewer for the same transaction", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Review Test Community Eight",
        "review-test-owner-8@example.com",
      );
      const buyer = await addMember(community.id, "review-test-buyer-8@example.com");
      const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id);

      const first = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: owner.id,
        rating: 5,
      });
      if (!first.ok) throw new Error("expected success");

      const second = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: owner.id,
        rating: 1,
      });
      expect(second).toEqual({ ok: false, reason: "duplicate_review" });

      const stillStored = await prisma.review.findUniqueOrThrow({ where: { id: first.review.id } });
      expect(stillStored.rating).toBe(5);
      expect(await prisma.review.count({ where: { transactionId: transaction.id } })).toBe(1);
    });

    // T021 (US3, FR-019): reviewer's own membership must currently hold.
    it("rejects a reviewer whose own membership has lapsed", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Review Test Community Nine",
        "review-test-owner-9@example.com",
      );
      const buyer = await addMember(community.id, "review-test-buyer-9@example.com");
      const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id);

      await prisma.membership.delete({
        where: { accountId_communityId: { accountId: buyer.id, communityId: community.id } },
      });

      const result = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: buyer.id,
        rating: 5,
      });
      expect(result).toEqual({ ok: false, reason: "not_a_member" });
    });

    // T021 (US3, FR-019): the derived reviewed account's membership must currently hold.
    it("rejects when the derived reviewed account's membership has lapsed", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Review Test Community Ten",
        "review-test-owner-10@example.com",
      );
      const buyer = await addMember(community.id, "review-test-buyer-10@example.com");
      const transaction = await createConfirmedTransaction(community.id, owner.id, buyer.id);

      await prisma.membership.delete({
        where: { accountId_communityId: { accountId: buyer.id, communityId: community.id } },
      });

      const result = await createReview({
        communityId: community.id,
        transactionId: transaction.id,
        reviewerAccountId: owner.id,
        rating: 5,
      });
      expect(result).toEqual({ ok: false, reason: "reviewed_not_a_member" });
      expect(await prisma.review.count({ where: { transactionId: transaction.id } })).toBe(0);
    });

    // T016 (FR-022): no exported function can edit or delete a Review.
    it("exposes no function capable of editing or deleting a review", async () => {
      const reviewServiceModule = await import("@/server/services/reviewService");
      const exportedNames = Object.keys(reviewServiceModule);
      const editLike = exportedNames.filter((name) => /update|edit|patch|delete/i.test(name));
      expect(editLike).toEqual([]);
    });
  });
});
