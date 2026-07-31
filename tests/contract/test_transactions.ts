import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { createListing, updateListing, pauseListing, deleteListing } from "@/server/services/listingService";
import {
  proposePurchase,
  acceptProposal,
  rejectProposal,
  cancelProposal,
  getTransaction,
  listTransactions,
  listMyTransactions,
} from "@/server/services/transactionService";
import { createReview } from "@/server/services/reviewService";

/** Mirrors tests/contract/test_messaging.ts's own helper. */
function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date(), displayName: "Test Account" },
  });
}

async function createCommunityWithAdmin(communityName: string, adminEmail: string) {
  const admin = await createVerifiedAccount(adminEmail);
  const result = await createCommunity({
    name: communityName,
    founderEmail: adminEmail,
    invokedBy: "test-operator",
  });
  if (!result.ok) throw new Error(`expected community creation to succeed, got ${result.reason}`);
  return { community: result.community, admin };
}

async function addMember(communityId: string, email: string) {
  const account = await createVerifiedAccount(email);
  await prisma.membership.create({ data: { accountId: account.id, communityId, role: "MEMBER" } });
  return account;
}

/** A FOR_SALE, ACTIVE listing with declared stock — 013-purchase-flow-stock's baseline fixture. */
async function createForSaleListing(
  communityId: string,
  ownerId: string,
  options: { title?: string; priceCents?: number; stockQuantity?: number } = {},
) {
  const created = await createListing({
    communityId,
    ownerId,
    title: options.title ?? "Bicycle",
    description: "Description",
    priceCents: options.priceCents ?? 25000,
    kind: "FOR_SALE",
    stockQuantity: options.stockQuantity ?? 10,
  });
  if (!created.ok) throw new Error("expected listing creation to succeed");
  return created.listing;
}

describe("transactionService (contract)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "Transaction Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "transaction-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("proposePurchase", () => {
    // T008 (US1, FR-003, FR-011, FR-012, FR-023, FR-024, FR-027)
    it("creates a PENDING proposal naming buyer/seller/listing/community/quantity/total, leaving stock unchanged, with no MessageThread involved", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community One",
        "transaction-test-seller-1@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-1@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const result = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.transaction.state).toBe("PENDING");
      expect(result.transaction.paymentPath).toBe("OFF_PLATFORM");
      expect(result.transaction.listingId).toBe(listing.id);
      expect(result.transaction.listingTitle).toBe(listing.title);
      expect(result.transaction.quantity).toBe(1);
      expect(result.transaction.totalCents).toBe(25000);

      const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: result.transaction.id } });
      expect(stored.communityId).toBe(community.id);
      expect(stored.buyerId).toBe(buyer.id);
      expect(stored.sellerId).toBe(seller.id);

      const unchangedListing = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(unchangedListing.stockQuantity).toBe(10);

      // FR-027: no message-thread prerequisite — the proposal succeeds with zero prior interaction.
      const threadCount = await prisma.messageThread.count({ where: { listingId: listing.id, buyerId: buyer.id } });
      expect(threadCount).toBe(0);
    });

    // T008 (US1, FR-004): increasing quantity is reflected in the created row.
    it("persists a larger quantity and its independently-edited total", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Two",
        "transaction-test-seller-2@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-2@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10, priceCents: 25000 });

      const result = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 3,
        totalCents: 70000, // negotiated off-platform, not 3 x 25000
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.transaction.quantity).toBe(3);
      expect(result.transaction.totalCents).toBe(70000);
    });

    // T008 (Edge Cases): quantity/total must be positive integers.
    it("rejects a zero/negative quantity or total, creating nothing", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Three",
        "transaction-test-seller-3@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-3@example.com");
      const listing = await createForSaleListing(community.id, seller.id);

      for (const quantity of [0, -1]) {
        const result = await proposePurchase({
          communityId: community.id,
          listingId: listing.id,
          buyerAccountId: buyer.id,
          quantity,
          totalCents: 25000,
        });
        expect(result).toEqual({ ok: false, reason: "invalid_input" });
      }
      for (const totalCents of [0, -1]) {
        const result = await proposePurchase({
          communityId: community.id,
          listingId: listing.id,
          buyerAccountId: buyer.id,
          quantity: 1,
          totalCents,
        });
        expect(result).toEqual({ ok: false, reason: "invalid_input" });
      }
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T008 (FR-007): a buyer with no membership in the listing's community cannot propose.
    it("rejects a buyer with no membership in the listing's community", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Four",
        "transaction-test-seller-4@example.com",
      );
      const outsider = await createVerifiedAccount("transaction-test-outsider-4@example.com");
      const listing = await createForSaleListing(community.id, seller.id);

      const result = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: outsider.id,
        quantity: 1,
        totalCents: 25000,
      });
      expect(result).toEqual({ ok: false, reason: "not_a_member" });
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T008 (research.md #7): a WANTED post cannot be bought.
    it("rejects a proposal against a WANTED listing as not_found", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Five",
        "transaction-test-seller-5@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-5@example.com");
      const wanted = await createListing({
        communityId: community.id,
        ownerId: seller.id,
        title: "Looking for a bike",
        description: "Description",
        kind: "WANTED",
      });
      if (!wanted.ok) throw new Error("expected listing creation to succeed");

      const result = await proposePurchase({
        communityId: community.id,
        listingId: wanted.listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 100,
      });
      expect(result).toEqual({ ok: false, reason: "not_found" });
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T008 (FR-009): a PAUSED listing rejects new proposals.
    it("rejects a proposal against a PAUSED listing", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Six",
        "transaction-test-seller-6@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-6@example.com");
      const listing = await createForSaleListing(community.id, seller.id);
      await pauseListing({ listingId: listing.id, callerAccountId: seller.id });

      const result = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      expect(result).toEqual({ ok: false, reason: "listing_not_active" });
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T008 (research.md #8): stock not yet declared blocks every proposal.
    it("rejects a proposal against a listing with no declared stock", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Seven",
        "transaction-test-seller-7@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-7@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: seller.id,
        title: "No stock set",
        description: "Description",
        priceCents: 25000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");
      expect(listing.listing.stockQuantity).toBeNull();

      const result = await proposePurchase({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      expect(result).toEqual({ ok: false, reason: "stock_not_specified" });
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T008 (FR-008): quantity may not exceed the listing's current stock.
    it("rejects a proposal whose quantity exceeds the listing's current stock", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Eight",
        "transaction-test-seller-8@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-8@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const result = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 11,
        totalCents: 25000,
      });
      expect(result).toEqual({ ok: false, reason: "exceeds_stock" });
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T008 (FR-010): a buyer cannot propose against their own listing.
    it("rejects the listing's own owner attempting to buy from themselves", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Nine",
        "transaction-test-seller-9@example.com",
      );
      const listing = await createForSaleListing(community.id, seller.id);

      const result = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: seller.id,
        quantity: 1,
        totalCents: 25000,
      });
      expect(result).toEqual({ ok: false, reason: "self_purchase" });
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T008 (FR-007): the listing's owner must currently hold membership too.
    it("rejects a proposal when the listing's owner has lost membership", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Ten",
        "transaction-test-seller-10@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-10@example.com");
      const listing = await createForSaleListing(community.id, seller.id);

      await prisma.membership.delete({
        where: { accountId_communityId: { accountId: seller.id, communityId: community.id } },
      });

      const result = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      expect(result).toEqual({ ok: false, reason: "seller_not_a_member" });
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T008 (FR-026, SC-005): no response anywhere carries contact data.
    it("never returns an email, phone, or address field", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Contact",
        "transaction-test-seller-contact@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-contact@example.com");
      const listing = await createForSaleListing(community.id, seller.id);

      const created = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!created.ok) throw new Error("expected success");
      expect(Object.keys(created.transaction).some((k) => /email|phone|address/i.test(k))).toBe(false);
      expect(JSON.stringify(created.transaction)).not.toMatch(/@example\.com/);
    });
  });

  describe("acceptProposal / rejectProposal", () => {
    // T014 (US2, FR-015)
    it("accepts a PENDING proposal, decrementing stock by exactly the proposed quantity", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Accept One",
        "transaction-test-seller-accept-1@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-accept-1@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 3,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      const accepted = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) throw new Error("expected success");
      expect(accepted.transaction.state).toBe("ACCEPTED");
      expect(accepted.transaction.resolvedAt).not.toBeNull();

      const stillListed = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(stillListed.stockQuantity).toBe(7);
    });

    // T014 (US2, FR-014, research.md #5): accepting a second proposal that would now exceed stock fails, atomically.
    it("rejects accepting a second proposal once stock is exhausted by an earlier acceptance, leaving it PENDING", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Accept Two",
        "transaction-test-seller-accept-2@example.com",
      );
      const buyerOne = await addMember(community.id, "transaction-test-buyer-accept-2a@example.com");
      const buyerTwo = await addMember(community.id, "transaction-test-buyer-accept-2b@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 2 });

      const first = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyerOne.id,
        quantity: 2,
        totalCents: 25000,
      });
      const second = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyerTwo.id,
        quantity: 2,
        totalCents: 25000,
      });
      if (!first.ok || !second.ok) throw new Error("expected both proposals to succeed");

      const firstAccept = await acceptProposal({
        communityId: community.id,
        transactionId: first.transaction.id,
        callerAccountId: seller.id,
      });
      expect(firstAccept.ok).toBe(true);
      const afterFirst = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(afterFirst.stockQuantity).toBe(0);

      const secondAccept = await acceptProposal({
        communityId: community.id,
        transactionId: second.transaction.id,
        callerAccountId: seller.id,
      });
      expect(secondAccept).toEqual({ ok: false, reason: "exceeds_stock" });

      const stillPending = await prisma.transaction.findUniqueOrThrow({ where: { id: second.transaction.id } });
      expect(stillPending.state).toBe("PENDING");
      const unchangedStock = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(unchangedStock.stockQuantity).toBe(0);
    });

    // T014 (US2, FR-009, FR-014, spec.md US2 Acceptance Scenario 6, SC-009): pausing after creation does not block acceptance.
    it("still accepts a PENDING proposal whose listing was paused after the proposal was submitted", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Accept Pause",
        "transaction-test-seller-accept-pause@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-accept-pause@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      await pauseListing({ listingId: listing.id, callerAccountId: seller.id });

      const accepted = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) throw new Error("expected success");
      expect(accepted.transaction.state).toBe("ACCEPTED");
    });

    // T014 (US2, FR-016)
    it("rejects a PENDING proposal, leaving stock and history untouched", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Reject One",
        "transaction-test-seller-reject-1@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-reject-1@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 2,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      const rejected = await rejectProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(rejected.ok).toBe(true);
      if (!rejected.ok) throw new Error("expected success");
      expect(rejected.transaction.state).toBe("REJECTED");

      const stillListed = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(stillListed.stockQuantity).toBe(10);
    });

    // T014 (US2, FR-013): only the seller may accept or reject.
    it("rejects a non-seller (including the buyer) attempting to accept or reject", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Accept Three",
        "transaction-test-seller-accept-3@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-accept-3@example.com");
      const outsider = await addMember(community.id, "transaction-test-outsider-accept-3@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      const byBuyer = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(byBuyer).toEqual({ ok: false, reason: "not_a_seller" });

      const byOutsider = await rejectProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: outsider.id,
      });
      expect(byOutsider).toEqual({ ok: false, reason: "not_a_seller" });
    });

    // T014 (US2, FR-017): a resolved proposal cannot be resolved twice.
    it("rejects accepting or rejecting a proposal that is not currently PENDING", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Accept Four",
        "transaction-test-seller-accept-4@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-accept-4@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      const accepted = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(accepted.ok).toBe(true);

      const acceptAgain = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(acceptAgain).toEqual({ ok: false, reason: "not_pending" });

      const rejectAfterAccept = await rejectProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(rejectAfterAccept).toEqual({ ok: false, reason: "not_pending" });
    });

    // T014 (US2, FR-022): no exported function can edit any core field of an ACCEPTED transaction.
    it("exposes no function capable of editing a transaction's core fields", async () => {
      const transactionServiceModule = await import("@/server/services/transactionService");
      const exportedNames = Object.keys(transactionServiceModule);
      const editLike = exportedNames.filter((name) => /update|edit|patch|delete/i.test(name));
      expect(editLike).toEqual([]);
    });
  });

  describe("cross-community and stock-integrity rejections (US3)", () => {
    // T020 (US3, FR-014): a membership lapse between creation and resolution blocks resolution, leaving the proposal untouched.
    it("rejects accept/reject/cancel-adjacent resolution once the seller's or buyer's membership has lapsed", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community US3 One",
        "transaction-test-seller-us3-1@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-us3-1@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      await prisma.membership.delete({
        where: { accountId_communityId: { accountId: buyer.id, communityId: community.id } },
      });

      const acceptAttempt = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(acceptAttempt).toEqual({ ok: false, reason: "not_a_member" });

      const stillPending = await prisma.transaction.findUniqueOrThrow({ where: { id: proposed.transaction.id } });
      expect(stillPending.state).toBe("PENDING");
    });

    // T020 (US3, research.md #4a/#6): creation requires ACTIVE; resolving an existing proposal tolerates SUSPENDED.
    it("blocks new proposals while SUSPENDED but still allows resolving an existing one", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community US3 Two",
        "transaction-test-seller-us3-2@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-us3-2@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      await prisma.community.update({ where: { id: community.id }, data: { status: "SUSPENDED" } });

      const newAttempt = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      expect(newAttempt).toEqual({ ok: false, reason: "not_a_member" });

      const accepted = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(accepted.ok).toBe(true);
    });

    // T020 (US3): an ARCHIVED community blocks both creation and resolution.
    it("rejects both creation and resolution once the community is ARCHIVED", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community US3 Three",
        "transaction-test-seller-us3-3@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-us3-3@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      await prisma.community.update({ where: { id: community.id }, data: { status: "ARCHIVED" } });

      const newAttempt = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      expect(newAttempt).toEqual({ ok: false, reason: "not_a_member" });

      const acceptAttempt = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(acceptAttempt).toEqual({ ok: false, reason: "not_a_member" });
    });

    // T020 (US3, FR-014, spec.md Story 3 Acceptance Scenario 4): stock edited down between creation and acceptance blocks acceptance.
    it("rejects acceptance once the seller has edited stock below the proposal's quantity", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community US3 Four",
        "transaction-test-seller-us3-4@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-us3-4@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 4,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      await updateListing({ listingId: listing.id, callerAccountId: seller.id, stockQuantity: 3 });

      const accepted = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(accepted).toEqual({ ok: false, reason: "exceeds_stock" });

      const stillPending = await prisma.transaction.findUniqueOrThrow({ where: { id: proposed.transaction.id } });
      expect(stillPending.state).toBe("PENDING");
    });

    // T022 (US3, FR-028, research.md #9): the full propose-to-delete flow through the real service functions.
    it("cancels a PENDING proposal but leaves an ACCEPTED transaction untouched when the listing is deleted", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community US3 Five",
        "transaction-test-seller-us3-5@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-us3-5@example.com");
      const pendingListing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });
      const acceptedListing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const pending = await proposePurchase({
        communityId: community.id,
        listingId: pendingListing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!pending.ok) throw new Error("expected success");

      const toAccept = await proposePurchase({
        communityId: community.id,
        listingId: acceptedListing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!toAccept.ok) throw new Error("expected success");
      const accepted = await acceptProposal({
        communityId: community.id,
        transactionId: toAccept.transaction.id,
        callerAccountId: seller.id,
      });
      if (!accepted.ok) throw new Error("expected success");

      const deletePending = await deleteListing({ listingId: pendingListing.id, callerAccountId: seller.id });
      expect(deletePending).toEqual({ ok: true });
      const cancelled = await prisma.transaction.findUniqueOrThrow({ where: { id: pending.transaction.id } });
      expect(cancelled.state).toBe("CANCELLED");

      const deleteAccepted = await deleteListing({ listingId: acceptedListing.id, callerAccountId: seller.id });
      expect(deleteAccepted).toEqual({ ok: true });
      const stillAccepted = await prisma.transaction.findUniqueOrThrow({ where: { id: accepted.transaction.id } });
      expect(stillAccepted.state).toBe("ACCEPTED");

      const buyerHistory = await listTransactions(community.id, buyer.id, { state: "ACCEPTED" });
      expect(buyerHistory.ok).toBe(true);
      if (!buyerHistory.ok) throw new Error("expected success");
      expect(buyerHistory.transactions.map((t) => t.id)).toContain(accepted.transaction.id);
    });
  });

  describe("cancelProposal", () => {
    // T023 (US4, FR-018)
    it("cancels a PENDING proposal, leaving stock unchanged and no history record", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Cancel One",
        "transaction-test-seller-cancel-1@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-cancel-1@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 2,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      const cancelled = await cancelProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) throw new Error("expected success");
      expect(cancelled.transaction.state).toBe("CANCELLED");
      expect(cancelled.transaction.resolvedAt).not.toBeNull();

      const stillListed = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(stillListed.stockQuantity).toBe(10);
    });

    // T023 (US4, FR-013 analog): only the buyer may cancel.
    it("rejects a non-buyer (including the seller) attempting to cancel", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Cancel Two",
        "transaction-test-seller-cancel-2@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-cancel-2@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      const bySeller = await cancelProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(bySeller).toEqual({ ok: false, reason: "not_a_buyer" });
    });

    // T023 (US4, FR-019): only a PENDING proposal can be cancelled.
    it("rejects cancelling a proposal that is not currently PENDING", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Cancel Three",
        "transaction-test-seller-cancel-3@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-cancel-3@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      const accepted = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      expect(accepted.ok).toBe(true);

      const cancelAfterAccept = await cancelProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(cancelAfterAccept).toEqual({ ok: false, reason: "not_pending" });
    });

    // T023 (US4, FR-020): the buyer sees every proposal's state, not only PENDING ones.
    it("returns proposals in every state via listTransactions, not just PENDING", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community Cancel Four",
        "transaction-test-seller-cancel-4@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-cancel-4@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const pending = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      const toCancel = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!pending.ok || !toCancel.ok) throw new Error("expected both to succeed");
      await cancelProposal({ communityId: community.id, transactionId: toCancel.transaction.id, callerAccountId: buyer.id });

      const listed = await listTransactions(community.id, buyer.id);
      expect(listed.ok).toBe(true);
      if (!listed.ok) throw new Error("expected success");
      const states = listed.transactions.map((t) => t.state).sort();
      expect(states).toEqual(["CANCELLED", "PENDING"]);
    });
  });

  describe("dual history and no contact exposure (US5)", () => {
    // T028 (US5, FR-025, spec.md Key Entities: one record, two owner-scoped views)
    it("returns the same ACCEPTED row to both parties via the ?state=ACCEPTED filter, labeled buyer/seller respectively", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community History One",
        "transaction-test-seller-history-1@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-history-1@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");
      const accepted = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      if (!accepted.ok) throw new Error("expected success");
      // A second, still-PENDING proposal must not leak into the ACCEPTED-filtered view.
      await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });

      const purchaseHistory = await listTransactions(community.id, buyer.id, { state: "ACCEPTED" });
      expect(purchaseHistory.ok).toBe(true);
      if (!purchaseHistory.ok) throw new Error("expected success");
      expect(purchaseHistory.transactions).toHaveLength(1);
      expect(purchaseHistory.transactions[0]).toMatchObject({ id: accepted.transaction.id, role: "buyer" });

      const salesHistory = await listTransactions(community.id, seller.id, { state: "ACCEPTED" });
      expect(salesHistory.ok).toBe(true);
      if (!salesHistory.ok) throw new Error("expected success");
      expect(salesHistory.transactions).toHaveLength(1);
      expect(salesHistory.transactions[0]).toMatchObject({ id: accepted.transaction.id, role: "seller" });
    });

    // T028 (US5, FR-025): only the two parties may view a transaction.
    it("rejects getTransaction and listTransactions for any account that is neither buyer nor seller", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community History Two",
        "transaction-test-seller-history-2@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-history-2@example.com");
      const outsider = await addMember(community.id, "transaction-test-outsider-history-2@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");

      const byOutsider = await getTransaction({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: outsider.id,
      });
      expect(byOutsider).toEqual({ ok: false, reason: "not_a_party" });

      const listedByOutsider = await listTransactions(community.id, outsider.id);
      expect(listedByOutsider).toEqual({ ok: true, transactions: [] });
    });

    // T028 (FR-026, SC-005): consolidated no-contact-data assertion across the whole propose/accept/reject/cancel/list/detail surface.
    it("never exposes an email, phone, or address field across propose/accept/reject/cancel/get/list", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community History Three",
        "transaction-test-seller-history-3@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-history-3@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");
      const accepted = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      const detail = await getTransaction({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: buyer.id,
      });
      const listed = await listTransactions(community.id, buyer.id);

      const noContactFields = (value: unknown) => {
        expect(JSON.stringify(value)).not.toMatch(/@example\.com/);
        if (value && typeof value === "object") {
          expect(Object.keys(value).some((k) => /email|phone|address/i.test(k))).toBe(false);
        }
      };
      noContactFields(proposed.transaction);
      noContactFields(accepted);
      noContactFields(detail);
      noContactFields(listed);
    });
  });

  describe("listMyTransactions (Transactions nav item, cross-community)", () => {
    // The single global list backing the "Buying"/"Selling" views: every transaction the
    // caller is a party to, across every community, newest first, correctly labeled per row.
    it("returns transactions from every community the caller participates in, newest first, labeled buyer/seller", async () => {
      const { community: communityOne, admin: sellerOne } = await createCommunityWithAdmin(
        "Transaction Test Community MyTx One",
        "transaction-test-mytx-seller-1@example.com",
      );
      const buyer = await addMember(communityOne.id, "transaction-test-mytx-buyer@example.com");
      const listingOne = await createForSaleListing(communityOne.id, sellerOne.id, { stockQuantity: 10 });

      const { community: communityTwo, admin: sellerTwo } = await createCommunityWithAdmin(
        "Transaction Test Community MyTx Two",
        "transaction-test-mytx-seller-2@example.com",
      );
      await prisma.membership.create({ data: { accountId: buyer.id, communityId: communityTwo.id, role: "MEMBER" } });
      const listingTwo = await createForSaleListing(communityTwo.id, sellerTwo.id, { stockQuantity: 10 });

      const asBuyerInOne = await proposePurchase({
        communityId: communityOne.id,
        listingId: listingOne.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      const asBuyerInTwo = await proposePurchase({
        communityId: communityTwo.id,
        listingId: listingTwo.id,
        buyerAccountId: buyer.id,
        quantity: 2,
        totalCents: 40000,
      });
      if (!asBuyerInOne.ok || !asBuyerInTwo.ok) throw new Error("expected both proposals to succeed");

      const buyerView = await listMyTransactions(buyer.id);
      expect(buyerView.transactions.map((t) => t.id).sort()).toEqual(
        [asBuyerInOne.transaction.id, asBuyerInTwo.transaction.id].sort(),
      );
      expect(buyerView.transactions.every((t) => t.role === "buyer")).toBe(true);
      // newest first
      expect(buyerView.transactions[0].id).toBe(asBuyerInTwo.transaction.id);

      const sellerOneView = await listMyTransactions(sellerOne.id);
      expect(sellerOneView.transactions).toHaveLength(1);
      expect(sellerOneView.transactions[0]).toMatchObject({ id: asBuyerInOne.transaction.id, role: "seller" });
    });

    // The list's one new bit of state beyond getTransaction()/getMyReview(): whether the
    // caller has already rated this ACCEPTED transaction, resolved via a single batched query.
    it("reports myRating null until the caller rates an ACCEPTED transaction, then reflects it", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community MyTx Rating",
        "transaction-test-mytx-rating-seller@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-mytx-rating-buyer@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      const proposed = await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });
      if (!proposed.ok) throw new Error("expected success");
      const accepted = await acceptProposal({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        callerAccountId: seller.id,
      });
      if (!accepted.ok) throw new Error("expected success");

      const beforeRating = await listMyTransactions(buyer.id);
      expect(beforeRating.transactions.find((t) => t.id === proposed.transaction.id)?.myRating).toBeNull();

      const review = await createReview({
        communityId: community.id,
        transactionId: proposed.transaction.id,
        reviewerAccountId: buyer.id,
        rating: 4,
      });
      expect(review.ok).toBe(true);

      const afterRating = await listMyTransactions(buyer.id);
      expect(afterRating.transactions.find((t) => t.id === proposed.transaction.id)?.myRating).toBe(4);

      // The seller's own view of the same transaction is unaffected by the buyer's rating of them.
      const sellerView = await listMyTransactions(seller.id);
      expect(sellerView.transactions.find((t) => t.id === proposed.transaction.id)?.myRating).toBeNull();
    });

    // FR-026, SC-005 analog: the cross-community view carries no contact fields either.
    it("never exposes an email, phone, or address field via listMyTransactions", async () => {
      const { community, admin: seller } = await createCommunityWithAdmin(
        "Transaction Test Community MyTx Contact",
        "transaction-test-mytx-contact-seller@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-mytx-contact-buyer@example.com");
      const listing = await createForSaleListing(community.id, seller.id, { stockQuantity: 10 });

      await proposePurchase({
        communityId: community.id,
        listingId: listing.id,
        buyerAccountId: buyer.id,
        quantity: 1,
        totalCents: 25000,
      });

      const listed = await listMyTransactions(buyer.id);
      expect(JSON.stringify(listed)).not.toMatch(/@example\.com/);
      expect(listed.transactions.some((t) => Object.keys(t).some((k) => /email|phone|address/i.test(k)))).toBe(
        false,
      );
    });
  });
});
