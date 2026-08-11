import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCommunity } from "@/server/services/communityService";
import { createListing, removeListingPhoto } from "@/server/services/listingService";
import {
  associatePhotos,
  authorizeUpload,
  reorderPhotos,
} from "@/server/services/listingMediaService";
import * as cloudinaryAdmin from "@/lib/cloudinary/admin";
import {
  UPLOAD_SIGNATURE_EXCLUDED_PARAMS,
  buildUploadStringToSign,
} from "@/lib/cloudinary/signature";

/**
 * T020, T021, T032-T034, T064-T067, T085 (017-cloudinary-listing-media).
 *
 * Covers the SERVICE-LEVEL contract of upload authorization, association,
 * ordering, and cover selection.
 *
 * Two gates deliberately live at the ROUTE layer and are therefore not asserted
 * here: `401` for an unauthenticated caller and `403 not_authorized` for a
 * MASTER both depend on next/headers' request-scoped cookies(), which is not
 * callable outside a real request. This codebase exercises cookie-dependent
 * behaviour via Playwright (see the same note in
 * test_current_account_active_community.ts). What IS asserted here is everything
 * reachable without a cookie: membership, ownership, provenance, the caps, the
 * ordering invariants, and the signed-parameter set.
 *
 * verifyAsset is stubbed throughout — no test contacts Cloudinary (research.md #8).
 */

const ACTIVE_ASSET = {
  width: 3024,
  height: 4032,
  format: "jpg",
  bytes: 2_345_678,
};

function stubVerifyOk() {
  return vi
    .spyOn(cloudinaryAdmin, "verifyAsset")
    .mockImplementation(async (publicId: string) => ({
      ok: true as const,
      asset: { assetId: `asset-for-${publicId}`, publicId, ...ACTIVE_ASSET },
    }));
}

function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: {
      email,
      passwordHash: "irrelevant-hash",
      emailVerifiedAt: new Date(),
      displayName: "Media Test Member",
    },
  });
}

async function seed(suffix: string) {
  const admin = await createVerifiedAccount(`media-test-${suffix}@example.com`);
  const result = await createCommunity({
    name: `Media Test Community ${suffix}`,
    founderEmail: admin.email,
    invokedBy: "test-operator",
  });
  if (!result.ok) throw new Error("expected community creation to succeed");
  const created = await createListing({
    communityId: result.community.id,
    ownerId: admin.id,
    title: "Desk",
    description: "Standing desk",
    priceCents: 25_000,
  });
  if (!created.ok) throw new Error("expected listing creation to succeed");
  return { admin, community: result.community, listing: created.listing };
}

/** Authorize N files for a draft and return their issued public IDs. */
async function authorizeMany(
  accountId: string,
  communityId: string,
  draftId: string,
  count: number,
  listingId?: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = await authorizeUpload({ accountId, communityId, draftId, listingId });
    if (!result.ok) throw new Error(`expected authorization to succeed, got ${result.reason}`);
    ids.push(result.upload.publicId);
  }
  return ids;
}

async function resetFixtures() {
  await prisma.mediaCleanupTask.deleteMany({
    where: { cloudinaryPublicId: { contains: "/listings/" } },
  });
  await prisma.pendingListingMedia.deleteMany({
    where: { draftId: { contains: "media-draft" } },
  });
  await prisma.community.deleteMany({ where: { name: { contains: "Media Test Community" } } });
  await prisma.account.deleteMany({ where: { email: { contains: "media-test-" } } });
}

describe("listing media service (contract)", () => {
  beforeEach(resetFixtures);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await resetFixtures();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------- T020 ----
  describe("authorizeUpload — initial mode", () => {
    it("returns signed params with NO folder field, and writes exactly one pending row", async () => {
      const { admin, community } = await seed("auth-initial");

      const result = await authorizeUpload({
        accountId: admin.id,
        communityId: community.id,
        draftId: "media-draft-1",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");

      expect(result.upload.url).toContain("/image/upload");
      expect(result.upload.apiKey).toBeTruthy();
      expect(result.upload.signature).toMatch(/^[0-9a-f]{64}$/);
      expect(result.upload.type).toBe("authenticated");
      expect(result.upload.context).toBe(`account=${admin.id}|draft=media-draft-1`);
      // research.md #5: the complete public ID carries the path; sending `folder`
      // as well would make behaviour depend on the account's folder mode.
      expect(result.upload).not.toHaveProperty("folder");
      // The API secret has no business in a browser-reachable payload.
      expect(JSON.stringify(result.upload)).not.toContain(
        process.env.CLOUDINARY_API_SECRET ?? "__unset__",
      );

      const pending = await prisma.pendingListingMedia.findMany({
        where: { accountId: admin.id, draftId: "media-draft-1" },
      });
      expect(pending).toHaveLength(1);
      expect(pending[0].cloudinaryPublicId).toBe(result.upload.publicId);

      // ~30 minutes out, comfortably beyond the client's 10-minute refresh
      // threshold so a refresh always has a valid row to match.
      const ttlMinutes = (pending[0].expiresAt.getTime() - Date.now()) / 60_000;
      expect(ttlMinutes).toBeGreaterThan(25);
      expect(ttlMinutes).toBeLessThanOrEqual(30);
    });

    it("never returns an incomplete credential set — an empty api_key silently becomes an UNSIGNED upload", async () => {
      const { admin, community } = await seed("auth-complete");

      const result = await authorizeUpload({
        accountId: admin.id,
        communityId: community.id,
        draftId: "media-draft-complete",
      });
      if (!result.ok) throw new Error("expected success");

      // Cloudinary decides signed vs unsigned by whether api_key is PRESENT. An
      // empty string is treated as absent, and the upload then fails with
      // "Upload preset must be specified when using unsigned upload" — an error
      // that names nothing useful. Every field must be non-empty.
      for (const key of ["url", "apiKey", "signature", "publicId", "type", "context"] as const) {
        expect(result.upload[key], `${key} must be non-empty`).toBeTruthy();
        expect(String(result.upload[key]).trim(), `${key} must not be blank`).not.toBe("");
      }
      expect(result.upload.timestamp).toBeGreaterThan(0);
      // A hex SHA-256 digest, not a truncated delivery signature.
      expect(result.upload.signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it("scopes the public ID to environment, listings, and draft (FR-102, FR-103)", async () => {
      const { admin, community } = await seed("auth-prefix");

      const result = await authorizeUpload({
        accountId: admin.id,
        communityId: community.id,
        draftId: "media-draft-prefix",
      });
      if (!result.ok) throw new Error("expected success");

      expect(result.upload.publicId).toMatch(
        /^cmarket\/test\/listings\/media-draft-prefix\/[0-9a-f]{32}$/,
      );
    });

    it("rejects malformed input and a listingId that disagrees with draftId", async () => {
      const { admin, community } = await seed("auth-invalid");

      expect(
        await authorizeUpload({ accountId: admin.id, communityId: "", draftId: "media-draft-x" }),
      ).toEqual({ ok: false, reason: "invalid_input" });

      expect(
        await authorizeUpload({
          accountId: admin.id,
          communityId: community.id,
          draftId: "media-draft-x",
          listingId: "a-different-id",
        }),
      ).toEqual({ ok: false, reason: "invalid_input" });
    });

    it("refuses a non-member (FR-027)", async () => {
      const { community } = await seed("auth-nonmember");
      const outsider = await createVerifiedAccount("media-test-outsider@example.com");

      expect(
        await authorizeUpload({
          accountId: outsider.id,
          communityId: community.id,
          draftId: "media-draft-out",
        }),
      ).toEqual({ ok: false, reason: "not_a_member" });
    });

    it("refuses a non-owner on the edit path (FR-028)", async () => {
      const { community, listing } = await seed("auth-nonowner");
      const other = await createVerifiedAccount("media-test-other@example.com");
      await prisma.membership.create({
        data: { accountId: other.id, communityId: community.id, role: "MEMBER" },
      });

      expect(
        await authorizeUpload({
          accountId: other.id,
          communityId: community.id,
          draftId: listing.id,
          listingId: listing.id,
        }),
      ).toEqual({ ok: false, reason: "not_owner" });
    });

    it("refuses the 9th file across associated plus pending (FR-004)", async () => {
      const { admin, community, listing } = await seed("auth-cap");

      await authorizeMany(admin.id, community.id, listing.id, 8, listing.id);

      expect(
        await authorizeUpload({
          accountId: admin.id,
          communityId: community.id,
          draftId: listing.id,
          listingId: listing.id,
        }),
      ).toEqual({ ok: false, reason: "photo_limit_reached" });
    });
  });

  // ------------------------------------------------- T020 (retry mode) ----
  describe("authorizeUpload — retry mode", () => {
    it("reuses the SAME public id, writes no second row, and does not re-count the cap", async () => {
      const { admin, community, listing } = await seed("auth-retry");

      // Fill the listing to the cap, so a re-count would be visible as a failure.
      const issued = await authorizeMany(admin.id, community.id, listing.id, 8, listing.id);
      const target = issued[7];

      const retry = await authorizeUpload({
        accountId: admin.id,
        communityId: community.id,
        draftId: listing.id,
        listingId: listing.id,
        publicId: target,
      });

      expect(retry.ok).toBe(true);
      if (!retry.ok) throw new Error("expected retry to succeed");

      // Without retry mode, retrying the eighth photo would fail with
      // photo_limit_reached for no reason the member could understand.
      expect(retry.upload.publicId).toBe(target);
      expect(
        await prisma.pendingListingMedia.count({
          where: { accountId: admin.id, draftId: listing.id },
        }),
      ).toBe(8);
    });

    it("issues a fresh timestamp and signature for the same asset", async () => {
      const { admin, community } = await seed("auth-retry-fresh");
      const [publicId] = await authorizeMany(admin.id, community.id, "media-draft-fresh", 1);

      const first = await authorizeUpload({
        accountId: admin.id,
        communityId: community.id,
        draftId: "media-draft-fresh",
        publicId,
      });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const second = await authorizeUpload({
        accountId: admin.id,
        communityId: community.id,
        draftId: "media-draft-fresh",
        publicId,
      });

      if (!first.ok || !second.ok) throw new Error("expected both to succeed");
      expect(second.upload.publicId).toBe(first.upload.publicId);
      expect(second.upload.timestamp).toBeGreaterThan(first.upload.timestamp);
      expect(second.upload.signature).not.toBe(first.upload.signature);
    });

    it("refuses a pending row belonging to another account or another draft", async () => {
      const { admin, community } = await seed("auth-retry-foreign");
      const [publicId] = await authorizeMany(admin.id, community.id, "media-draft-owner", 1);

      const thief = await createVerifiedAccount("media-test-thief@example.com");
      await prisma.membership.create({
        data: { accountId: thief.id, communityId: community.id, role: "MEMBER" },
      });

      expect(
        await authorizeUpload({
          accountId: thief.id,
          communityId: community.id,
          draftId: "media-draft-owner",
          publicId,
        }),
      ).toEqual({ ok: false, reason: "unauthorized_asset" });

      expect(
        await authorizeUpload({
          accountId: admin.id,
          communityId: community.id,
          draftId: "media-draft-other",
          publicId,
        }),
      ).toEqual({ ok: false, reason: "unauthorized_asset" });
    });

    it("refuses an expired pending row, and an unknown public id", async () => {
      const { admin, community } = await seed("auth-retry-expired");
      const [publicId] = await authorizeMany(admin.id, community.id, "media-draft-exp", 1);

      await prisma.pendingListingMedia.update({
        where: { cloudinaryPublicId: publicId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect(
        await authorizeUpload({
          accountId: admin.id,
          communityId: community.id,
          draftId: "media-draft-exp",
          publicId,
        }),
      ).toEqual({ ok: false, reason: "authorization_expired" });

      expect(
        await authorizeUpload({
          accountId: admin.id,
          communityId: community.id,
          draftId: "media-draft-exp",
          publicId: "cmarket/test/listings/media-draft-exp/never-issued",
        }),
      ).toEqual({ ok: false, reason: "unauthorized_asset" });
    });
  });

  // ---------------------------------------------------------------- T021 ----
  describe("associatePhotos", () => {
    it("creates contiguous rows from 0 in the CHOSEN order and consumes the pending rows", async () => {
      stubVerifyOk();
      const { admin, community, listing } = await seed("assoc-order");
      const ids = await authorizeMany(admin.id, community.id, listing.id, 3, listing.id);

      // Deliberately submitted in an order unrelated to issuance order — this is
      // what makes FR-017/SC-003 hold.
      const result = await associatePhotos({
        accountId: admin.id,
        listingId: listing.id,
        draftId: listing.id,
        photos: [
          { publicId: ids[2], displayOrder: 0 },
          { publicId: ids[0], displayOrder: 1 },
          { publicId: ids[1], displayOrder: 2 },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.photos.map((p) => p.displayOrder)).toEqual([0, 1, 2]);

      const rows = await prisma.listingPhoto.findMany({
        where: { listingId: listing.id },
        orderBy: { displayOrder: "asc" },
      });
      expect(rows.map((r) => r.cloudinaryPublicId)).toEqual([ids[2], ids[0], ids[1]]);

      // The response is a listing read: no Cloudinary identifier may appear.
      expect(JSON.stringify(result.photos)).not.toContain("cmarket/test");

      expect(
        await prisma.pendingListingMedia.count({ where: { draftId: listing.id } }),
      ).toBe(0);
    });

    it("makes displayOrder 0 the cover when none is chosen, and honours an explicit cover (FR-016)", async () => {
      stubVerifyOk();
      const { admin, community, listing } = await seed("assoc-cover");
      const ids = await authorizeMany(admin.id, community.id, listing.id, 2, listing.id);

      const implicit = await associatePhotos({
        accountId: admin.id,
        listingId: listing.id,
        draftId: listing.id,
        photos: [
          { publicId: ids[0], displayOrder: 0 },
          { publicId: ids[1], displayOrder: 1 },
        ],
      });
      if (!implicit.ok) throw new Error("expected success");
      expect(implicit.photos.filter((p) => p.isCover)).toHaveLength(1);
      expect(implicit.photos.find((p) => p.isCover)?.displayOrder).toBe(0);

      const explicit = await associatePhotos({
        accountId: admin.id,
        listingId: listing.id,
        draftId: listing.id,
        photos: [
          { publicId: ids[0], displayOrder: 0 },
          { publicId: ids[1], displayOrder: 1 },
        ],
        coverPublicId: ids[1],
      });
      if (!explicit.ok) throw new Error("expected success");
      // Exactly one cover, and nothing duplicated or removed by the change.
      expect(explicit.photos.filter((p) => p.isCover)).toHaveLength(1);
      expect(explicit.photos.find((p) => p.isCover)?.displayOrder).toBe(1);
      expect(explicit.photos).toHaveLength(2);
    });

    it("is idempotent — resubmitting the same assets creates no duplicates (FR-019)", async () => {
      stubVerifyOk();
      const { admin, community, listing } = await seed("assoc-idem");
      const ids = await authorizeMany(admin.id, community.id, listing.id, 2, listing.id);
      const payload = {
        accountId: admin.id,
        listingId: listing.id,
        draftId: listing.id,
        photos: [
          { publicId: ids[0], displayOrder: 0 },
          { publicId: ids[1], displayOrder: 1 },
        ],
      };

      expect((await associatePhotos(payload)).ok).toBe(true);
      // A double-submitted form. cloudinaryPublicId @unique makes this structural.
      expect((await associatePhotos(payload)).ok).toBe(true);

      expect(await prisma.listingPhoto.count({ where: { listingId: listing.id } })).toBe(2);
    });

    it("rejects a duplicate public id within one payload, and a cover not in the set", async () => {
      stubVerifyOk();
      const { admin, community, listing } = await seed("assoc-bad");
      const ids = await authorizeMany(admin.id, community.id, listing.id, 1, listing.id);

      expect(
        await associatePhotos({
          accountId: admin.id,
          listingId: listing.id,
          draftId: listing.id,
          photos: [
            { publicId: ids[0], displayOrder: 0 },
            { publicId: ids[0], displayOrder: 1 },
          ],
        }),
      ).toEqual({ ok: false, reason: "invalid_input" });

      expect(
        await associatePhotos({
          accountId: admin.id,
          listingId: listing.id,
          draftId: listing.id,
          photos: [{ publicId: ids[0], displayOrder: 0 }],
          coverPublicId: "cmarket/test/listings/elsewhere/abc",
        }),
      ).toEqual({ ok: false, reason: "invalid_input" });
    });

    it("refuses more than eight in one payload (FR-004)", async () => {
      stubVerifyOk();
      const { admin, community, listing } = await seed("assoc-cap");
      const ids = await authorizeMany(admin.id, community.id, listing.id, 8, listing.id);

      expect(
        await associatePhotos({
          accountId: admin.id,
          listingId: listing.id,
          draftId: listing.id,
          photos: [
            ...ids.map((publicId, index) => ({ publicId, displayOrder: index })),
            { publicId: "cmarket/test/listings/x/ninth", displayOrder: 8 },
          ],
        }),
      ).toEqual({ ok: false, reason: "photo_limit_reached" });
    });

    it("refuses an oversized asset at association and queues it for deletion (FR-006, FR-033)", async () => {
      // The authoritative size check. It lives here rather than in the upload
      // signature because Cloudinary's max_file_size is an upload-PRESET
      // setting, not a signable request parameter — signing it makes every
      // upload fail with "Invalid Signature" (verified against the live
      // service). Checking the byte count Cloudinary reports is stronger than
      // trusting the client: a bypassed browser cannot get an oversized asset
      // associated, and the asset does not linger.
      vi.spyOn(cloudinaryAdmin, "verifyAsset").mockImplementation(async (publicId: string) => ({
        ok: true as const,
        asset: {
          assetId: `oversized-${publicId}`,
          publicId,
          ...ACTIVE_ASSET,
          bytes: 11 * 1024 * 1024,
        },
      }));

      const { admin, community, listing } = await seed("assoc-oversize");
      const ids = await authorizeMany(admin.id, community.id, listing.id, 1, listing.id);

      expect(
        await associatePhotos({
          accountId: admin.id,
          listingId: listing.id,
          draftId: listing.id,
          photos: [{ publicId: ids[0], displayOrder: 0 }],
        }),
      ).toEqual({ ok: false, reason: "file_too_large" });

      // Never becomes listing media...
      expect(await prisma.listingPhoto.count({ where: { listingId: listing.id } })).toBe(0);
      // ...and does not linger in Cloudinary either.
      expect(
        await prisma.mediaCleanupTask.count({ where: { cloudinaryPublicId: ids[0] } }),
      ).toBe(1);
      // The pending row is consumed, so a resubmit cannot retry the same
      // oversized asset.
      expect(
        await prisma.pendingListingMedia.count({ where: { cloudinaryPublicId: ids[0] } }),
      ).toBe(0);
    });

    it("returns asset_not_found when Cloudinary does not recognise the asset", async () => {
      vi.spyOn(cloudinaryAdmin, "verifyAsset").mockResolvedValue({
        ok: false,
        reason: "not_found",
      });
      const { admin, community, listing } = await seed("assoc-missing");
      const ids = await authorizeMany(admin.id, community.id, listing.id, 1, listing.id);

      expect(
        await associatePhotos({
          accountId: admin.id,
          listingId: listing.id,
          draftId: listing.id,
          photos: [{ publicId: ids[0], displayOrder: 0 }],
        }),
      ).toEqual({ ok: false, reason: "asset_not_found" });

      expect(await prisma.listingPhoto.count({ where: { listingId: listing.id } })).toBe(0);
    });

    it("leaves pending rows INTACT when Cloudinary is unavailable, so a resubmit needs no re-upload (FR-077)", async () => {
      vi.spyOn(cloudinaryAdmin, "verifyAsset").mockResolvedValue({
        ok: false,
        reason: "unavailable",
      });
      const { admin, community, listing } = await seed("assoc-outage");
      const ids = await authorizeMany(admin.id, community.id, listing.id, 2, listing.id);

      expect(
        await associatePhotos({
          accountId: admin.id,
          listingId: listing.id,
          draftId: listing.id,
          photos: ids.map((publicId, index) => ({ publicId, displayOrder: index })),
        }),
      ).toEqual({ ok: false, reason: "provider_unavailable" });

      // The member's successful uploads are not lost — this is the whole point.
      expect(await prisma.pendingListingMedia.count({ where: { draftId: listing.id } })).toBe(2);

      // And the resubmit succeeds once the provider recovers.
      stubVerifyOk();
      const retry = await associatePhotos({
        accountId: admin.id,
        listingId: listing.id,
        draftId: listing.id,
        photos: ids.map((publicId, index) => ({ publicId, displayOrder: index })),
      });
      expect(retry.ok).toBe(true);
    });
  });

  // ------------------------------------------------------- T064-T067 ----
  describe("authorization and provenance", () => {
    it("refuses a forged public id that has no pending row (FR-031)", async () => {
      stubVerifyOk();
      const { admin, listing } = await seed("prov-forged");

      const result = await associatePhotos({
        accountId: admin.id,
        listingId: listing.id,
        draftId: listing.id,
        photos: [{ publicId: "cmarket/test/listings/someone-else/deadbeef", displayOrder: 0 }],
      });

      expect(result).toEqual({ ok: false, reason: "unauthorized_asset" });
      expect(await prisma.listingPhoto.count({ where: { listingId: listing.id } })).toBe(0);
    });

    it("refuses a pending row owned by a DIFFERENT account — the match is on accountId, not draftId alone (FR-030)", async () => {
      stubVerifyOk();
      const { admin, community, listing } = await seed("prov-crossaccount");
      const [victimPublicId] = await authorizeMany(admin.id, community.id, listing.id, 1, listing.id);

      const attacker = await createVerifiedAccount("media-test-attacker@example.com");
      await prisma.membership.create({
        data: { accountId: attacker.id, communityId: community.id, role: "MEMBER" },
      });
      const attackerListing = await createListing({
        communityId: community.id,
        ownerId: attacker.id,
        title: "Attacker listing",
        description: "x",
        priceCents: 100,
      });
      if (!attackerListing.ok) throw new Error("expected creation to succeed");

      // The attacker knows the victim's public ID and supplies their own draftId.
      const result = await associatePhotos({
        accountId: attacker.id,
        listingId: attackerListing.listing.id,
        draftId: attackerListing.listing.id,
        photos: [{ publicId: victimPublicId, displayOrder: 0 }],
      });

      expect(result).toEqual({ ok: false, reason: "unauthorized_asset" });
      expect(
        await prisma.listingPhoto.count({ where: { listingId: attackerListing.listing.id } }),
      ).toBe(0);
    });

    it("refuses association by a non-owner (FR-028)", async () => {
      stubVerifyOk();
      const { admin, community, listing } = await seed("prov-nonowner");
      const ids = await authorizeMany(admin.id, community.id, listing.id, 1, listing.id);
      const other = await createVerifiedAccount("media-test-nonowner@example.com");
      await prisma.membership.create({
        data: { accountId: other.id, communityId: community.id, role: "MEMBER" },
      });

      expect(
        await associatePhotos({
          accountId: other.id,
          listingId: listing.id,
          draftId: listing.id,
          photos: [{ publicId: ids[0], displayOrder: 0 }],
        }),
      ).toEqual({ ok: false, reason: "not_owner" });
    });

    it("re-checks membership at association, closing the authorize-to-associate race", async () => {
      stubVerifyOk();
      const { admin, community, listing } = await seed("prov-race");
      const ids = await authorizeMany(admin.id, community.id, listing.id, 1, listing.id);

      // Membership revoked between authorization and association.
      await prisma.membership.deleteMany({
        where: { accountId: admin.id, communityId: community.id },
      });

      expect(
        await associatePhotos({
          accountId: admin.id,
          listingId: listing.id,
          draftId: listing.id,
          photos: [{ publicId: ids[0], displayOrder: 0 }],
        }),
      ).toEqual({ ok: false, reason: "not_a_member" });
    });

    it("signs the enforcement parameters and excludes the four that must not be signed (FR-033)", async () => {
      const signed = buildUploadStringToSign({
        timestamp: 1786000000,
        public_id: "cmarket/test/listings/d/abc",
        type: "authenticated",
        allowed_formats: "jpg,png,webp",
        context: "account=a|draft=d",
      });

      // Signed: a client that alters any of these invalidates the signature,
      // which is what makes format enforcement real rather than advisory.
      for (const key of ["allowed_formats", "public_id", "timestamp", "type", "context"]) {
        expect(signed).toContain(`${key}=`);
      }
      // max_file_size is NOT signable — it is an upload-preset setting, and
      // including it makes Cloudinary reject the upload (verified live). Size is
      // enforced at association time from the reported byte count instead.
      expect(signed).not.toContain("max_file_size");
      // Not signed. resource_type lives in the endpoint URL path.
      expect([...UPLOAD_SIGNATURE_EXCLUDED_PARAMS].sort()).toEqual([
        "api_key",
        "cloud_name",
        "file",
        "resource_type",
      ]);
      for (const key of UPLOAD_SIGNATURE_EXCLUDED_PARAMS) {
        expect(signed).not.toContain(`${key}=`);
      }
      expect(signed).not.toContain("folder=");
    });
  });

  // ------------------------------------------------------- T032-T034 ----
  describe("reorderPhotos", () => {
    async function seedWithPhotos(suffix: string, count: number) {
      stubVerifyOk();
      const ctx = await seed(suffix);
      const ids = await authorizeMany(ctx.admin.id, ctx.community.id, ctx.listing.id, count, ctx.listing.id);
      const associated = await associatePhotos({
        accountId: ctx.admin.id,
        listingId: ctx.listing.id,
        draftId: ctx.listing.id,
        photos: ids.map((publicId, index) => ({ publicId, displayOrder: index })),
      });
      if (!associated.ok) throw new Error("expected association to succeed");
      return { ...ctx, photos: associated.photos };
    }

    it("applies a permutation and keeps order contiguous — a two-element swap must not trip the unique index", async () => {
      const { admin, listing, photos } = await seedWithPhotos("reorder-swap", 2);
      const [first, second] = photos;

      const result = await reorderPhotos({
        accountId: admin.id,
        listingId: listing.id,
        photoIds: [second.id, first.id],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.photos.map((p) => p.id)).toEqual([second.id, first.id]);
      expect(result.photos.map((p) => p.displayOrder)).toEqual([0, 1]);
    });

    it("changes the cover without duplicating or removing a photo (FR-015)", async () => {
      const { admin, listing, photos } = await seedWithPhotos("reorder-cover", 3);

      const result = await reorderPhotos({
        accountId: admin.id,
        listingId: listing.id,
        photoIds: photos.map((p) => p.id),
        coverPhotoId: photos[2].id,
      });

      if (!result.ok) throw new Error("expected success");
      expect(result.photos).toHaveLength(3);
      expect(result.photos.filter((p) => p.isCover)).toHaveLength(1);
      expect(result.photos.find((p) => p.isCover)?.id).toBe(photos[2].id);
    });

    it("refuses a stale set — an omission or an addition (FR-020)", async () => {
      const { admin, listing, photos } = await seedWithPhotos("reorder-stale", 3);

      expect(
        await reorderPhotos({
          accountId: admin.id,
          listingId: listing.id,
          photoIds: [photos[0].id, photos[1].id],
        }),
      ).toEqual({ ok: false, reason: "stale_photo_set" });

      expect(
        await reorderPhotos({
          accountId: admin.id,
          listingId: listing.id,
          photoIds: [...photos.map((p) => p.id), "clsomethingelse"],
        }),
      ).toEqual({ ok: false, reason: "stale_photo_set" });
    });

    it("refuses a non-owner and a cover outside the set", async () => {
      const { admin, community, listing, photos } = await seedWithPhotos("reorder-auth", 2);
      const other = await createVerifiedAccount("media-test-reorder-other@example.com");
      await prisma.membership.create({
        data: { accountId: other.id, communityId: community.id, role: "MEMBER" },
      });

      expect(
        await reorderPhotos({
          accountId: other.id,
          listingId: listing.id,
          photoIds: photos.map((p) => p.id),
        }),
      ).toEqual({ ok: false, reason: "not_owner" });

      expect(
        await reorderPhotos({
          accountId: admin.id,
          listingId: listing.id,
          photoIds: photos.map((p) => p.id),
          coverPhotoId: "clnotinset",
        }),
      ).toEqual({ ok: false, reason: "invalid_input" });
    });

    it("promotes a deterministic replacement when the cover is removed (FR-018)", async () => {
      const { admin, listing, photos } = await seedWithPhotos("reorder-remove-cover", 3);

      // photos[0] is the implicit cover.
      expect(photos[0].isCover).toBe(true);
      await removeListingPhoto({
        listingId: listing.id,
        photoId: photos[0].id,
        callerAccountId: admin.id,
      });

      const updated = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(updated.coverPhotoId).toBe(photos[1].id);
    });
  });

  // ---------------------------------------------------------------- T085 ----
  describe("schema shape after the cutover", () => {
    it("has no byte columns and uses displayOrder rather than position", async () => {
      const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'listing_photos'`,
      );
      const names = columns.map((c) => c.column_name);

      expect(names).not.toContain("data");
      expect(names).not.toContain("mimeType");
      expect(names).not.toContain("sizeBytes");
      // Dropped from the design: under type:authenticated a stored URL neither
      // resolves nor is the mechanism delivery uses (FR-044).
      expect(names).not.toContain("secureUrl");

      expect(names).not.toContain("position");
      expect(names).toContain("displayOrder");
      expect(names).toContain("cloudinaryAssetId");
      expect(names).toContain("cloudinaryPublicId");
    });

    it("created the two operational tables", async () => {
      const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables WHERE tablename IN ('pending_listing_media','media_cleanup_tasks')`,
      );
      expect(tables.map((t) => t.tablename).sort()).toEqual([
        "media_cleanup_tasks",
        "pending_listing_media",
      ]);
    });
  });
});
