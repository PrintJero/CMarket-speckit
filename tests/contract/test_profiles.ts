import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { createListing } from "@/server/services/listingService";
import { sendMessageToListingOwner } from "@/server/services/messageService";
import { recordTransaction, confirmTransaction } from "@/server/services/transactionService";
import { createReview } from "@/server/services/reviewService";
import { getProfile } from "@/server/services/profileService";

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

async function createConfirmedTransaction(communityId: string, ownerId: string, buyerId: string, title = "Item") {
  const listing = await createListing({ communityId, ownerId, title, description: "Description", priceCents: 1000 });
  if (!listing.ok) throw new Error("expected listing creation to succeed");
  const thread = await sendMessageToListingOwner({
    communityId,
    listingId: listing.listing.id,
    buyerAccountId: buyerId,
    body: "Interested!",
  });
  if (!thread.ok) throw new Error("expected thread creation to succeed");
  const recorded = await recordTransaction({ communityId, threadId: thread.thread.id, recorderAccountId: ownerId });
  if (!recorded.ok) throw new Error("expected transaction creation to succeed");
  const confirmed = await confirmTransaction({
    communityId,
    transactionId: recorded.transaction.id,
    callerAccountId: buyerId,
  });
  if (!confirmed.ok) throw new Error("expected transaction confirmation to succeed");
  return confirmed.transaction;
}

describe("profileService (contract)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "Profile Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "profile-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // T003 (US1, FR-002, FR-006, FR-007)
  it("shows displayName, member-since date, active listings, and confirmed-transaction count for a co-member", async () => {
    const { community, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community One",
      "profile-test-owner-1@example.com",
    );
    const buyer = await addMember(community.id, "profile-test-buyer-1@example.com");
    await createConfirmedTransaction(community.id, owner.id, buyer.id);
    const activeListing = await createListing({
      communityId: community.id,
      ownerId: owner.id,
      title: "Second Item",
      description: "Description",
      priceCents: 2000,
    });
    if (!activeListing.ok) throw new Error("expected listing creation to succeed");

    const result = await getProfile({ communityId: community.id, accountId: owner.id, viewerAccountId: buyer.id });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.displayName).toBe("Test Account");
    expect(result.profile.memberSince).toBeInstanceOf(Date);
    expect(result.profile.confirmedTransactionCount).toBe(1);
    expect(result.profile.averageRating).toBeNull();
    expect(result.profile.reviewCount).toBe(0);
    const listingIds = result.profile.activeListings.map((listing) => listing.id);
    expect(listingIds).toContain(activeListing.listing.id);
  });

  // T003 (US1, FR-007): active listings are scoped to the community being viewed, excluding
  // another community's listing and a non-ACTIVE one.
  it("excludes listings from a different community and non-ACTIVE listings", async () => {
    const { community: communityC, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Two",
      "profile-test-owner-2@example.com",
    );
    const { community: communityD } = await createCommunityWithAdmin(
      "Profile Test Community Two D",
      "profile-test-owner-2d@example.com",
    );
    await prisma.membership.create({ data: { accountId: owner.id, communityId: communityD.id, role: "MEMBER" } });
    const buyer = await addMember(communityC.id, "profile-test-buyer-2@example.com");

    const inD = await createListing({
      communityId: communityD.id,
      ownerId: owner.id,
      title: "In Community D",
      description: "Description",
      priceCents: 1000,
    });
    if (!inD.ok) throw new Error("expected listing creation to succeed");
    const paused = await createListing({
      communityId: communityC.id,
      ownerId: owner.id,
      title: "Paused Listing",
      description: "Description",
      priceCents: 1000,
    });
    if (!paused.ok) throw new Error("expected listing creation to succeed");
    await prisma.listing.update({ where: { id: paused.listing.id }, data: { status: "PAUSED" } });

    const result = await getProfile({ communityId: communityC.id, accountId: owner.id, viewerAccountId: buyer.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.activeListings).toEqual([]);
  });

  // T003 (US1, FR-006): a viewer with no membership in communityId is rejected.
  it("rejects a viewer with no current membership in the community", async () => {
    const { community, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Three",
      "profile-test-owner-3@example.com",
    );
    const outsider = await createVerifiedAccount("profile-test-outsider-3@example.com");

    const result = await getProfile({ communityId: community.id, accountId: owner.id, viewerAccountId: outsider.id });
    expect(result).toEqual({ ok: false, reason: "not_a_member" });
  });

  // T003 (US1, FR-006, research.md #1): a profile account with no current membership is not_found,
  // even if it holds membership in a different community.
  it("rejects when the profile account has no current membership in the community being viewed", async () => {
    const { community: communityC } = await createCommunityWithAdmin(
      "Profile Test Community Four",
      "profile-test-owner-4@example.com",
    );
    const { community: communityD } = await createCommunityWithAdmin(
      "Profile Test Community Four D",
      "profile-test-owner-4d@example.com",
    );
    const buyer = await addMember(communityC.id, "profile-test-buyer-4@example.com");
    const elsewhereOnly = await addMember(communityD.id, "profile-test-elsewhere-4@example.com");

    const result = await getProfile({
      communityId: communityC.id,
      accountId: elsewhereOnly.id,
      viewerAccountId: buyer.id,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  // T003 (US1, FR-009, Clarifications): confirmed-transaction count is global, not scoped.
  it("computes the confirmed-transaction count across every community, not only the one being viewed", async () => {
    const { community: communityC, admin: ownerC } = await createCommunityWithAdmin(
      "Profile Test Community Five C",
      "profile-test-owner-5c@example.com",
    );
    const { community: communityD } = await createCommunityWithAdmin(
      "Profile Test Community Five D",
      "profile-test-owner-5d@example.com",
    );
    await prisma.membership.create({ data: { accountId: ownerC.id, communityId: communityD.id, role: "MEMBER" } });
    const buyerC = await addMember(communityC.id, "profile-test-buyer-5c@example.com");
    const buyerD = await addMember(communityD.id, "profile-test-buyer-5d@example.com");

    await createConfirmedTransaction(communityC.id, ownerC.id, buyerC.id, "Item C");
    await createConfirmedTransaction(communityD.id, ownerC.id, buyerD.id, "Item D");

    const result = await getProfile({ communityId: communityC.id, accountId: ownerC.id, viewerAccountId: buyerC.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.confirmedTransactionCount).toBe(2);
  });

  // T003 (SC-003): no response anywhere carries contact data.
  it("never returns an email, phone, or address field", async () => {
    const { community, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Six",
      "profile-test-owner-6@example.com",
    );
    const buyer = await addMember(community.id, "profile-test-buyer-6@example.com");

    const result = await getProfile({ communityId: community.id, accountId: owner.id, viewerAccountId: buyer.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(Object.keys(result.profile).some((key) => /email|phone|address/i.test(key))).toBe(false);
    expect(JSON.stringify(result.profile)).not.toMatch(/@example\.com/);
  });

  // T025 (US4, FR-008, FR-011): global reputation never reveals which community contributed.
  it("includes ratings from a community the viewer doesn't share, without revealing that community anywhere", async () => {
    const { community: communityC, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Seven C",
      "profile-test-owner-7c@example.com",
    );
    const { community: communityD } = await createCommunityWithAdmin(
      "Profile Test Community Seven D",
      "profile-test-owner-7d@example.com",
    );
    await prisma.membership.create({ data: { accountId: owner.id, communityId: communityD.id, role: "MEMBER" } });
    const buyerC = await addMember(communityC.id, "profile-test-buyer-7c@example.com");
    const buyerD = await addMember(communityD.id, "profile-test-buyer-7d@example.com");

    const txC = await createConfirmedTransaction(communityC.id, owner.id, buyerC.id, "Item C");
    const txD = await createConfirmedTransaction(communityD.id, owner.id, buyerD.id, "Item D");
    const ratedByC = await createReview({
      communityId: communityC.id,
      transactionId: txC.id,
      reviewerAccountId: buyerC.id,
      rating: 5,
    });
    const ratedByD = await createReview({
      communityId: communityD.id,
      transactionId: txD.id,
      reviewerAccountId: buyerD.id,
      rating: 3,
    });
    expect(ratedByC.ok).toBe(true);
    expect(ratedByD.ok).toBe(true);

    const result = await getProfile({ communityId: communityC.id, accountId: owner.id, viewerAccountId: buyerC.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.reviewCount).toBe(2);
    expect(result.profile.averageRating).toBeCloseTo(4, 5);

    const serialized = JSON.stringify(result.profile);
    expect(serialized).not.toContain(communityD.id);
    expect(serialized).not.toContain("Profile Test Community Seven D");
  });

  // T003 (US1, FR-004, SC-009): viewing your own profile returns the identical shape.
  it("returns the identical profile shape whether the viewer is the account itself or someone else", async () => {
    const { community, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Nine",
      "profile-test-owner-9@example.com",
    );
    const buyer = await addMember(community.id, "profile-test-buyer-9@example.com");

    const selfView = await getProfile({ communityId: community.id, accountId: owner.id, viewerAccountId: owner.id });
    const otherView = await getProfile({ communityId: community.id, accountId: owner.id, viewerAccountId: buyer.id });

    expect(selfView).toEqual(otherView);
  });

  // T027 (US4): zero ratings anywhere shows a neutral null, not zero or an error.
  it("shows a null average rating, not zero, for an account with no ratings received anywhere", async () => {
    const { community, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Eight",
      "profile-test-owner-8@example.com",
    );
    const buyer = await addMember(community.id, "profile-test-buyer-8@example.com");

    const result = await getProfile({ communityId: community.id, accountId: owner.id, viewerAccountId: buyer.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.averageRating).toBeNull();
    expect(result.profile.reviewCount).toBe(0);
  });
});
