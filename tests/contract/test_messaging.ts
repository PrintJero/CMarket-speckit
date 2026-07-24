import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { createListing, pauseListing, deleteListing } from "@/server/services/listingService";
import { setDisplayName } from "@/server/services/accountService";
import {
  sendMessageToListingOwner,
  sendThreadMessage,
  getThread,
  listThreads,
  listMyThreads,
} from "@/server/services/messageService";

/** Mirrors tests/contract/test_listings.ts's own helper (006-user-display-names, FR-008). */
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

async function addAdmin(communityId: string, email: string) {
  const account = await createVerifiedAccount(email);
  await prisma.membership.create({ data: { accountId: account.id, communityId, role: "ADMINISTRATOR" } });
  return account;
}

describe("messageService (contract)", () => {
  beforeEach(async () => {
    // Community deletion cascades to Membership/Invitation/Listing/MessageThread/Message (schema.prisma).
    await prisma.community.deleteMany({ where: { name: { contains: "Messaging Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "messaging-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("sendMessageToListingOwner", () => {
    // T002 (US1, FR-001)
    it("creates a thread and its first message on a buyer's first message to the owner", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community One",
        "messaging-test-admin-1@example.com",
      );
      const buyer = await addMember(community.id, "messaging-test-buyer-1@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Bicycle",
        description: "Barely used road bike",
        priceCents: 25000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const result = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "Is this still available?",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.message.body).toBe("Is this still available?");

      const thread = await prisma.messageThread.findUnique({
        where: { listingId_buyerId: { listingId: listing.listing.id, buyerId: buyer.id } },
      });
      expect(thread).not.toBeNull();
      expect(thread!.id).toBe(result.thread.id);
      expect(await prisma.message.count({ where: { threadId: result.thread.id } })).toBe(1);
    });

    // T002 (US1, FR-002)
    it("reuses the existing thread on a second message from the same buyer — no second thread is created", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Two",
        "messaging-test-admin-2@example.com",
      );
      const buyer = await addMember(community.id, "messaging-test-buyer-2@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Chair",
        description: "Wooden chair",
        priceCents: 5000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const first = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "First message",
      });
      const second = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "Second message",
      });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) throw new Error("expected both to succeed");
      expect(second.thread.id).toBe(first.thread.id);

      expect(
        await prisma.messageThread.count({
          where: { listingId: listing.listing.id, buyerId: buyer.id },
        }),
      ).toBe(1);
      expect(await prisma.message.count({ where: { threadId: first.thread.id } })).toBe(2);
    });

    // T002 (US1, FR-013)
    it("rejects an attempt to message one's own listing, writing nothing", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Three",
        "messaging-test-admin-3@example.com",
      );
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Desk",
        description: "Standing desk",
        priceCents: 15000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const result = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: admin.id,
        body: "Hello myself",
      });

      expect(result).toEqual({ ok: false, reason: "cannot_message_own_listing" });
      expect(await prisma.messageThread.count({ where: { listingId: listing.listing.id } })).toBe(0);
    });

    // T002 (US1, FR-016, research.md #4)
    it("rejects starting a new thread on a PAUSED listing, but allows a reply in an existing thread on one paused afterward", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Four",
        "messaging-test-admin-4@example.com",
      );
      const buyer = await addMember(community.id, "messaging-test-buyer-4@example.com");
      const otherBuyer = await addMember(community.id, "messaging-test-other-buyer-4@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Lamp",
        description: "Desk lamp",
        priceCents: 2000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      // Existing thread, created while still ACTIVE.
      const existing = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "Before pause",
      });
      expect(existing.ok).toBe(true);

      const paused = await pauseListing({ listingId: listing.listing.id, callerAccountId: admin.id });
      expect(paused).toEqual({ ok: true });

      // A brand-new thread against the now-PAUSED listing is rejected.
      const newThreadAttempt = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: otherBuyer.id,
        body: "Is this still for sale?",
      });
      expect(newThreadAttempt).toEqual({ ok: false, reason: "listing_paused" });
      expect(
        await prisma.messageThread.count({
          where: { listingId: listing.listing.id, buyerId: otherBuyer.id },
        }),
      ).toBe(0);

      // The existing thread is unaffected by the pause.
      if (!existing.ok) throw new Error("expected success");
      const reply = await sendThreadMessage({
        communityId: community.id,
        threadId: existing.thread.id,
        senderAccountId: admin.id,
        body: "Still here, yes",
      });
      expect(reply.ok).toBe(true);
    });

    // T002 (US1, FR-012)
    it("rejects an empty, whitespace-only, or over-2000-character message, writing nothing", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Five",
        "messaging-test-admin-5@example.com",
      );
      const buyer = await addMember(community.id, "messaging-test-buyer-5@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Sofa",
        description: "Grey sofa",
        priceCents: 30000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const empty = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "",
      });
      expect(empty).toEqual({ ok: false, reason: "invalid_message" });

      const whitespace = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "   \n\t  ",
      });
      expect(whitespace).toEqual({ ok: false, reason: "invalid_message" });

      const tooLong = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "a".repeat(2001),
      });
      expect(tooLong).toEqual({ ok: false, reason: "invalid_message" });

      expect(await prisma.messageThread.count({ where: { listingId: listing.listing.id } })).toBe(0);

      // A message at exactly the limit succeeds, and a reply obeys the same rule.
      const atLimit = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "a".repeat(2000),
      });
      expect(atLimit.ok).toBe(true);
      if (!atLimit.ok) throw new Error("expected success");

      const replyTooLong = await sendThreadMessage({
        communityId: community.id,
        threadId: atLimit.thread.id,
        senderAccountId: admin.id,
        body: "b".repeat(2001),
      });
      expect(replyTooLong).toEqual({ ok: false, reason: "invalid_message" });
      expect(await prisma.message.count({ where: { threadId: atLimit.thread.id } })).toBe(1);
    });

    // T002 (US1, FR-008)
    it("rejects a caller with no membership in the listing's community", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Six",
        "messaging-test-admin-6@example.com",
      );
      const outsider = await createVerifiedAccount("messaging-test-outsider-6@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Guitar",
        description: "Acoustic",
        priceCents: 40000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const result = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: outsider.id,
        body: "Hello",
      });

      expect(result).toEqual({ ok: false, reason: "not_a_member" });
      expect(await prisma.messageThread.count({ where: { listingId: listing.listing.id } })).toBe(0);
    });
  });

  describe("sendThreadMessage / getThread", () => {
    // T002 (US1, FR-003, FR-004)
    it("lets the owner reply, and both participants see the full ordered history", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Seven",
        "messaging-test-admin-7@example.com",
      );
      const buyer = await addMember(community.id, "messaging-test-buyer-7@example.com");
      await setDisplayName(admin.id, "Owner Name");
      await setDisplayName(buyer.id, "Buyer Name");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Bike helmet",
        description: "Medium size",
        priceCents: 1500,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const first = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "Is this still available?",
      });
      if (!first.ok) throw new Error("expected success");

      const reply = await sendThreadMessage({
        communityId: community.id,
        threadId: first.thread.id,
        senderAccountId: admin.id,
        body: "Yes, still available.",
      });
      expect(reply.ok).toBe(true);

      const asBuyer = await getThread({
        communityId: community.id,
        threadId: first.thread.id,
        callerAccountId: buyer.id,
      });
      expect(asBuyer.ok).toBe(true);
      if (!asBuyer.ok) throw new Error("expected success");
      expect(asBuyer.messages.map((m) => ({ body: m.body, senderDisplayName: m.senderDisplayName }))).toEqual([
        { body: "Is this still available?", senderDisplayName: "Buyer Name" },
        { body: "Yes, still available.", senderDisplayName: "Owner Name" },
      ]);

      const asOwner = await getThread({
        communityId: community.id,
        threadId: first.thread.id,
        callerAccountId: admin.id,
      });
      expect(asOwner.ok).toBe(true);
      if (!asOwner.ok) throw new Error("expected success");
      expect(asOwner.messages).toHaveLength(2);
    });

    // T002 (US1, FR-015)
    it("removes a thread and its messages when the listing is deleted", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Eight",
        "messaging-test-admin-8@example.com",
      );
      const buyer = await addMember(community.id, "messaging-test-buyer-8@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Table",
        description: "Small table",
        priceCents: 3000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const sent = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "Interested",
      });
      if (!sent.ok) throw new Error("expected success");

      const deleted = await deleteListing({ listingId: listing.listing.id, callerAccountId: admin.id });
      expect(deleted).toEqual({ ok: true });

      expect(await prisma.messageThread.findUnique({ where: { id: sent.thread.id } })).toBeNull();
      expect(await prisma.message.count({ where: { threadId: sent.thread.id } })).toBe(0);
    });
  });

  describe("listThreads", () => {
    // T010 (US2, FR-005, FR-006)
    it("shows the owner every thread on their listing, and each buyer only their own", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Nine",
        "messaging-test-admin-9@example.com",
      );
      const buyerOne = await addMember(community.id, "messaging-test-buyer-one-9@example.com");
      const buyerTwo = await addMember(community.id, "messaging-test-buyer-two-9@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Skateboard",
        description: "Description",
        priceCents: 4000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const threadOne = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyerOne.id,
        body: "From buyer one",
      });
      const threadTwo = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyerTwo.id,
        body: "From buyer two",
      });
      if (!threadOne.ok || !threadTwo.ok) throw new Error("expected both threads to be created");

      const ownerThreads = await listThreads(community.id, admin.id);
      expect(ownerThreads.ok).toBe(true);
      if (!ownerThreads.ok) throw new Error("expected success");
      expect(new Set(ownerThreads.threads.map((t) => t.id))).toEqual(
        new Set([threadOne.thread.id, threadTwo.thread.id]),
      );

      const buyerOneThreads = await listThreads(community.id, buyerOne.id);
      expect(buyerOneThreads.ok).toBe(true);
      if (!buyerOneThreads.ok) throw new Error("expected success");
      expect(buyerOneThreads.threads.map((t) => t.id)).toEqual([threadOne.thread.id]);

      const buyerTwoThreads = await listThreads(community.id, buyerTwo.id);
      expect(buyerTwoThreads.ok).toBe(true);
      if (!buyerTwoThreads.ok) throw new Error("expected success");
      expect(buyerTwoThreads.threads.map((t) => t.id)).toEqual([threadTwo.thread.id]);
    });

    // T010 (US2, FR-007, Clarifications)
    it("rejects getThread for a non-participant, including that community's own administrator", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Ten",
        "messaging-test-admin-10@example.com",
      );
      const buyer = await addMember(community.id, "messaging-test-buyer-10@example.com");
      const otherAdmin = await addAdmin(community.id, "messaging-test-other-admin-10@example.com");
      const outsiderMember = await addMember(community.id, "messaging-test-outsider-member-10@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Camera",
        description: "Description",
        priceCents: 8000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const thread = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "Interested",
      });
      if (!thread.ok) throw new Error("expected success");

      const byOtherAdmin = await getThread({
        communityId: community.id,
        threadId: thread.thread.id,
        callerAccountId: otherAdmin.id,
      });
      expect(byOtherAdmin).toEqual({ ok: false, reason: "not_a_participant" });

      const byOutsiderMember = await getThread({
        communityId: community.id,
        threadId: thread.thread.id,
        callerAccountId: outsiderMember.id,
      });
      expect(byOutsiderMember).toEqual({ ok: false, reason: "not_a_participant" });

      // The administrator's own listThreads() never surfaces a thread they aren't party to.
      const otherAdminThreads = await listThreads(community.id, otherAdmin.id);
      expect(otherAdminThreads).toEqual({ ok: true, threads: [] });
    });
  });

  describe("display-name gate (US3, FR-010)", () => {
    // T015
    it("blocks a nameless account's first message and a nameless reply, writing nothing, until a display name is set", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Eleven",
        "messaging-test-admin-11@example.com",
      );
      const nameless = await addMember(community.id, "messaging-test-nameless-11@example.com");
      await prisma.account.update({ where: { id: nameless.id }, data: { displayName: null } });
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Keyboard",
        description: "Description",
        priceCents: 6000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const rejected = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: nameless.id,
        body: "Interested",
      });
      expect(rejected).toEqual({ ok: false, reason: "display_name_required" });
      expect(await prisma.messageThread.count({ where: { listingId: listing.listing.id } })).toBe(0);

      await setDisplayName(nameless.id, "Now Named");
      const accepted = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: nameless.id,
        body: "Interested",
      });
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) throw new Error("expected success");

      // A nameless owner reply is blocked the same way; an already-named account is never blocked.
      await prisma.account.update({ where: { id: admin.id }, data: { displayName: null } });
      const namelessReply = await sendThreadMessage({
        communityId: community.id,
        threadId: accepted.thread.id,
        senderAccountId: admin.id,
        body: "Reply attempt",
      });
      expect(namelessReply).toEqual({ ok: false, reason: "display_name_required" });
      expect(await prisma.message.count({ where: { threadId: accepted.thread.id } })).toBe(1);

      await setDisplayName(admin.id, "Owner Named");
      const namedReply = await sendThreadMessage({
        communityId: community.id,
        threadId: accepted.thread.id,
        senderAccountId: admin.id,
        body: "Reply attempt",
      });
      expect(namedReply.ok).toBe(true);

      const secondMessage = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: nameless.id,
        body: "Second message, not prompted again",
      });
      expect(secondMessage.ok).toBe(true);
    });
  });

  describe("membership-loss revocation (US4, FR-009)", () => {
    // T020
    it("denies the departed buyer view/send access immediately, while the still-current owner is unaffected", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Twelve",
        "messaging-test-admin-12@example.com",
      );
      const buyer = await addMember(community.id, "messaging-test-buyer-12@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Monitor",
        description: "Description",
        priceCents: 12000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const thread = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "Interested",
      });
      if (!thread.ok) throw new Error("expected success");

      // The buyer's membership lapses.
      await prisma.membership.delete({
        where: { accountId_communityId: { accountId: buyer.id, communityId: community.id } },
      });

      const deniedView = await getThread({
        communityId: community.id,
        threadId: thread.thread.id,
        callerAccountId: buyer.id,
      });
      expect(deniedView).toEqual({ ok: false, reason: "not_a_member" });

      const deniedSend = await sendThreadMessage({
        communityId: community.id,
        threadId: thread.thread.id,
        senderAccountId: buyer.id,
        body: "Still there?",
      });
      expect(deniedSend).toEqual({ ok: false, reason: "not_a_member" });

      // The still-current-member owner is fully unaffected.
      const ownerView = await getThread({
        communityId: community.id,
        threadId: thread.thread.id,
        callerAccountId: admin.id,
      });
      expect(ownerView.ok).toBe(true);
      if (!ownerView.ok) throw new Error("expected success");
      expect(ownerView.messages).toHaveLength(1);
    });
  });

  describe("lastMessageAt ordering (2026-07-17 amendment, FR-020)", () => {
    // T026
    it("orders listThreads() by lastMessageAt at the database level, re-sorting on a new message", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Thirteen",
        "messaging-test-admin-13@example.com",
      );
      const buyerOne = await addMember(community.id, "messaging-test-buyer-one-13@example.com");
      const buyerTwo = await addMember(community.id, "messaging-test-buyer-two-13@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Drone",
        description: "Description",
        priceCents: 20000,
      });
      if (!listing.ok) throw new Error("expected listing creation to succeed");

      const older = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyerOne.id,
        body: "First thread",
      });
      const newer = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyerTwo.id,
        body: "Second thread",
      });
      if (!older.ok || !newer.ok) throw new Error("expected both to succeed");

      const initialOrder = await listThreads(community.id, admin.id);
      expect(initialOrder.ok).toBe(true);
      if (!initialOrder.ok) throw new Error("expected success");
      expect(initialOrder.threads.map((t) => t.id)).toEqual([newer.thread.id, older.thread.id]);

      // Reply in the older thread — it should now sort first.
      const reply = await sendThreadMessage({
        communityId: community.id,
        threadId: older.thread.id,
        senderAccountId: admin.id,
        body: "Bumping this one",
      });
      expect(reply.ok).toBe(true);

      const reordered = await listThreads(community.id, admin.id);
      expect(reordered.ok).toBe(true);
      if (!reordered.ok) throw new Error("expected success");
      expect(reordered.threads.map((t) => t.id)).toEqual([older.thread.id, newer.thread.id]);
    });
  });

  describe("listMyThreads (2026-07-17 amendment, FR-017-FR-020, FR-024)", () => {
    // T027
    it("aggregates threads across every current community, marks owner/buyer, orders by lastMessageAt, excludes departed communities", async () => {
      const { community: communityA } = await createCommunityWithAdmin(
        "Messaging Test Community Fourteen A",
        "messaging-test-ownera-14@example.com",
      );
      const { community: communityB, admin: ownerB } = await createCommunityWithAdmin(
        "Messaging Test Community Fourteen B",
        "messaging-test-ownerb-14@example.com",
      );
      // The shared account: owns a listing in Community A (gets contacted), and is a buyer in Community B.
      const shared = await addMember(communityA.id, "messaging-test-shared-14@example.com");

      const listingInA = await createListing({
        communityId: communityA.id,
        ownerId: shared.id,
        title: "A's item",
        description: "Description",
        priceCents: 1000,
      });
      if (!listingInA.ok) throw new Error("expected listing creation to succeed");
      const buyerInA = await addMember(communityA.id, "messaging-test-buyerina-14@example.com");
      const threadWhereOwner = await sendMessageToListingOwner({
        communityId: communityA.id,
        listingId: listingInA.listing.id,
        buyerAccountId: buyerInA.id,
        body: "Interested in A's item",
      });
      if (!threadWhereOwner.ok) throw new Error("expected success");

      // Give the shared account membership in Community B too, then have them buy there.
      await prisma.membership.create({
        data: { accountId: shared.id, communityId: communityB.id, role: "MEMBER" },
      });
      const listingInB = await createListing({
        communityId: communityB.id,
        ownerId: ownerB.id,
        title: "B's item",
        description: "Description",
        priceCents: 2000,
      });
      if (!listingInB.ok) throw new Error("expected listing creation to succeed");
      const threadWhereBuyer = await sendMessageToListingOwner({
        communityId: communityB.id,
        listingId: listingInB.listing.id,
        buyerAccountId: shared.id,
        body: "Interested in B's item",
      });
      if (!threadWhereBuyer.ok) throw new Error("expected success");

      const mine = await listMyThreads(shared.id);
      expect(mine.ok).toBe(true);
      if (!mine.ok) throw new Error("expected success");
      // Most recent first: threadWhereBuyer was created after threadWhereOwner.
      expect(mine.threads.map((t) => ({ id: t.id, role: t.role, communityId: t.communityId }))).toEqual([
        { id: threadWhereBuyer.thread.id, role: "buyer", communityId: communityB.id },
        { id: threadWhereOwner.thread.id, role: "owner", communityId: communityA.id },
      ]);

      // Losing membership in Community A removes that thread from the aggregate.
      await prisma.membership.delete({
        where: { accountId_communityId: { accountId: shared.id, communityId: communityA.id } },
      });
      const afterLeavingA = await listMyThreads(shared.id);
      expect(afterLeavingA.ok).toBe(true);
      if (!afterLeavingA.ok) throw new Error("expected success");
      expect(afterLeavingA.threads.map((t) => t.id)).toEqual([threadWhereBuyer.thread.id]);
    });

    // T027 (Edge Cases)
    it("returns an empty list for an account with no threads", async () => {
      const { community } = await createCommunityWithAdmin(
        "Messaging Test Community Fifteen",
        "messaging-test-admin-15@example.com",
      );
      const lonely = await addMember(community.id, "messaging-test-lonely-15@example.com");

      const result = await listMyThreads(lonely.id);
      expect(result).toEqual({ ok: true, threads: [] });
    });
  });

  // 009-platform-administration, User Story 8: FR-052/FR-053's exact gating table.
  describe("suspended-community gating (FR-052, FR-053)", () => {
    it("replying in an existing thread tolerates SUSPENDED, but starting a new thread is blocked", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Suspend One",
        "messaging-test-suspend-admin-1@example.com",
      );
      const buyer = await addMember(community.id, "messaging-test-suspend-buyer-1@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Listing",
        description: "d",
        priceCents: 100,
      });
      if (!listing.ok) throw new Error("setup failed");

      const firstMessage = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "Is this available?",
      });
      if (!firstMessage.ok) throw new Error("setup failed");

      await prisma.community.update({ where: { id: community.id }, data: { status: "SUSPENDED" } });

      const reply = await sendThreadMessage({
        communityId: community.id,
        threadId: firstMessage.thread.id,
        senderAccountId: admin.id,
        body: "Yes, still available.",
      });
      expect(reply.ok).toBe(true);

      const viewedThread = await getThread({
        communityId: community.id,
        threadId: firstMessage.thread.id,
        callerAccountId: buyer.id,
      });
      expect(viewedThread.ok).toBe(true);

      const otherBuyer = await addMember(community.id, "messaging-test-suspend-buyer2-1@example.com");
      const blockedNewThread = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: otherBuyer.id,
        body: "New thread while suspended",
      });
      expect(blockedNewThread).toEqual({ ok: false, reason: "community_not_active" });
    });

    it("every ordinary thread path denies access to an ARCHIVED community", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Messaging Test Community Archived One",
        "messaging-test-archived-admin-1@example.com",
      );
      const buyer = await addMember(community.id, "messaging-test-archived-buyer-1@example.com");
      const listing = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Listing",
        description: "d",
        priceCents: 100,
      });
      if (!listing.ok) throw new Error("setup failed");
      const firstMessage = await sendMessageToListingOwner({
        communityId: community.id,
        listingId: listing.listing.id,
        buyerAccountId: buyer.id,
        body: "Is this available?",
      });
      if (!firstMessage.ok) throw new Error("setup failed");

      await prisma.community.update({ where: { id: community.id }, data: { status: "ARCHIVED" } });

      expect(
        await getThread({ communityId: community.id, threadId: firstMessage.thread.id, callerAccountId: buyer.id }),
      ).toEqual({ ok: false, reason: "not_a_member" });
      expect((await listThreads(community.id, buyer.id)).ok).toBe(false);
    });
  });
});
