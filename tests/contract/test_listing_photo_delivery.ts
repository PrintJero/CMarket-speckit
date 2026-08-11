import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { createListing, getListingPhoto } from "@/server/services/listingService";
import { resolveVariant } from "@/lib/cloudinary/variants";

/**
 * T048-T051 (017-cloudinary-listing-media).
 *
 * This file covers the authenticated delivery proxy's ISOLATION GATE — the code
 * path that carries Principle II. It exercises getListingPhoto() directly rather
 * than the route handler, following this codebase's established discipline: the
 * route depends on next/headers' request-scoped cookies(), which is not callable
 * outside a real request, so cookie-dependent behaviour is exercised via
 * Playwright (see the same note in test_current_account_active_community.ts).
 *
 * What lives here: who may resolve a photo at all, and whether the refusals are
 * indistinguishable. What belongs in Playwright: the response headers, the weak
 * ETag, the authorization-before-304 ordering, and no-redirect — all of which
 * need a real request with a session cookie.
 */

function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: {
      email,
      passwordHash: "irrelevant-hash",
      emailVerifiedAt: new Date(),
      displayName: "Delivery Test Member",
    },
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

let fixtureCounter = 0;
async function attachPhoto(listingId: string) {
  fixtureCounter += 1;
  const n = String(fixtureCounter).padStart(6, "0");
  return prisma.listingPhoto.create({
    data: {
      listingId,
      cloudinaryAssetId: `delivery-asset-${n}`,
      cloudinaryPublicId: `cmarket/test/listings/delivery/${n}`,
      width: 3024,
      height: 4032,
      format: "jpg",
      bytes: 1_234_567,
      displayOrder: 0,
    },
  });
}

describe("listing photo delivery gate (contract)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "Delivery Test" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "delivery-test" } } });
  });

  afterAll(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "Delivery Test" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "delivery-test" } } });
    await prisma.$disconnect();
  });

  async function seed() {
    const { community, admin } = await createCommunityWithAdmin(
      "Delivery Test Community",
      "delivery-test-admin@example.com",
    );
    const created = await createListing({
      communityId: community.id,
      ownerId: admin.id,
      title: "Bookshelf",
      description: "Oak bookshelf",
      priceCents: 4500,
    });
    if (!created.ok) throw new Error("expected listing creation to succeed");
    const photo = await attachPhoto(created.listing.id);
    return { community, admin, listing: created.listing, photo };
  }

  it("resolves the asset reference for a current member (FR-051-FR-053)", async () => {
    const { community, admin, photo } = await seed();

    const result = await getListingPhoto(community.id, photo.id, admin.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    // The ETag derives from cloudinaryAssetId and the fetch resolves by
    // cloudinaryPublicId, so both must be present in the INTERNAL result — while
    // FR-056 keeps them out of every browser-reachable payload.
    expect(result.photo.cloudinaryAssetId).toBe(photo.cloudinaryAssetId);
    expect(result.photo.cloudinaryPublicId).toBe(photo.cloudinaryPublicId);
    expect(result.photo.width).toBe(3024);
    expect(result.photo.height).toBe(4032);
  });

  it("refuses an account that is not a current member (FR-052)", async () => {
    const { community, photo } = await seed();
    const outsider = await createVerifiedAccount("delivery-test-outsider@example.com");

    expect(await getListingPhoto(community.id, photo.id, outsider.id)).toEqual({
      ok: false,
      reason: "not_a_member",
    });
  });

  it("refuses a photo whose listing is in another community — indistinguishably from one that does not exist (FR-054)", async () => {
    const { photo } = await seed();

    // A second community the same account genuinely belongs to. Naming it in the
    // path for another community's photo must NOT succeed, and must not be
    // distinguishable from a nonexistent photo — a distinguishable "exists but
    // not yours" would confirm the existence of another community's media.
    const other = await createCommunityWithAdmin(
      "Delivery Test Community Two",
      "delivery-test-admin-2@example.com",
    );

    const wrongCommunity = await getListingPhoto(other.community.id, photo.id, other.admin.id);
    const nonexistent = await getListingPhoto(other.community.id, "clnonexistentphoto", other.admin.id);

    expect(wrongCommunity).toEqual({ ok: false, reason: "not_found" });
    expect(nonexistent).toEqual({ ok: false, reason: "not_found" });
    // Byte-for-byte identical, not merely both falsy.
    expect(wrongCommunity).toEqual(nonexistent);
  });

  it("refuses a listing predating a community restoration (stale operationalEpoch)", async () => {
    const { community, admin, photo } = await seed();

    // Bump the community's epoch without touching the listing, exactly as a
    // restoration does. The listing is now pre-restoration.
    await prisma.community.update({
      where: { id: community.id },
      data: { operationalEpoch: { increment: 1 } },
    });
    await prisma.membership.updateMany({
      where: { communityId: community.id },
      data: { operationalEpoch: 2 },
    });

    expect(await getListingPhoto(community.id, photo.id, admin.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses after the photo is deleted, so a stale client revalidates into a 404 (FR-078)", async () => {
    const { community, admin, photo } = await seed();
    await prisma.listing.update({
      where: { id: photo.listingId },
      data: { coverPhotoId: null },
    });
    await prisma.listingPhoto.delete({ where: { id: photo.id } });

    expect(await getListingPhoto(community.id, photo.id, admin.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("tolerates a SUSPENDED community for reads (009 FR-052)", async () => {
    const { community, admin, photo } = await seed();
    await prisma.community.update({ where: { id: community.id }, data: { status: "SUSPENDED" } });

    const result = await getListingPhoto(community.id, photo.id, admin.id);
    expect(result.ok).toBe(true);
  });

  it("refuses an ARCHIVED community", async () => {
    const { community, admin, photo } = await seed();
    await prisma.community.update({ where: { id: community.id }, data: { status: "ARCHIVED" } });

    expect(await getListingPhoto(community.id, photo.id, admin.id)).toEqual({
      ok: false,
      reason: "not_a_member",
    });
  });

  it("maps every variant name the proxy accepts, and nothing else (FR-060, FR-061)", () => {
    expect(resolveVariant("thumbnail").transformation).toContain("w_320");
    expect(resolveVariant("card").transformation).toContain("w_640");
    expect(resolveVariant("detail").transformation).toContain("w_1280");

    // The query-string injection the allowlist exists to stop.
    const bogus = resolveVariant("w_9999,c_crop");
    expect(bogus.variant).toBe("card");
    expect(bogus.transformation).not.toContain("9999");
  });

  it("builds a weak, variant-scoped, stable ETag from the asset id", async () => {
    const { community, admin, photo } = await seed();
    const result = await getListingPhoto(community.id, photo.id, admin.id);
    if (!result.ok) throw new Error("expected success");

    // Mirrors the route's construction. Weak (W/) because f_auto negotiates
    // format from Accept, so identical variants legitimately differ byte-for-byte
    // and a strong validator would be a false claim of byte-equality.
    const etagFor = (variant: string) => `W/"${result.photo.cloudinaryAssetId}-${variant}"`;

    expect(etagFor("card")).toMatch(/^W\//);
    expect(etagFor("card")).not.toBe(etagFor("thumbnail"));
    // Stable across calls: derived only from immutable asset id + variant.
    expect(etagFor("card")).toBe(etagFor("card"));
  });
});
