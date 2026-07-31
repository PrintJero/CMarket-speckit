import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { createListing } from "@/server/services/listingService";
import { proposePurchase, acceptProposal } from "@/server/services/transactionService";
import { createReview } from "@/server/services/reviewService";
import { getProfile, getSelfProfile } from "@/server/services/profileService";

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

/** 013-purchase-flow-stock, research.md #11: an ACCEPTED transaction via propose-then-accept, replacing 010's CONFIRMED fixture. */
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

describe("profileService (contract)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "Profile Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "profile-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // T006 (US2, FR-013, FR-014): sharing exactly one community shows that one, correctly scoped.
  it("shows the one shared community, with correct member-since date and active listings", async () => {
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

    const result = await getProfile({ accountId: owner.id, viewerAccountId: buyer.id });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.displayName).toBe("Test Account");
    expect(result.profile.completedTransactionCount).toBe(1);
    expect(result.profile.averageRating).toBeNull();
    expect(result.profile.reviewCount).toBe(0);
    expect(result.profile.communities).toHaveLength(1);
    const section = result.profile.communities[0];
    expect(section.communityId).toBe(community.id);
    expect(section.memberSince).toBeInstanceOf(Date);
    const listingIds = section.listings.map((listing) => listing.id);
    expect(listingIds).toContain(activeListing.listing.id);
  });

  // T006 (US2, FR-014): sharing two communities shows both, each independently scoped.
  it("shows every shared community when two or more are shared", async () => {
    const { community: communityC, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Two",
      "profile-test-owner-2@example.com",
    );
    const { community: communityD } = await createCommunityWithAdmin(
      "Profile Test Community Two D",
      "profile-test-owner-2d@example.com",
    );
    await prisma.membership.create({ data: { accountId: owner.id, communityId: communityD.id, role: "MEMBER" } });
    const viewer = await addMember(communityC.id, "profile-test-buyer-2@example.com");
    await prisma.membership.create({ data: { accountId: viewer.id, communityId: communityD.id, role: "MEMBER" } });

    const inC = await createListing({
      communityId: communityC.id,
      ownerId: owner.id,
      title: "In Community C",
      description: "Description",
      priceCents: 1000,
    });
    if (!inC.ok) throw new Error("expected listing creation to succeed");
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

    const result = await getProfile({ accountId: owner.id, viewerAccountId: viewer.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.communities.map((c) => c.communityId).sort()).toEqual(
      [communityC.id, communityD.id].sort(),
    );
    const sectionC = result.profile.communities.find((c) => c.communityId === communityC.id)!;
    const sectionD = result.profile.communities.find((c) => c.communityId === communityD.id)!;
    expect(sectionC.listings.map((l) => l.id)).toEqual([inC.listing.id]);
    expect(sectionD.listings.map((l) => l.id)).toEqual([inD.listing.id]);
    // No listing entry carries a status field.
    expect([...sectionC.listings, ...sectionD.listings].every((l) => !("status" in l))).toBe(true);
  });

  // T006 (US2, FR-015): a community only the viewer belongs to never appears.
  it("never includes a community only the viewer belongs to", async () => {
    const { community: shared, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Three Shared",
      "profile-test-owner-3@example.com",
    );
    const { community: viewerOnly } = await createCommunityWithAdmin(
      "Profile Test Community Three Viewer Only",
      "profile-test-owner-3vo@example.com",
    );
    const viewer = await addMember(shared.id, "profile-test-viewer-3@example.com");
    await prisma.membership.create({ data: { accountId: viewer.id, communityId: viewerOnly.id, role: "MEMBER" } });

    const result = await getProfile({ accountId: owner.id, viewerAccountId: viewer.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.communities.map((c) => c.communityId)).toEqual([shared.id]);
    const serialized = JSON.stringify(result.profile);
    expect(serialized).not.toContain(viewerOnly.id);
    expect(serialized).not.toContain("Profile Test Community Three Viewer Only");
  });

  // T006 (US2, FR-016): a community only the target belongs to never appears.
  it("never includes a community only the target belongs to", async () => {
    const { community: shared, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Four Shared",
      "profile-test-owner-4@example.com",
    );
    const { community: targetOnly } = await createCommunityWithAdmin(
      "Profile Test Community Four Target Only",
      "profile-test-owner-4to@example.com",
    );
    await prisma.membership.create({ data: { accountId: owner.id, communityId: targetOnly.id, role: "MEMBER" } });
    const viewer = await addMember(shared.id, "profile-test-viewer-4@example.com");

    const result = await getProfile({ accountId: owner.id, viewerAccountId: viewer.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.communities.map((c) => c.communityId)).toEqual([shared.id]);
    const serialized = JSON.stringify(result.profile);
    expect(serialized).not.toContain(targetOnly.id);
    expect(serialized).not.toContain("Profile Test Community Four Target Only");
  });

  // T006 (US2, FR-017): zero shared communities → not_found, no data at all.
  it("rejects with not_found when the viewer and target share no current community", async () => {
    const { community: communityOwner, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Five Owner",
      "profile-test-owner-5@example.com",
    );
    void communityOwner;
    const outsider = await createVerifiedAccount("profile-test-outsider-5@example.com");

    const result = await getProfile({ accountId: owner.id, viewerAccountId: outsider.id });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  // T006 (research.md #2): a nonexistent accountId gets the identical not_found response.
  it("returns the identical not_found response for a nonexistent account as for a shared-nothing account", async () => {
    const { admin: viewer } = await createCommunityWithAdmin(
      "Profile Test Community Six",
      "profile-test-viewer-6@example.com",
    );
    const result = await getProfile({ accountId: "nonexistent-account-id", viewerAccountId: viewer.id });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  // T006 (US2, FR-009, FR-018, Clarifications): completed-transaction count is global, not scoped.
  it("computes the completed-transaction count across every community, not only a shared one", async () => {
    const { community: communityC, admin: ownerC } = await createCommunityWithAdmin(
      "Profile Test Community Seven C",
      "profile-test-owner-7c@example.com",
    );
    const { community: communityD } = await createCommunityWithAdmin(
      "Profile Test Community Seven D",
      "profile-test-owner-7d@example.com",
    );
    await prisma.membership.create({ data: { accountId: ownerC.id, communityId: communityD.id, role: "MEMBER" } });
    const buyerC = await addMember(communityC.id, "profile-test-buyer-7c@example.com");
    const buyerD = await addMember(communityD.id, "profile-test-buyer-7d@example.com");

    await createConfirmedTransaction(communityC.id, ownerC.id, buyerC.id, "Item C");
    await createConfirmedTransaction(communityD.id, ownerC.id, buyerD.id, "Item D");

    const result = await getProfile({ accountId: ownerC.id, viewerAccountId: buyerC.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.completedTransactionCount).toBe(2);
  });

  // T006 (SC-003): no response anywhere carries contact data.
  it("never returns an email, phone, or address field", async () => {
    const { community, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Eight",
      "profile-test-owner-8@example.com",
    );
    const buyer = await addMember(community.id, "profile-test-buyer-8@example.com");

    const result = await getProfile({ accountId: owner.id, viewerAccountId: buyer.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(Object.keys(result.profile).some((key) => /email|phone|address/i.test(key))).toBe(false);
    expect(JSON.stringify(result.profile)).not.toMatch(/@example\.com/);
  });

  // T025 (US4, FR-018, FR-019): global reputation never reveals which community contributed.
  it("includes ratings from a community the viewer doesn't share, without revealing that community anywhere", async () => {
    const { community: communityC, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Nine C",
      "profile-test-owner-9c@example.com",
    );
    const { community: communityD } = await createCommunityWithAdmin(
      "Profile Test Community Nine D",
      "profile-test-owner-9d@example.com",
    );
    await prisma.membership.create({ data: { accountId: owner.id, communityId: communityD.id, role: "MEMBER" } });
    const buyerC = await addMember(communityC.id, "profile-test-buyer-9c@example.com");
    const buyerD = await addMember(communityD.id, "profile-test-buyer-9d@example.com");

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

    const result = await getProfile({ accountId: owner.id, viewerAccountId: buyerC.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.reviewCount).toBe(2);
    expect(result.profile.averageRating).toBeCloseTo(4, 5);

    const serialized = JSON.stringify(result.profile);
    expect(serialized).not.toContain(communityD.id);
    expect(serialized).not.toContain("Profile Test Community Nine D");
  });

  // T006 (US2 Edge Case, FR-013): self-viewing returns every one of the account's own current communities.
  it("returns every one of the account's own current communities when viewing your own profile", async () => {
    const { community: communityC, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Ten C",
      "profile-test-owner-10c@example.com",
    );
    const { community: communityD } = await createCommunityWithAdmin(
      "Profile Test Community Ten D",
      "profile-test-owner-10d@example.com",
    );
    await prisma.membership.create({ data: { accountId: owner.id, communityId: communityD.id, role: "MEMBER" } });

    const result = await getProfile({ accountId: owner.id, viewerAccountId: owner.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.communities.map((c) => c.communityId).sort()).toEqual(
      [communityC.id, communityD.id].sort(),
    );
    // GetProfileResult's profile type has no email field at all (checked statically, not at runtime).
    expect(Object.keys(result.profile)).not.toContain("email");
  });

  // T027 (US4): zero ratings anywhere shows a neutral null, not zero or an error.
  it("shows a null average rating, not zero, for an account with no ratings received anywhere", async () => {
    const { community, admin: owner } = await createCommunityWithAdmin(
      "Profile Test Community Eleven",
      "profile-test-owner-11@example.com",
    );
    const buyer = await addMember(community.id, "profile-test-buyer-11@example.com");

    const result = await getProfile({ accountId: owner.id, viewerAccountId: buyer.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.profile.averageRating).toBeNull();
    expect(result.profile.reviewCount).toBe(0);
  });

  describe("getSelfProfile", () => {
    // T002 (US1, FR-002–FR-004): own display name, email, account creation date, global reputation.
    it("shows the account's own display name, email, account creation date, and global reputation numbers", async () => {
      const { community, admin: owner } = await createCommunityWithAdmin(
        "Profile Test Community Ten",
        "profile-test-self-10@example.com",
      );
      const buyer = await addMember(community.id, "profile-test-self-buyer-10@example.com");
      await createConfirmedTransaction(community.id, owner.id, buyer.id);

      const result = await getSelfProfile(owner.id);

      expect(result.displayName).toBe("Test Account");
      expect(result.email).toBe("profile-test-self-10@example.com");
      expect(result.accountCreatedAt).toBeInstanceOf(Date);
      expect(result.completedTransactionCount).toBe(1);
      expect(result.averageRating).toBeNull();
      expect(result.reviewCount).toBe(0);
    });

    // T002 (US1, FR-005–FR-007): one entry per current community, with role/member-since/listings (both kinds).
    it("lists every current community with role, member-since date, and both kinds of active listings", async () => {
      const { community: communityC, admin: owner } = await createCommunityWithAdmin(
        "Profile Test Community Eleven C",
        "profile-test-self-11c@example.com",
      );
      const { community: communityD } = await createCommunityWithAdmin(
        "Profile Test Community Eleven D",
        "profile-test-self-11d@example.com",
      );
      await prisma.membership.create({ data: { accountId: owner.id, communityId: communityD.id, role: "MEMBER" } });

      const forSale = await createListing({
        communityId: communityC.id,
        ownerId: owner.id,
        title: "Self Profile Bicycle",
        description: "Description",
        priceCents: 5000,
        kind: "FOR_SALE",
        stockQuantity: 3,
      });
      if (!forSale.ok) throw new Error("expected listing creation to succeed");
      const wanted = await createListing({
        communityId: communityD.id,
        ownerId: owner.id,
        title: "Looking for a desk",
        description: "Description",
        kind: "WANTED",
      });
      if (!wanted.ok) throw new Error("expected listing creation to succeed");

      const result = await getSelfProfile(owner.id);

      expect(result.communities).toHaveLength(2);
      const inC = result.communities.find((c) => c.communityId === communityC.id);
      const inD = result.communities.find((c) => c.communityId === communityD.id);
      expect(inC).toBeDefined();
      expect(inD).toBeDefined();
      expect(inC?.role).toBe("ADMINISTRATOR");
      expect(inC?.memberSince).toBeInstanceOf(Date);
      expect(inC?.listings.map((l) => l.title)).toContain("Self Profile Bicycle");
      expect(inC?.listings.find((l) => l.title === "Self Profile Bicycle")?.stockQuantity).toBe(3);
      expect(inD?.listings.map((l) => l.title)).toContain("Looking for a desk");
      expect(inD?.listings.find((l) => l.title === "Looking for a desk")?.kind).toBe("WANTED");
      // No listing entry carries a status field.
      const allListings = [...(inC?.listings ?? []), ...(inD?.listings ?? [])];
      expect(allListings.every((l) => !("status" in l))).toBe(true);
    });

    // T002 (Edge Case): an account with no memberships gets an empty array, not an error.
    it("returns an empty communities array for an account with no current memberships", async () => {
      const lonely = await createVerifiedAccount("profile-test-self-lonely-12@example.com");
      const result = await getSelfProfile(lonely.id);
      expect(result.communities).toEqual([]);
    });

    // T002 (FR-009): no authentication-internal field ever appears.
    it("never returns a password, session, or authentication-token field", async () => {
      const { admin: owner } = await createCommunityWithAdmin(
        "Profile Test Community Thirteen",
        "profile-test-self-13@example.com",
      );
      const result = await getSelfProfile(owner.id);
      expect(Object.keys(result).some((key) => /password|session|token/i.test(key))).toBe(false);
    });
  });
});
