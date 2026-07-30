import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import {
  createListing,
  addListingPhoto,
  listListings,
  getListing,
  updateListing,
  removeListingPhoto,
  setCoverPhoto,
  pauseListing,
  reactivateListing,
  fulfillListing,
  deleteListing,
  listMyListings,
} from "@/server/services/listingService";
import { setDisplayName } from "@/server/services/accountService";

/**
 * Defaults to a display name (006-user-display-names, FR-008) since almost
 * every test in this file uses its accounts to create listings, which now
 * requires one; the handful of tests specifically about the nameless case
 * null it back out afterward via a direct prisma.account.update() call.
 */
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

async function addMember(communityId: string, email: string) {
  const account = await createVerifiedAccount(email);
  await prisma.membership.create({ data: { accountId: account.id, communityId, role: "MEMBER" } });
  return account;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe("listingService (contract)", () => {
  beforeEach(async () => {
    // Community deletion cascades to Membership/Invitation/Listing/ListingPhoto (schema.prisma).
    await prisma.community.deleteMany({ where: { name: { contains: "Listing Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "listing-test" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("createListing", () => {
    // T003 (US1)
    it("creates a listing for a member (any role), scoped to the community, starting ACTIVE (FR-001, FR-002, FR-005)", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community One",
        "listing-test-admin-1@example.com",
      );
      const member = await addMember(community.id, "listing-test-member-1@example.com");

      const result = await createListing({
        communityId: community.id,
        ownerId: member.id,
        title: "Bicycle",
        description: "Barely used road bike",
        priceCents: 25000,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.listing.status).toBe("ACTIVE");
      expect(result.listing.ownerId).toBe(member.id);
      expect(result.listing.communityId).toBe(community.id);

      // Also succeeds for the community's administrator (any role may create).
      const adminResult = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Desk",
        description: "Standing desk",
        priceCents: 15000,
      });
      expect(adminResult.ok).toBe(true);
    });

    // T003 (FR-002)
    it("rejects blank title/description or a negative/non-integer price, writing nothing", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Two",
        "listing-test-admin-2@example.com",
      );

      const blankTitle = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "   ",
        description: "valid",
        priceCents: 100,
      });
      expect(blankTitle).toEqual({ ok: false, reason: "invalid_input" });

      const blankDescription = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "valid",
        description: "",
        priceCents: 100,
      });
      expect(blankDescription).toEqual({ ok: false, reason: "invalid_input" });

      const negativePrice = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "valid",
        description: "valid",
        priceCents: -1,
      });
      expect(negativePrice).toEqual({ ok: false, reason: "invalid_input" });

      const nonIntegerPrice = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "valid",
        description: "valid",
        priceCents: 10.5,
      });
      expect(nonIntegerPrice).toEqual({ ok: false, reason: "invalid_input" });

      expect(await prisma.listing.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T003 (FR-001/Edge Cases)
    it("rejects a caller with no membership in the target community", async () => {
      const { community } = await createCommunityWithAdmin(
        "Listing Test Community Three",
        "listing-test-admin-3@example.com",
      );
      const outsider = await createVerifiedAccount("listing-test-outsider-3@example.com");

      const result = await createListing({
        communityId: community.id,
        ownerId: outsider.id,
        title: "valid",
        description: "valid",
        priceCents: 100,
      });

      expect(result).toEqual({ ok: false, reason: "not_a_member" });
      expect(await prisma.listing.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T014 (006-user-display-names, FR-008): the guarantee holds regardless of
    // client — createListing() itself rejects a nameless caller, not only the form.
    it("rejects a caller with no display name yet, writing nothing, then succeeds once one is set", async () => {
      const { community } = await createCommunityWithAdmin(
        "Listing Test Community Twenty Six",
        "listing-test-admin-26@example.com",
      );
      const nameless = await addMember(community.id, "listing-test-member-26@example.com");
      await prisma.account.update({ where: { id: nameless.id }, data: { displayName: null } });

      const rejected = await createListing({
        communityId: community.id,
        ownerId: nameless.id,
        title: "valid",
        description: "valid",
        priceCents: 100,
      });
      expect(rejected).toEqual({ ok: false, reason: "display_name_required" });
      expect(await prisma.listing.count({ where: { communityId: community.id } })).toBe(0);

      await setDisplayName(nameless.id, "Now Named");
      const accepted = await createListing({
        communityId: community.id,
        ownerId: nameless.id,
        title: "valid",
        description: "valid",
        priceCents: 100,
      });
      expect(accepted.ok).toBe(true);
    });
  });

  describe("createListing with kind (011-wanted-posts)", () => {
    // T002 (FR-002, FR-003)
    it("creates a WANTED post with no price (null), or with a valid optional budget", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Wanted One",
        "listing-test-wanted-admin-1@example.com",
      );

      const noPrice = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Looking for a laptop",
        description: "Used is fine",
        kind: "WANTED",
      });
      expect(noPrice.ok).toBe(true);
      if (!noPrice.ok) throw new Error("expected success");
      expect(noPrice.listing.kind).toBe("WANTED");
      expect(noPrice.listing.priceCents).toBeNull();

      const withBudget = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Looking for a bike",
        description: "Under budget",
        kind: "WANTED",
        priceCents: 5000,
      });
      expect(withBudget.ok).toBe(true);
      if (!withBudget.ok) throw new Error("expected success");
      expect(withBudget.listing.priceCents).toBe(5000);
    });

    // T002 (FR-003)
    it("rejects an invalid budget on a WANTED post, writing nothing", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Wanted Two",
        "listing-test-wanted-admin-2@example.com",
      );

      const result = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Looking for something",
        description: "Description",
        kind: "WANTED",
        priceCents: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_input" });
      expect(await prisma.listing.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T002 (FR-003 regression): FOR_SALE still requires a price, kind omitted defaults to FOR_SALE.
    it("still requires a valid price for FOR_SALE (kind omitted), regardless of this feature", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Wanted Three",
        "listing-test-wanted-admin-3@example.com",
      );

      const missingPrice = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "For sale, no price",
        description: "Description",
      });
      expect(missingPrice).toEqual({ ok: false, reason: "invalid_input" });

      const explicitForSale = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "For sale, no price, explicit kind",
        description: "Description",
        kind: "FOR_SALE",
      });
      expect(explicitForSale).toEqual({ ok: false, reason: "invalid_input" });
      expect(await prisma.listing.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T002 (FR-001): membership gate is unaffected by kind.
    it("rejects a non-member creating a WANTED post, exactly as for a FOR_SALE one", async () => {
      const { community } = await createCommunityWithAdmin(
        "Listing Test Community Wanted Four",
        "listing-test-wanted-admin-4@example.com",
      );
      const outsider = await createVerifiedAccount("listing-test-wanted-outsider-4@example.com");

      const result = await createListing({
        communityId: community.id,
        ownerId: outsider.id,
        title: "Looking for something",
        description: "Description",
        kind: "WANTED",
      });
      expect(result).toEqual({ ok: false, reason: "not_a_member" });
      expect(await prisma.listing.count({ where: { communityId: community.id } })).toBe(0);
    });

    // T002 (FR-004 regression): photos/cover work identically on a WANTED post.
    it("adds photos and assigns a cover on a WANTED post exactly as on a FOR_SALE one", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Wanted Five",
        "listing-test-wanted-admin-5@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Looking for a chair",
        description: "Description",
        kind: "WANTED",
      });
      if (!created.ok) throw new Error("expected creation to succeed");

      const photo = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      expect(photo.ok).toBe(true);
      if (!photo.ok) throw new Error("expected success");
      expect(photo.photo.position).toBe(0);
      expect(
        (await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).coverPhotoId,
      ).toBe(photo.photo.id);
    });
  });

  describe("addListingPhoto", () => {
    // T004 (US1)
    it("adds a valid photo at the next position (FR-003)", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Four",
        "listing-test-admin-4@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Chair",
        description: "Wooden chair",
        priceCents: 5000,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const first = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("expected success");
      expect(first.photo.position).toBe(0);

      const second = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/png",
      });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error("expected success");
      expect(second.photo.position).toBe(1);
    });

    // T004 (research.md #1)
    it("rejects an oversized photo or an unsupported MIME type, writing nothing", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Five",
        "listing-test-admin-5@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Lamp",
        description: "Desk lamp",
        priceCents: 2000,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const oversized = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: Buffer.alloc(6_000_000),
        mimeType: "image/jpeg",
      });
      expect(oversized).toEqual({ ok: false, reason: "invalid_photo" });

      const wrongType = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/gif",
      });
      expect(wrongType).toEqual({ ok: false, reason: "invalid_photo" });

      expect(await prisma.listingPhoto.count({ where: { listingId: created.listing.id } })).toBe(0);
    });

    // T004 (photo cap)
    it("rejects a 7th photo on a listing that already has 6", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Six",
        "listing-test-admin-6@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Sofa",
        description: "Grey sofa",
        priceCents: 30000,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      for (let i = 0; i < 6; i += 1) {
        const added = await addListingPhoto({
          listingId: created.listing.id,
          callerAccountId: admin.id,
          data: JPEG,
          mimeType: "image/jpeg",
        });
        expect(added.ok).toBe(true);
      }

      const seventh = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      expect(seventh).toEqual({ ok: false, reason: "photo_limit_reached" });
      expect(await prisma.listingPhoto.count({ where: { listingId: created.listing.id } })).toBe(6);
    });

    // T004 (FR-006/FR-010)
    it("rejects a non-owner, including that community's administrator", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Seven",
        "listing-test-admin-7@example.com",
      );
      const member = await addMember(community.id, "listing-test-member-7@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: member.id,
        title: "Bike helmet",
        description: "Medium size",
        priceCents: 1500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const result = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      expect(result).toEqual({ ok: false, reason: "not_owner" });
    });
  });

  describe("listListings / getListing", () => {
    // T005 (FR-011, FR-012)
    it("only shows a community's own ACTIVE listings to its own members, never a different community's", async () => {
      const { community: communityA, admin: adminA } = await createCommunityWithAdmin(
        "Listing Test Community Eight A",
        "listing-test-admina-8@example.com",
      );
      const { community: communityB, admin: adminB } = await createCommunityWithAdmin(
        "Listing Test Community Eight B",
        "listing-test-adminb-8@example.com",
      );

      const listingA = await createListing({
        communityId: communityA.id,
        ownerId: adminA.id,
        title: "A's item",
        description: "belongs to A",
        priceCents: 100,
      });
      const listingB = await createListing({
        communityId: communityB.id,
        ownerId: adminB.id,
        title: "B's item",
        description: "belongs to B",
        priceCents: 200,
      });
      if (!listingA.ok || !listingB.ok) throw new Error("expected both listings to be created");

      const feedA = await listListings(communityA.id, adminA.id);
      expect(feedA.ok).toBe(true);
      if (!feedA.ok) throw new Error("expected success");
      expect(feedA.listings.map((l) => l.id)).toEqual([listingA.listing.id]);

      const outsider = await createVerifiedAccount("listing-test-outsider-8@example.com");
      const rejected = await listListings(communityA.id, outsider.id);
      expect(rejected).toEqual({ ok: false, reason: "not_a_member" });
    });

    // T005 (getListing)
    it("getListing returns any-status listings only within the caller's own community", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Nine",
        "listing-test-admin-9@example.com",
      );
      const { community: otherCommunity, admin: otherAdmin } = await createCommunityWithAdmin(
        "Listing Test Community Nine B",
        "listing-test-adminb-9@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Guitar",
        description: "Acoustic",
        priceCents: 40000,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const found = await getListing(community.id, created.listing.id, admin.id);
      expect(found.ok).toBe(true);

      const notAMember = await getListing(community.id, created.listing.id, otherAdmin.id);
      expect(notAMember).toEqual({ ok: false, reason: "not_a_member" });

      const wrongCommunity = await getListing(otherCommunity.id, created.listing.id, otherAdmin.id);
      expect(wrongCommunity).toEqual({ ok: false, reason: "not_found" });
    });

    // T009 (006-user-display-names, FR-009): listListings/getListing expose the owner's displayName.
    it("includes the owner's ownerDisplayName, null when the owner has none", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Twenty Five",
        "listing-test-admin-25@example.com",
      );
      await setDisplayName(admin.id, "Ada Lovelace");
      const nameless = await addMember(community.id, "listing-test-member-25@example.com");
      await prisma.account.update({ where: { id: nameless.id }, data: { displayName: null } });

      const named = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Named owner's item",
        description: "Description",
        priceCents: 500,
      });
      if (!named.ok) throw new Error("expected listing creation to succeed");
      // A nameless account can no longer create a listing at all (FR-008) — seed
      // this one directly to test listListings()/getListing()'s own null-handling,
      // independent of createListing()'s separate precondition (covered elsewhere).
      const unnamedListing = await prisma.listing.create({
        data: {
          communityId: community.id,
          ownerId: nameless.id,
          title: "Nameless owner's item",
          description: "Description",
          priceCents: 500,
        },
      });

      const feed = await listListings(community.id, admin.id);
      expect(feed.ok).toBe(true);
      if (!feed.ok) throw new Error("expected success");
      expect(feed.listings.find((l) => l.id === named.listing.id)?.ownerDisplayName).toBe("Ada Lovelace");
      expect(feed.listings.find((l) => l.id === unnamedListing.id)?.ownerDisplayName).toBeNull();

      const foundNamed = await getListing(community.id, named.listing.id, admin.id);
      expect(foundNamed.ok).toBe(true);
      if (!foundNamed.ok) throw new Error("expected success");
      expect(foundNamed.listing.ownerDisplayName).toBe("Ada Lovelace");

      const foundUnnamed = await getListing(community.id, unnamedListing.id, admin.id);
      expect(foundUnnamed.ok).toBe(true);
      if (!foundUnnamed.ok) throw new Error("expected success");
      expect(foundUnnamed.listing.ownerDisplayName).toBeNull();
    });
  });

  describe("cover photo (2026-07-17 amendment)", () => {
    // T041 (FR-014, FR-015)
    it("automatically sets the first added photo as cover, and leaves it unchanged when a second photo is added", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Twenty",
        "listing-test-admin-20@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const beforeAnyPhoto = await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } });
      expect(beforeAnyPhoto.coverPhotoId).toBeNull();

      const first = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      if (!first.ok) throw new Error("expected photo to be added");
      const afterFirst = await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } });
      expect(afterFirst.coverPhotoId).toBe(first.photo.id);

      const second = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      if (!second.ok) throw new Error("expected photo to be added");
      const afterSecond = await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } });
      expect(afterSecond.coverPhotoId).toBe(first.photo.id);
    });

    // T041 (FR-016)
    it("lets the owner change the cover to a different existing photo; rejects a non-owner", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Twenty One",
        "listing-test-admin-21@example.com",
      );
      const member = await addMember(community.id, "listing-test-member-21@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");
      const first = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      const second = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      if (!first.ok || !second.ok) throw new Error("expected both photos to be added");

      const rejected = await setCoverPhoto({
        listingId: created.listing.id,
        photoId: second.photo.id,
        callerAccountId: member.id,
      });
      expect(rejected).toEqual({ ok: false, reason: "not_owner" });
      expect(
        (await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).coverPhotoId,
      ).toBe(first.photo.id);

      const result = await setCoverPhoto({
        listingId: created.listing.id,
        photoId: second.photo.id,
        callerAccountId: admin.id,
      });
      expect(result).toEqual({ ok: true, listing: { id: created.listing.id, coverPhotoId: second.photo.id } });
      expect(
        (await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).coverPhotoId,
      ).toBe(second.photo.id);
    });

    // T041 (FR-017)
    it("promotes the remaining lowest-position photo when the cover is removed, and clears it when no photos remain", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Twenty Two",
        "listing-test-admin-22@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const photos = [];
      for (let i = 0; i < 3; i += 1) {
        const added = await addListingPhoto({
          listingId: created.listing.id,
          callerAccountId: admin.id,
          data: JPEG,
          mimeType: "image/jpeg",
        });
        if (!added.ok) throw new Error("expected photo to be added");
        photos.push(added.photo);
      }

      // Cover starts as photos[0] (position 0).
      await removeListingPhoto({ listingId: created.listing.id, photoId: photos[0].id, callerAccountId: admin.id });
      expect(
        (await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).coverPhotoId,
      ).toBe(photos[1].id);

      await removeListingPhoto({ listingId: created.listing.id, photoId: photos[1].id, callerAccountId: admin.id });
      expect(
        (await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).coverPhotoId,
      ).toBe(photos[2].id);

      await removeListingPhoto({ listingId: created.listing.id, photoId: photos[2].id, callerAccountId: admin.id });
      expect(
        (await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).coverPhotoId,
      ).toBeNull();
    });

    // T041 (FR-016 — cross-listing rejection)
    it("rejects setCoverPhoto for a photo that does not belong to the listing", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Twenty Three",
        "listing-test-admin-23@example.com",
      );
      const listingA = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "A",
        description: "Description",
        priceCents: 500,
      });
      const listingB = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "B",
        description: "Description",
        priceCents: 500,
      });
      if (!listingA.ok || !listingB.ok) throw new Error("expected both listings to be created");
      const photoOnB = await addListingPhoto({
        listingId: listingB.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      if (!photoOnB.ok) throw new Error("expected photo to be added");

      const result = await setCoverPhoto({
        listingId: listingA.listing.id,
        photoId: photoOnB.photo.id,
        callerAccountId: admin.id,
      });
      expect(result).toEqual({ ok: false, reason: "not_found" });
    });

    // T042 (FR-014): listListings/getListing expose coverPhotoId
    it("includes coverPhotoId in listListings() and getListing() results", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Twenty Four",
        "listing-test-admin-24@example.com",
      );
      const withPhoto = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Has photo",
        description: "Description",
        priceCents: 500,
      });
      const withoutPhoto = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "No photo",
        description: "Description",
        priceCents: 500,
      });
      if (!withPhoto.ok || !withoutPhoto.ok) throw new Error("expected both listings to be created");
      const photo = await addListingPhoto({
        listingId: withPhoto.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      if (!photo.ok) throw new Error("expected photo to be added");

      const feed = await listListings(community.id, admin.id);
      expect(feed.ok).toBe(true);
      if (!feed.ok) throw new Error("expected success");
      const feedWithPhoto = feed.listings.find((l) => l.id === withPhoto.listing.id);
      const feedWithoutPhoto = feed.listings.find((l) => l.id === withoutPhoto.listing.id);
      expect(feedWithPhoto?.coverPhotoId).toBe(photo.photo.id);
      expect(feedWithoutPhoto?.coverPhotoId).toBeNull();

      const found = await getListing(community.id, withPhoto.listing.id, admin.id);
      expect(found.ok).toBe(true);
      if (!found.ok) throw new Error("expected success");
      expect(found.listing.coverPhotoId).toBe(photo.photo.id);
    });
  });

  describe("updateListing", () => {
    // T015 (US2, FR-006)
    it("lets the owner edit title/description/price, leaving owner/community/status unchanged", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Ten",
        "listing-test-admin-10@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Old title",
        description: "Old description",
        priceCents: 1000,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const result = await updateListing({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        title: "New title",
        description: "New description",
        priceCents: 2000,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.listing.title).toBe("New title");
      expect(result.listing.description).toBe("New description");
      expect(result.listing.priceCents).toBe(2000);
      expect(result.listing.ownerId).toBe(admin.id);
      expect(result.listing.communityId).toBe(community.id);
      expect(result.listing.status).toBe("ACTIVE");
    });

    // T015 (US2, FR-009's carve-out, FR-010)
    it("rejects a non-owner, including that community's own administrator", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Eleven",
        "listing-test-admin-11@example.com",
      );
      const member = await addMember(community.id, "listing-test-member-11@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: member.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const byAdmin = await updateListing({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        title: "Hacked title",
      });
      expect(byAdmin).toEqual({ ok: false, reason: "not_owner" });

      const unchanged = await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } });
      expect(unchanged.title).toBe("Title");
    });
  });

  describe("removeListingPhoto", () => {
    // T016 (US2)
    it("lets the owner remove an existing photo", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Twelve",
        "listing-test-admin-12@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");
      const added = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      if (!added.ok) throw new Error("expected photo to be added");

      const result = await removeListingPhoto({
        listingId: created.listing.id,
        photoId: added.photo.id,
        callerAccountId: admin.id,
      });

      expect(result).toEqual({ ok: true });
      expect(await prisma.listingPhoto.findUnique({ where: { id: added.photo.id } })).toBeNull();
    });

    // T016 (FR-010)
    it("rejects a non-owner attempt", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Thirteen",
        "listing-test-admin-13@example.com",
      );
      const member = await addMember(community.id, "listing-test-member-13@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");
      const added = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      if (!added.ok) throw new Error("expected photo to be added");

      const result = await removeListingPhoto({
        listingId: created.listing.id,
        photoId: added.photo.id,
        callerAccountId: member.id,
      });

      expect(result).toEqual({ ok: false, reason: "not_owner" });
      expect(await prisma.listingPhoto.findUnique({ where: { id: added.photo.id } })).not.toBeNull();
    });
  });

  describe("pauseListing / reactivateListing (owner path)", () => {
    // T023 (US3, FR-007)
    it("lets the owner pause and reactivate, idempotently", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Fourteen",
        "listing-test-admin-14@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const paused = await pauseListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(paused).toEqual({ ok: true });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "PAUSED",
      );

      const pausedAgain = await pauseListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(pausedAgain).toEqual({ ok: true });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "PAUSED",
      );

      const reactivated = await reactivateListing({
        listingId: created.listing.id,
        callerAccountId: admin.id,
      });
      expect(reactivated).toEqual({ ok: true });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "ACTIVE",
      );

      const reactivatedAgain = await reactivateListing({
        listingId: created.listing.id,
        callerAccountId: admin.id,
      });
      expect(reactivatedAgain).toEqual({ ok: true });
    });

    // T023 (FR-007, only the owner in this phase)
    it("rejects a non-owner", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Fifteen",
        "listing-test-admin-15@example.com",
      );
      const member = await addMember(community.id, "listing-test-member-15@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const result = await pauseListing({ listingId: created.listing.id, callerAccountId: member.id });
      expect(result).toEqual({ ok: false, reason: "not_authorized" });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "ACTIVE",
      );
    });
  });

  describe("deleteListing", () => {
    // T028 (US4, FR-008, SC-006)
    it("lets the owner delete a listing with photos, removing every photo too", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Sixteen",
        "listing-test-admin-16@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");
      const added = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      if (!added.ok) throw new Error("expected photo to be added");

      const result = await deleteListing({ listingId: created.listing.id, callerAccountId: admin.id });

      expect(result).toEqual({ ok: true });
      expect(await prisma.listing.findUnique({ where: { id: created.listing.id } })).toBeNull();
      expect(await prisma.listingPhoto.findUnique({ where: { id: added.photo.id } })).toBeNull();
    });

    // T028 (FR-010: never extended to administrators)
    it("rejects a non-owner, including that community's own administrator", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Seventeen",
        "listing-test-admin-17@example.com",
      );
      const member = await addMember(community.id, "listing-test-member-17@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: member.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const result = await deleteListing({ listingId: created.listing.id, callerAccountId: admin.id });

      expect(result).toEqual({ ok: false, reason: "not_owner" });
      expect(await prisma.listing.findUnique({ where: { id: created.listing.id } })).not.toBeNull();
    });
  });

  describe("pauseListing / reactivateListing (administrator moderation)", () => {
    // T033 (US5, FR-009)
    it("lets that community's administrator pause and reactivate a listing they don't own", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Eighteen",
        "listing-test-admin-18@example.com",
      );
      const member = await addMember(community.id, "listing-test-member-18@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: member.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const paused = await pauseListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(paused).toEqual({ ok: true });
      const afterPause = await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } });
      expect(afterPause.status).toBe("PAUSED");
      expect(afterPause.ownerId).toBe(member.id); // ownership unchanged

      // Reactivation is not restricted to whoever paused it — the owner can do it too.
      const reactivated = await reactivateListing({
        listingId: created.listing.id,
        callerAccountId: member.id,
      });
      expect(reactivated).toEqual({ ok: true });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "ACTIVE",
      );
    });

    // T033 (FR-010: moderation is scoped to the administrator's own community only)
    it("rejects an administrator of a different, unrelated community", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Nineteen",
        "listing-test-admin-19@example.com",
      );
      const { admin: otherCommunityAdmin } = await createCommunityWithAdmin(
        "Listing Test Community Nineteen B",
        "listing-test-adminb-19@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Title",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected listing creation to succeed");

      const result = await pauseListing({
        listingId: created.listing.id,
        callerAccountId: otherCommunityAdmin.id,
      });
      expect(result).toEqual({ ok: false, reason: "not_authorized" });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "ACTIVE",
      );
    });
  });

  describe("fulfillListing (011-wanted-posts, US3)", () => {
    // T014 (FR-005, FR-006)
    it("sets FULFILLED for the owner of a WANTED post, idempotently", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Fulfill One",
        "listing-test-fulfill-admin-1@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Looking for a desk",
        description: "Description",
        kind: "WANTED",
      });
      if (!created.ok) throw new Error("expected creation to succeed");

      const fulfilled = await fulfillListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(fulfilled).toEqual({ ok: true });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "FULFILLED",
      );

      const fulfilledAgain = await fulfillListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(fulfilledAgain).toEqual({ ok: true });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "FULFILLED",
      );
    });

    // T014 (FR-005: reachable only for WANTED)
    it("rejects fulfilling a FOR_SALE listing, regardless of caller", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Fulfill Two",
        "listing-test-fulfill-admin-2@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "A regular listing",
        description: "Description",
        priceCents: 500,
      });
      if (!created.ok) throw new Error("expected creation to succeed");

      const result = await fulfillListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(result).toEqual({ ok: false, reason: "not_a_wanted_post" });
    });

    // T014 (FR-008, research.md #3: owner-only, never the administrator)
    it("rejects any account other than the owner, including that community's own administrator", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Fulfill Three",
        "listing-test-fulfill-admin-3@example.com",
      );
      const member = await addMember(community.id, "listing-test-fulfill-member-3@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: member.id,
        title: "Looking for a lamp",
        description: "Description",
        kind: "WANTED",
      });
      if (!created.ok) throw new Error("expected creation to succeed");

      const byAdmin = await fulfillListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(byAdmin).toEqual({ ok: false, reason: "not_owner" });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "ACTIVE",
      );
    });

    // T014 (FR-006: owner can toggle freely, in both directions)
    it("lets the owner reactivate or pause a FULFILLED post back out, freely", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Fulfill Four",
        "listing-test-fulfill-admin-4@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Looking for a mirror",
        description: "Description",
        kind: "WANTED",
      });
      if (!created.ok) throw new Error("expected creation to succeed");
      await fulfillListing({ listingId: created.listing.id, callerAccountId: admin.id });

      const reactivated = await reactivateListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(reactivated).toEqual({ ok: true });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "ACTIVE",
      );

      await fulfillListing({ listingId: created.listing.id, callerAccountId: admin.id });
      const paused = await pauseListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(paused).toEqual({ ok: true });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "PAUSED",
      );
    });

    // T014 (FR-007: deletion cascades photos AND threads, regardless of status)
    it("deleteListing removes a WANTED post's photos and message threads, regardless of status", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Fulfill Five",
        "listing-test-fulfill-admin-5@example.com",
      );
      const buyer = await addMember(community.id, "listing-test-fulfill-buyer-5@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Looking for a rug",
        description: "Description",
        kind: "WANTED",
      });
      if (!created.ok) throw new Error("expected creation to succeed");
      const photo = await addListingPhoto({
        listingId: created.listing.id,
        callerAccountId: admin.id,
        data: JPEG,
        mimeType: "image/jpeg",
      });
      if (!photo.ok) throw new Error("expected photo to be added");
      const thread = await prisma.messageThread.create({
        data: { listingId: created.listing.id, buyerId: buyer.id },
      });
      await prisma.message.create({ data: { threadId: thread.id, senderId: buyer.id, body: "Interested" } });
      await fulfillListing({ listingId: created.listing.id, callerAccountId: admin.id });

      const deleted = await deleteListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(deleted).toEqual({ ok: true });
      expect(await prisma.listing.findUnique({ where: { id: created.listing.id } })).toBeNull();
      expect(await prisma.listingPhoto.findUnique({ where: { id: photo.photo.id } })).toBeNull();
      expect(await prisma.messageThread.findUnique({ where: { id: thread.id } })).toBeNull();
      expect(await prisma.message.count({ where: { threadId: thread.id } })).toBe(0);
    });
  });

  describe("administrator confinement to ACTIVE<->PAUSED (011-wanted-posts, US4, FR-008)", () => {
    // T019
    it("lets the administrator pause/reactivate a WANTED post exactly as a FOR_SALE one", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Confine One",
        "listing-test-confine-admin-1@example.com",
      );
      const member = await addMember(community.id, "listing-test-confine-member-1@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: member.id,
        title: "Looking for a table",
        description: "Description",
        kind: "WANTED",
      });
      if (!created.ok) throw new Error("expected creation to succeed");

      const paused = await pauseListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(paused).toEqual({ ok: true });
      const reactivated = await reactivateListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(reactivated).toEqual({ ok: true });
    });

    // T019 (research.md #3: the case fulfillListing's own owner-only test doesn't cover)
    it("rejects the administrator reactivating or pausing a FULFILLED post — only the owner may", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Confine Two",
        "listing-test-confine-admin-2@example.com",
      );
      const member = await addMember(community.id, "listing-test-confine-member-2@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: member.id,
        title: "Looking for a couch",
        description: "Description",
        kind: "WANTED",
      });
      if (!created.ok) throw new Error("expected creation to succeed");
      await fulfillListing({ listingId: created.listing.id, callerAccountId: member.id });

      const reactivateAttempt = await reactivateListing({
        listingId: created.listing.id,
        callerAccountId: admin.id,
      });
      expect(reactivateAttempt).toEqual({ ok: false, reason: "not_authorized" });

      const pauseAttempt = await pauseListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(pauseAttempt).toEqual({ ok: false, reason: "not_authorized" });

      expect((await prisma.listing.findUniqueOrThrow({ where: { id: created.listing.id } })).status).toBe(
        "FULFILLED",
      );
    });

    // T019 (FR-008: never extends to fulfilling, editing, or deleting)
    it("rejects the administrator fulfilling, editing, or deleting a WANTED post they don't own", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Confine Three",
        "listing-test-confine-admin-3@example.com",
      );
      const member = await addMember(community.id, "listing-test-confine-member-3@example.com");
      const created = await createListing({
        communityId: community.id,
        ownerId: member.id,
        title: "Looking for a shelf",
        description: "Description",
        kind: "WANTED",
      });
      if (!created.ok) throw new Error("expected creation to succeed");

      expect(await fulfillListing({ listingId: created.listing.id, callerAccountId: admin.id })).toEqual({
        ok: false,
        reason: "not_owner",
      });
      expect(
        await updateListing({ listingId: created.listing.id, callerAccountId: admin.id, title: "Hacked" }),
      ).toEqual({ ok: false, reason: "not_owner" });
      expect(await deleteListing({ listingId: created.listing.id, callerAccountId: admin.id })).toEqual({
        ok: false,
        reason: "not_owner",
      });
      expect(await prisma.listing.findUnique({ where: { id: created.listing.id } })).not.toBeNull();
    });

    // T019 (FR-009: no authority at all outside the administrator's own community)
    it("rejects an administrator of a different, unrelated community entirely", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Confine Four",
        "listing-test-confine-admin-4@example.com",
      );
      const { admin: otherAdmin } = await createCommunityWithAdmin(
        "Listing Test Community Confine Four B",
        "listing-test-confine-adminb-4@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Looking for a stool",
        description: "Description",
        kind: "WANTED",
      });
      if (!created.ok) throw new Error("expected creation to succeed");

      const result = await pauseListing({ listingId: created.listing.id, callerAccountId: otherAdmin.id });
      expect(result).toEqual({ ok: false, reason: "not_authorized" });
    });
  });

  describe("listMyListings (2026-07-17 amendment, FR-021, FR-022, FR-024)", () => {
    // T028
    it("shows every owned listing, any status, across current communities, with a database-computed thread count", async () => {
      const { community: communityA, admin: ownerA } = await createCommunityWithAdmin(
        "Listing Test Community Twenty Seven A",
        "listing-test-ownera-27@example.com",
      );
      const { community: communityB } = await createCommunityWithAdmin(
        "Listing Test Community Twenty Seven B",
        "listing-test-ownerb-27@example.com",
      );
      await prisma.membership.create({
        data: { accountId: ownerA.id, communityId: communityB.id, role: "MEMBER" },
      });

      const activeListing = await createListing({
        communityId: communityA.id,
        ownerId: ownerA.id,
        title: "Active item",
        description: "Description",
        priceCents: 1000,
      });
      const pausedListing = await createListing({
        communityId: communityA.id,
        ownerId: ownerA.id,
        title: "Paused item",
        description: "Description",
        priceCents: 2000,
      });
      const listingInB = await createListing({
        communityId: communityB.id,
        ownerId: ownerA.id,
        title: "B item",
        description: "Description",
        priceCents: 3000,
      });
      if (!activeListing.ok || !pausedListing.ok || !listingInB.ok) {
        throw new Error("expected all three listings to be created");
      }
      await pauseListing({ listingId: pausedListing.listing.id, callerAccountId: ownerA.id });

      // Two threads on the active listing (via direct rows — messageService.ts is exercised elsewhere).
      const buyer = await addMember(communityA.id, "listing-test-buyer-27@example.com");
      const otherBuyer = await addMember(communityA.id, "listing-test-other-buyer-27@example.com");
      await prisma.messageThread.create({
        data: { listingId: activeListing.listing.id, buyerId: buyer.id },
      });
      await prisma.messageThread.create({
        data: { listingId: activeListing.listing.id, buyerId: otherBuyer.id },
      });

      const result = await listMyListings(ownerA.id);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");

      const byId = new Map(result.listings.map((l) => [l.id, l]));
      expect(byId.get(activeListing.listing.id)).toMatchObject({ status: "ACTIVE", threadCount: 2 });
      expect(byId.get(pausedListing.listing.id)).toMatchObject({ status: "PAUSED", threadCount: 0 });
      expect(byId.get(listingInB.listing.id)).toMatchObject({ status: "ACTIVE", threadCount: 0 });
      expect(result.listings).toHaveLength(3);

      // Losing membership in Community A removes both of its listings from the aggregate.
      await prisma.membership.delete({
        where: { accountId_communityId: { accountId: ownerA.id, communityId: communityA.id } },
      });
      const afterLeavingA = await listMyListings(ownerA.id);
      expect(afterLeavingA.ok).toBe(true);
      if (!afterLeavingA.ok) throw new Error("expected success");
      expect(afterLeavingA.listings.map((l) => l.id)).toEqual([listingInB.listing.id]);
    });

    // T028 (Edge Cases)
    it("returns an empty list for an account with no owned listings", async () => {
      const { community } = await createCommunityWithAdmin(
        "Listing Test Community Twenty Eight",
        "listing-test-admin-28@example.com",
      );
      const nonOwner = await addMember(community.id, "listing-test-nonowner-28@example.com");

      const result = await listMyListings(nonOwner.id);
      expect(result).toEqual({ ok: true, listings: [] });
    });
  });

  // 009-platform-administration, User Story 8: FR-052/FR-053/FR-054's exact gating table.
  describe("suspended-community gating (FR-052, FR-053, FR-054)", () => {
    it("viewing an existing ACTIVE listing tolerates SUSPENDED, but creating a new one is blocked", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Suspend One",
        "listing-test-suspend-admin-1@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Pre-suspension listing",
        description: "d",
        priceCents: 100,
      });
      if (!created.ok) throw new Error("setup failed");

      await prisma.community.update({ where: { id: community.id }, data: { status: "SUSPENDED" } });

      const viewed = await getListing(community.id, created.listing.id, admin.id);
      expect(viewed.ok).toBe(true);

      const listed = await listListings(community.id, admin.id);
      expect(listed.ok).toBe(true);
      if (listed.ok) expect(listed.listings.map((l) => l.id)).toContain(created.listing.id);

      const blockedCreate = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "New listing while suspended",
        description: "d",
        priceCents: 100,
      });
      expect(blockedCreate).toEqual({ ok: false, reason: "not_a_member" });
    });

    it("pausing an existing listing is allowed while SUSPENDED, but reactivating it is blocked", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Suspend Two",
        "listing-test-suspend-admin-2@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Listing to pause",
        description: "d",
        priceCents: 100,
      });
      if (!created.ok) throw new Error("setup failed");

      await prisma.community.update({ where: { id: community.id }, data: { status: "SUSPENDED" } });

      const paused = await pauseListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(paused).toEqual({ ok: true });

      const blockedReactivate = await reactivateListing({ listingId: created.listing.id, callerAccountId: admin.id });
      expect(blockedReactivate).toEqual({ ok: false, reason: "community_not_active" });
    });

    it("editing listing content (title/photos/cover) is blocked while SUSPENDED", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Suspend Three",
        "listing-test-suspend-admin-3@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Listing to edit",
        description: "d",
        priceCents: 100,
      });
      if (!created.ok) throw new Error("setup failed");

      await prisma.community.update({ where: { id: community.id }, data: { status: "SUSPENDED" } });

      expect(
        await updateListing({ listingId: created.listing.id, callerAccountId: admin.id, title: "New title" }),
      ).toEqual({ ok: false, reason: "community_not_active" });
      expect(
        await addListingPhoto({
          listingId: created.listing.id,
          callerAccountId: admin.id,
          data: JPEG,
          mimeType: "image/jpeg",
        }),
      ).toEqual({ ok: false, reason: "community_not_active" });
    });

    it("every ordinary listing path denies access to an ARCHIVED community", async () => {
      const { community, admin } = await createCommunityWithAdmin(
        "Listing Test Community Archived One",
        "listing-test-archived-admin-1@example.com",
      );
      const created = await createListing({
        communityId: community.id,
        ownerId: admin.id,
        title: "Pre-archive listing",
        description: "d",
        priceCents: 100,
      });
      if (!created.ok) throw new Error("setup failed");

      await prisma.community.update({ where: { id: community.id }, data: { status: "ARCHIVED" } });

      expect(await getListing(community.id, created.listing.id, admin.id)).toEqual({
        ok: false,
        reason: "not_a_member",
      });
      expect((await listListings(community.id, admin.id)).ok).toBe(false);
    });
  });
});
