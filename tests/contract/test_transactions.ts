import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { createListing, deleteListing } from "@/server/services/listingService";
import { sendMessageToListingOwner } from "@/server/services/messageService";
import {
  recordTransaction,
  confirmTransaction,
  getTransaction,
  listTransactions,
} from "@/server/services/transactionService";

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

/** Creates a listing owned by `ownerId` and an existing thread on it started by `buyerId`. */
async function createListingWithThread(communityId: string, ownerId: string, buyerId: string, title = "Bicycle") {
  const listing = await createListing({
    communityId,
    ownerId,
    title,
    description: "Description",
    priceCents: 25000,
  });
  if (!listing.ok) throw new Error("expected listing creation to succeed");
  const thread = await sendMessageToListingOwner({
    communityId,
    listingId: listing.listing.id,
    buyerAccountId: buyerId,
    body: "Is this still available?",
  });
  if (!thread.ok) throw new Error("expected thread creation to succeed");
  return { listing: listing.listing, threadId: thread.thread.id };
}

describe("transactionService (contract)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "Transaction Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "transaction-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("recordTransaction", () => {
    // T002 (US1, FR-001, FR-004, FR-008, FR-009)
    it("creates an UNCONFIRMED log naming the other thread participant as counterpart, when the owner records it", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community One",
        "transaction-test-owner-1@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-1@example.com");
      const { listing, threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const result = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.transaction.confirmationState).toBe("UNCONFIRMED");
      expect(result.transaction.paymentPath).toBe("OFF_PLATFORM");
      expect(result.transaction.listingId).toBe(listing.id);
      expect(result.transaction.listingTitle).toBe(listing.title);

      const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: result.transaction.id } });
      expect(stored.communityId).toBe(community.id);
      expect(stored.recorderId).toBe(owner.id);
      expect(stored.counterpartId).toBe(buyer.id);
    });

    // T002 (US1, FR-001 — both directions)
    it("creates a log naming the owner as counterpart, when the buyer records it", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Two",
        "transaction-test-owner-2@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-2@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const result = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: buyer.id });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: result.transaction.id } });
      expect(stored.recorderId).toBe(buyer.id);
      expect(stored.counterpartId).toBe(owner.id);
    });

    // T002 (US1, FR-001, FR-013): the derived counterpart can never equal the recorder, in either direction.
    it("never derives a counterpart equal to the recorder, regardless of who records it", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Self",
        "transaction-test-owner-self@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-self@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const asOwner = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      const asBuyer = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: buyer.id });
      expect(asOwner.ok).toBe(true);
      expect(asBuyer.ok).toBe(true);
      if (!asOwner.ok || !asBuyer.ok) throw new Error("expected both to succeed");

      const rows = await prisma.transaction.findMany({ where: { id: { in: [asOwner.transaction.id, asBuyer.transaction.id] } } });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.recorderId).not.toBe(row.counterpartId);
      }
    });

    // T002 (US1, FR-001): a third account with no thread on the listing cannot record against it.
    it("rejects a caller who is neither the thread's buyer nor its listing's owner", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Three",
        "transaction-test-owner-3@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-3@example.com");
      const outsider = await addMember(community.id, "transaction-test-outsider-3@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const result = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: outsider.id });
      expect(result).toEqual({ ok: false, reason: "not_a_participant" });
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T002 (US1, FR-001): a nonexistent threadId is rejected.
    it("rejects a nonexistent threadId", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Four",
        "transaction-test-owner-4@example.com",
      );
      const result = await recordTransaction({
        communityId: community.id,
        threadId: "nonexistent-thread-id",
        recorderAccountId: owner.id,
      });
      expect(result).toEqual({ ok: false, reason: "not_found" });
    });

    // T002 (US1, research.md #4): community must be ACTIVE to create a new log.
    it("rejects creation when the community is SUSPENDED, even for two current members with an existing thread", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Five",
        "transaction-test-owner-5@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-5@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      await prisma.community.update({ where: { id: community.id }, data: { status: "SUSPENDED" } });

      const result = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      expect(result).toEqual({ ok: false, reason: "community_not_active" });
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T002 (US1, FR-002): both the recorder and the derived counterpart must currently hold membership.
    it("rejects creation when the derived counterpart has lost membership", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Six",
        "transaction-test-owner-6@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-6@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      await prisma.membership.delete({
        where: { accountId_communityId: { accountId: buyer.id, communityId: community.id } },
      });

      const result = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      expect(result).toEqual({ ok: false, reason: "counterpart_not_a_member" });
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T002 (US1, FR-002): the recorder themself must currently hold membership.
    it("rejects creation when the recorder has lost membership", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Seven",
        "transaction-test-owner-7@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-7@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      await prisma.membership.delete({
        where: { accountId_communityId: { accountId: buyer.id, communityId: community.id } },
      });

      const result = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: buyer.id });
      expect(result).toEqual({ ok: false, reason: "not_a_member" });
    });

    // T002 (Edge Cases): repeat transactions on the same thread are allowed — no dedup, no limit.
    it("allows a second, independent transaction to be recorded on the same thread", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Eight",
        "transaction-test-owner-8@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-8@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const first = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      const second = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("expected both to succeed");
      expect(second.transaction.id).not.toBe(first.transaction.id);
      expect(await prisma.transaction.count({ where: { communityId: community.id } })).toBe(2);
    });

    // T002 (FR-010): no amount field exists to accept or persist.
    it("never persists an amount — recordTransaction accepts no such field", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Amount",
        "transaction-test-owner-amount@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-amount@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      // Only communityId/threadId/recorderAccountId are accepted; an extra field on the input
      // object (as TypeScript would reject at compile time) has no runtime column to land in.
      const result = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: result.transaction.id } });
      expect(Object.keys(stored)).not.toContain("amount");
      expect(Object.keys(stored)).not.toContain("priceCents");
    });

    // T002 (FR-012): recording a transaction never changes the listing's status.
    it("leaves the listing's status unchanged after recording a transaction", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Status",
        "transaction-test-owner-status@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-status@example.com");
      const { listing, threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const result = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      expect(result.ok).toBe(true);

      const stillListed = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(stillListed.status).toBe("ACTIVE");
    });
  });

  describe("getTransaction / listTransactions (FR-016)", () => {
    // T002 (US1, FR-016)
    it("is visible to both the recorder and the counterpart, and denied to a third party", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Nine",
        "transaction-test-owner-9@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-9@example.com");
      const outsider = await addMember(community.id, "transaction-test-outsider-9@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");

      const byRecorder = await getTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: owner.id,
      });
      expect(byRecorder.ok).toBe(true);
      if (!byRecorder.ok) throw new Error("expected success");
      expect(byRecorder.transaction.role).toBe("recorder");

      const byCounterpart = await getTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(byCounterpart.ok).toBe(true);
      if (!byCounterpart.ok) throw new Error("expected success");
      expect(byCounterpart.transaction.role).toBe("counterpart");

      const byOutsider = await getTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: outsider.id,
      });
      expect(byOutsider).toEqual({ ok: false, reason: "not_a_party" });

      const listedByRecorder = await listTransactions(community.id, owner.id);
      expect(listedByRecorder.ok).toBe(true);
      if (!listedByRecorder.ok) throw new Error("expected success");
      expect(listedByRecorder.transactions.map((t) => t.id)).toEqual([created.transaction.id]);

      const listedByOutsider = await listTransactions(community.id, outsider.id);
      expect(listedByOutsider).toEqual({ ok: true, transactions: [] });
    });

    // T002 (US1, FR-017): a log survives its listing's deletion, unaltered.
    it("survives listing deletion with its listingTitle snapshot intact", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Ten",
        "transaction-test-owner-10@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-10@example.com");
      const { listing, threadId } = await createListingWithThread(community.id, owner.id, buyer.id, "Vintage Lamp");

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");

      const deleted = await deleteListing({ listingId: listing.id, callerAccountId: owner.id });
      expect(deleted).toEqual({ ok: true });

      const afterDeletion = await getTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(afterDeletion.ok).toBe(true);
      if (!afterDeletion.ok) throw new Error("expected success");
      expect(afterDeletion.transaction.listingTitle).toBe("Vintage Lamp");

      const listed = await listTransactions(community.id, buyer.id);
      expect(listed.ok).toBe(true);
      if (!listed.ok) throw new Error("expected success");
      expect(listed.transactions).toHaveLength(1);
    });

    // T002 (FR-015, SC-005): no response anywhere carries contact data.
    it("never returns an email, phone, or address field from recordTransaction, getTransaction, or listTransactions", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Contact",
        "transaction-test-owner-contact@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-contact@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");
      expect(Object.keys(created.transaction).some((k) => /email|phone|address/i.test(k))).toBe(false);

      const fetched = await getTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: buyer.id,
      });
      if (!fetched.ok) throw new Error("expected success");
      expect(Object.keys(fetched.transaction).some((k) => /email|phone|address/i.test(k))).toBe(false);
      expect(JSON.stringify(fetched.transaction)).not.toMatch(/@example\.com/);

      const listed = await listTransactions(community.id, owner.id);
      if (!listed.ok) throw new Error("expected success");
      for (const row of listed.transactions) {
        expect(Object.keys(row).some((k) => /email|phone|address/i.test(k))).toBe(false);
      }
      expect(JSON.stringify(listed.transactions)).not.toMatch(/@example\.com/);
    });
  });

  describe("confirmTransaction", () => {
    // T010 (US2, FR-005)
    it("transitions an UNCONFIRMED log to CONFIRMED, setting confirmedAt, only for the named counterpart", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Eleven",
        "transaction-test-owner-11@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-11@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");

      const confirmed = await confirmTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(confirmed.ok).toBe(true);
      if (!confirmed.ok) throw new Error("expected success");
      expect(confirmed.transaction.confirmationState).toBe("CONFIRMED");
      expect(confirmed.transaction.confirmedAt).not.toBeNull();
    });

    // T010 (US2, FR-005): the recorder cannot confirm their own log.
    it("rejects the recorder attempting to confirm their own log", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Twelve",
        "transaction-test-owner-12@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-12@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");

      const result = await confirmTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: owner.id,
      });
      expect(result).toEqual({ ok: false, reason: "not_a_counterpart" });
      const stillUnconfirmed = await prisma.transaction.findUniqueOrThrow({ where: { id: created.transaction.id } });
      expect(stillUnconfirmed.confirmationState).toBe("UNCONFIRMED");
    });

    // T010 (US2, FR-005): any third account is rejected.
    it("rejects a third account attempting to confirm", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Thirteen",
        "transaction-test-owner-13@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-13@example.com");
      const outsider = await addMember(community.id, "transaction-test-outsider-13@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");

      const result = await confirmTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: outsider.id,
      });
      expect(result).toEqual({ ok: false, reason: "not_a_counterpart" });
    });

    // T010 (data-model.md gate 4): re-confirming an already-CONFIRMED log is an idempotent no-op.
    it("is idempotent — confirming an already-CONFIRMED log returns the same state without a second confirmedAt write", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Fourteen",
        "transaction-test-owner-14@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-14@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");

      const first = await confirmTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: buyer.id,
      });
      if (!first.ok) throw new Error("expected success");

      const second = await confirmTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error("expected success");
      expect(second.transaction.confirmationState).toBe("CONFIRMED");
      expect(second.transaction.confirmedAt?.getTime()).toBe(first.transaction.confirmedAt?.getTime());
    });

    // T010 (FR-007): no exported function can modify any core field of a Transaction, confirmed or not.
    it("exposes no function capable of editing a transaction's core fields", async () => {
      const transactionServiceModule = await import("@/server/services/transactionService");
      const exportedNames = Object.keys(transactionServiceModule);
      const editLike = exportedNames.filter((name) => /update|edit|patch|delete/i.test(name));
      expect(editLike).toEqual([]);
    });

    // T010 (FR-012): confirming a transaction never changes the listing's status.
    it("leaves the listing's status unchanged after confirming a transaction", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Confirm Status",
        "transaction-test-owner-confirmstatus@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-confirmstatus@example.com");
      const { listing, threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");
      const confirmed = await confirmTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(confirmed.ok).toBe(true);

      const stillListed = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(stillListed.status).toBe("ACTIVE");
    });
  });

  // T015 (US3, FR-002, FR-003, research.md #4)
  describe("cross-community and non-member rejection (US3)", () => {
    it("rejects confirmation once the counterpart's membership has lapsed, leaving the log unconfirmed and unaltered", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Fifteen",
        "transaction-test-owner-15@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-15@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");

      await prisma.membership.delete({
        where: { accountId_communityId: { accountId: buyer.id, communityId: community.id } },
      });

      const result = await confirmTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(result).toEqual({ ok: false, reason: "not_a_member" });

      const stillUnconfirmed = await prisma.transaction.findUniqueOrThrow({ where: { id: created.transaction.id } });
      expect(stillUnconfirmed.confirmationState).toBe("UNCONFIRMED");
      expect(stillUnconfirmed.recorderId).toBe(owner.id);
      expect(stillUnconfirmed.counterpartId).toBe(buyer.id);
    });

    it("allows confirmation of a pre-existing log while the community is SUSPENDED (research.md #4)", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Sixteen",
        "transaction-test-owner-16@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-16@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");

      await prisma.community.update({ where: { id: community.id }, data: { status: "SUSPENDED" } });

      const result = await confirmTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.transaction.confirmationState).toBe("CONFIRMED");
    });

    it("rejects both creation and confirmation once the community is ARCHIVED", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Transaction Test Community Seventeen",
        "transaction-test-owner-17@example.com",
      );
      const buyer = await addMember(community.id, "transaction-test-buyer-17@example.com");
      const { threadId } = await createListingWithThread(community.id, owner.id, buyer.id);

      const created = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: owner.id });
      if (!created.ok) throw new Error("expected success");

      await prisma.community.update({ where: { id: community.id }, data: { status: "ARCHIVED" } });

      const secondAttempt = await recordTransaction({ communityId: community.id, threadId, recorderAccountId: buyer.id });
      expect(secondAttempt).toEqual({ ok: false, reason: "not_a_member" });

      const confirmAttempt = await confirmTransaction({
        communityId: community.id,
        transactionId: created.transaction.id,
        callerAccountId: buyer.id,
      });
      expect(confirmAttempt).toEqual({ ok: false, reason: "not_a_member" });
    });
  });
});
