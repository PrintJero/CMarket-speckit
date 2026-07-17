import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { createListing, listListings, pauseListing } from "@/server/services/listingService";

/** createListing() requires a displayName on the caller (006-user-display-names, FR-008). */
function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date(), displayName: "Test Owner" },
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

async function seedListings(
  communityId: string,
  ownerId: string,
  count: number,
  make: (i: number) => { title: string; description: string; priceCents: number },
) {
  const listings = [];
  for (let i = 0; i < count; i++) {
    const spec = make(i);
    const result = await createListing({ communityId, ownerId, ...spec });
    if (!result.ok) throw new Error(`expected listing ${i} to be created, got ${result.reason}`);
    listings.push(result.listing);
    // Force distinct createdAt ordering deterministically instead of relying on real-clock spacing.
    await prisma.listing.update({
      where: { id: result.listing.id },
      data: { createdAt: new Date(Date.now() + i * 1000) },
    });
  }
  return listings;
}

describe("listListings discovery (contract)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "Discovery Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "discovery-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("pagination (US1)", () => {
    // T002 (FR-003)
    it("returns a bounded, newest-first page and the next page with no overlap or omission", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Discovery Test Community One",
        "discovery-test-admin-1@example.com",
      );
      await seedListings(community.id, admin.id, 25, (i) => ({
        title: `Item ${i}`,
        description: "generic",
        priceCents: 1000,
      }));

      const page1 = await listListings(community.id, admin.id, { page: 1 });
      expect(page1.ok).toBe(true);
      if (!page1.ok) throw new Error("expected success");
      expect(page1.listings).toHaveLength(20);
      expect(page1.hasMore).toBe(true);
      expect(page1.listings[0].title).toBe("Item 24");
      expect(page1.listings[19].title).toBe("Item 5");

      const page2 = await listListings(community.id, admin.id, { page: 2 });
      expect(page2.ok).toBe(true);
      if (!page2.ok) throw new Error("expected success");
      expect(page2.listings).toHaveLength(5);
      expect(page2.hasMore).toBe(false);
      expect(page2.listings.map((l) => l.title)).toEqual(["Item 4", "Item 3", "Item 2", "Item 1", "Item 0"]);

      const page1Ids = new Set(page1.listings.map((l) => l.id));
      const page2Ids = new Set(page2.listings.map((l) => l.id));
      expect([...page1Ids].some((id) => page2Ids.has(id))).toBe(false);
    });

    // T002 (FR-002)
    it("never returns a PAUSED listing on any page", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Discovery Test Community Two",
        "discovery-test-admin-2@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Paused item",
        description: "generic",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected creation to succeed");
      await pauseListing({ listingId: created.listing.id, callerAccountId: admin.id });

      const result = await listListings(community.id, admin.id, {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.listings).toHaveLength(0);
    });

    // T002 (FR-008)
    it("returns an empty result, not an error, for a page beyond the last with data", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Discovery Test Community Three",
        "discovery-test-admin-3@example.com",
      );
      await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Only item",
        description: "generic",
        priceCents: 500,
      });

      const result = await listListings(community.id, admin.id, { page: 5 });
      expect(result).toEqual({ ok: true, listings: [], page: 5, pageSize: 20, hasMore: false });
    });

    // T002 (FR-001)
    it("rejects a caller with no membership in the community", async () => {
      const { community } = await createCommunityWithAdmin(
        "Discovery Test Community Four",
        "discovery-test-admin-4@example.com",
      );
      const outsider = await createVerifiedAccount("discovery-test-outsider-4@example.com");

      const result = await listListings(community.id, outsider.id, { page: 1 });
      expect(result).toEqual({ ok: false, reason: "not_a_member" });
    });
  });

  describe("keyword search (US2)", () => {
    // T007 (FR-004)
    it("matches a keyword against title or description, case-insensitively", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Discovery Test Community Five",
        "discovery-test-admin-5@example.com",
      );
      const bicycle = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Mountain Bicycle",
        description: "generic",
        priceCents: 5000,
      });
      const jacket = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Winter coat",
        description: "made of leather jacket fabric",
        priceCents: 8000,
      });
      if (!bicycle.ok || !jacket.ok) throw new Error("expected both listings to be created");

      const byTitle = await listListings(community.id, admin.id, { search: "bicycle" });
      expect(byTitle.ok).toBe(true);
      if (!byTitle.ok) throw new Error("expected success");
      expect(byTitle.listings.map((l) => l.id)).toEqual([bicycle.listing.id]);

      const byDescription = await listListings(community.id, admin.id, { search: "LEATHER" });
      expect(byDescription.ok).toBe(true);
      if (!byDescription.ok) throw new Error("expected success");
      expect(byDescription.listings.map((l) => l.id)).toEqual([jacket.listing.id]);

      const noMatch = await listListings(community.id, admin.id, { search: "zzz-nonexistent" });
      expect(noMatch.ok).toBe(true);
      if (!noMatch.ok) throw new Error("expected success");
      expect(noMatch.listings).toHaveLength(0);
    });

    // T007 (FR-001, FR-002)
    it("never matches a different community's listing or a PAUSED one", async () => {
      const { community: communityA, admin: adminA } = await createCommunityWithAdmin(
        "Discovery Test Community Six A",
        "discovery-test-admina-6@example.com",
      );
      const { community: communityB, admin: adminB } = await createCommunityWithAdmin(
        "Discovery Test Community Six B",
        "discovery-test-adminb-6@example.com",
      );
      await createListing({
        communityId: communityB.id,
        ownerId: adminB.id,
        title: "Bicycle in B",
        description: "generic",
        priceCents: 5000,
      });
      const paused = await createListing({
        communityId: communityA.id,
        ownerId: adminA.id,
        title: "Bicycle paused in A",
        description: "generic",
        priceCents: 5000,
      });
      if (!paused.ok) throw new Error("expected creation to succeed");
      await pauseListing({ listingId: paused.listing.id, callerAccountId: adminA.id });

      const result = await listListings(communityA.id, adminA.id, { search: "bicycle" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.listings).toHaveLength(0);
    });
  });

  describe("price range filter (US3)", () => {
    // T012 (FR-005)
    it("returns only listings within an inclusive [min, max] range", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Discovery Test Community Seven",
        "discovery-test-admin-7@example.com",
      );
      const cheap = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Cheap",
        description: "generic",
        priceCents: 1000,
      });
      const mid = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Mid",
        description: "generic",
        priceCents: 5000,
      });
      const expensive = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Expensive",
        description: "generic",
        priceCents: 9000,
      });
      if (!cheap.ok || !mid.ok || !expensive.ok) throw new Error("expected all listings to be created");

      const ranged = await listListings(community.id, admin.id, {
        minPriceCents: 2000,
        maxPriceCents: 6000,
      });
      expect(ranged.ok).toBe(true);
      if (!ranged.ok) throw new Error("expected success");
      expect(ranged.listings.map((l) => l.id)).toEqual([mid.listing.id]);

      const minOnly = await listListings(community.id, admin.id, { minPriceCents: 5000 });
      expect(minOnly.ok).toBe(true);
      if (!minOnly.ok) throw new Error("expected success");
      expect(new Set(minOnly.listings.map((l) => l.id))).toEqual(
        new Set([mid.listing.id, expensive.listing.id]),
      );

      const maxOnly = await listListings(community.id, admin.id, { maxPriceCents: 5000 });
      expect(maxOnly.ok).toBe(true);
      if (!maxOnly.ok) throw new Error("expected success");
      expect(new Set(maxOnly.listings.map((l) => l.id))).toEqual(
        new Set([cheap.listing.id, mid.listing.id]),
      );

      // Bounds are inclusive.
      const exact = await listListings(community.id, admin.id, {
        minPriceCents: 5000,
        maxPriceCents: 5000,
      });
      expect(exact.ok).toBe(true);
      if (!exact.ok) throw new Error("expected success");
      expect(exact.listings.map((l) => l.id)).toEqual([mid.listing.id]);
    });

    // T012 (Edge Cases)
    it("rejects a minimum greater than the maximum, querying nothing", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Discovery Test Community Eight",
        "discovery-test-admin-8@example.com",
      );
      await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Irrelevant",
        description: "generic",
        priceCents: 5000,
      });

      const result = await listListings(community.id, admin.id, {
        minPriceCents: 6000,
        maxPriceCents: 2000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_input" });
    });
  });

  describe("combined search, price filter, and pagination (US4)", () => {
    // T017 (FR-006)
    it("applies search, price range, and pagination together in one query", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Discovery Test Community Nine",
        "discovery-test-admin-9@example.com",
      );
      // 22 matching listings (title contains "bicycle", price within [1000, 9000]).
      await seedListings(community.id, admin.id, 22, (i) => ({
        title: `Matching bicycle ${i}`,
        description: "generic",
        priceCents: 5000,
      }));
      // Listings that must never match: wrong keyword, and out-of-range price.
      await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Unrelated desk",
        description: "generic",
        priceCents: 5000,
      });
      await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Out of range bicycle",
        description: "generic",
        priceCents: 100,
      });

      const page1 = await listListings(community.id, admin.id, {
        search: "bicycle",
        minPriceCents: 1000,
        maxPriceCents: 9000,
        page: 1,
      });
      expect(page1.ok).toBe(true);
      if (!page1.ok) throw new Error("expected success");
      expect(page1.listings).toHaveLength(20);
      expect(page1.hasMore).toBe(true);
      expect(page1.listings.every((l) => l.title.startsWith("Matching bicycle"))).toBe(true);

      const page2 = await listListings(community.id, admin.id, {
        search: "bicycle",
        minPriceCents: 1000,
        maxPriceCents: 9000,
        page: 2,
      });
      expect(page2.ok).toBe(true);
      if (!page2.ok) throw new Error("expected success");
      expect(page2.listings).toHaveLength(2);
      expect(page2.hasMore).toBe(false);

      const allIds = [...page1.listings, ...page2.listings].map((l) => l.id);
      expect(new Set(allIds).size).toBe(22);
    });
  });
});
