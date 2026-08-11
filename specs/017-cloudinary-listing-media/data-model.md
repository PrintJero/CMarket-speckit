# Phase 1 Data Model: Cloudinary Listing Media Integration

**Feature**: `017-cloudinary-listing-media` | **Date**: 2026-08-06 | **Plan**: [plan.md](./plan.md)

**Revised 2026-08-06**: delivery moved to authenticated CMarket proxy routes. The `secureUrl` column planned in the previous revision is **dropped from the design** — under `type: authenticated` a stored URL is neither usable nor meaningful, and FR-044 forbids a URL being how delivery resolves an asset. Everything else in this model is unchanged.

**Amended 2026-08-06**: no schema change. The two corrections (upload-vs-delivery exposure scope, and `no-cache` revalidation) are entirely behavioural — they touch route handling and headers, not stored data. The `ETag` is derived from the existing `cloudinaryAssetId` plus the variant name, so no cache-versioning column is needed.

**Amended again 2026-08-06** (signature algorithms, `folder` removal, retry authorization, `ETag` metadata, environment handling, cleanup test): still **no schema change**. `PendingListingMedia` already holds everything retry mode needs (`accountId`, `draftId`, `cloudinaryPublicId`, `expiresAt`) — the correction is that authorize now *reads* that row instead of always writing a new one, which is behaviour, not structure. `ListingPhoto` already stores `cloudinaryAssetId`, so the weak `ETag` needs no new column; what changed is that `getListingPhoto()` must return it. §3's lifecycle gains a "reused" step.

One destructive migration. `ListingPhoto` is reshaped from a byte store into a Cloudinary reference; two operational tables are added; `Listing` is untouched.

---

## 1. `Listing` — unchanged

No field is added, removed, or re-typed. Recorded explicitly because it is the most likely place for scope to creep.

`coverPhotoId String? @unique` and the `ListingCoverPhoto` relation stay exactly as they are ([research.md #4](./research.md)). Cover semantics do not change — only where the referenced photo's bytes live. `onDelete: SetNull` on the cover relation and `onDelete: Cascade` on `photos` both stay.

**Consequence**: the existing cover contract tests at [`tests/contract/test_listings.ts:569-650`](../../tests/contract/test_listings.ts#L569) remain valid as *behavioural* tests. Their setup changes (photos are created differently); their assertions do not.

---

## 2. `ListingPhoto` — reshaped

### Removed

| Field | Was | Why |
|---|---|---|
| `data` | `Bytes` | FR-045: PostgreSQL must not store image bytes. This is the column the feature exists to delete. |
| `mimeType` | `String` | Superseded by `format`. Content type at delivery time is derived from the variant's negotiated format, not from a stored value. |
| `sizeBytes` | `Int` | Superseded by `bytes`, now reported by Cloudinary rather than measured server-side. |

### Renamed

| From | To | Why |
|---|---|---|
| `position` | `displayOrder` | FR-040's vocabulary, and it removes the ambiguity `position` carries once upload order and display order are genuinely different things (FR-017). A rename, not a drop-and-add — the migration must use `ALTER TABLE … RENAME COLUMN` so the intent is legible. |

### Added

| Field | Type | Constraints | Requirement |
|---|---|---|---|
| `cloudinaryAssetId` | `String` | `@unique` | FR-035, FR-044. Cloudinary's stable `asset_id`. Survives a public-ID rename, which is why it exists alongside `cloudinaryPublicId`. **Also the identifier half of the delivery `ETag`** (`W/"{cloudinaryAssetId}-{variant}"`), which is why `getListingPhoto()` must return it internally — while FR-056 still forbids emitting it in any browser-reachable field. |
| `cloudinaryPublicId` | `String` | `@unique` | FR-036. The identifier the delivery proxy signs and fetches, and the identifier deletion uses. **Its uniqueness is what makes FR-019 (no duplicate association on repeated submit) structural rather than policed** — a second association attempt for the same asset cannot insert. |
| `width` | `Int` | | FR-038, FR-068. The **original** intrinsic width, used as the rendered element's `width` attribute so the browser reserves space in the correct proportion. |
| `height` | `Int` | | FR-038, FR-068. As above. |
| `format` | `String` | | FR-039. Cloudinary's normalized source format (`jpg`, `png`, `webp`). Diagnostic — delivery format is negotiated by `f_auto`. |
| `bytes` | `Int` | | FR-043 (optional). Kept: it arrives in the same upload response for free and makes storage-cost questions answerable without an Admin API sweep. |

### Not added (changed from the previous revision)

| Field | Why not |
|---|---|
| `secureUrl` | The previous revision stored it as a diagnostic record of what Cloudinary returned. Dropped: under `type: authenticated` an unsigned URL does not resolve, so the stored value would be a dead string that invites exactly the mistake FR-044 forbids — a developer reading it and using it as a source. Delivery builds a signed URL from `cloudinaryPublicId` at request time, in one place ([research.md #6](./research.md)). Removing the field removes the temptation. |

### On the intrinsic-vs-served dimension mismatch

`width`/`height` hold the **original** dimensions, while the delivery route serves a variant capped at 320/640/1280px. This is correct and intentional: an `<img>` element's `width`/`height` attributes are used by the browser to derive an *aspect ratio* for space reservation, and the original dimensions carry the true ratio. The served bytes being smaller does not affect layout, because CSS controls the rendered box. Storing per-variant dimensions would be redundant — every variant preserves the source ratio by construction, since every transformation uses `c_limit` ([research.md #6](./research.md)).

### Resulting model

```prisma
/// A Cloudinary-hosted image attached to exactly one Listing
/// (017-cloudinary-listing-media). Stores references and presentation
/// metadata only — never bytes (FR-045), and deliberately never a delivery
/// URL (FR-044): the authenticated proxy signs one from cloudinaryPublicId at
/// request time. Removed automatically when its parent listing is deleted;
/// see mediaCleanupService for the Cloudinary side, which MUST be enqueued
/// before that cascade fires (research.md #9).
model ListingPhoto {
  id                 String   @id @default(cuid())
  listingId          String
  cloudinaryAssetId  String   @unique
  cloudinaryPublicId String   @unique
  width              Int
  height             Int
  format             String
  bytes              Int
  displayOrder       Int
  createdAt          DateTime @default(now())

  listing        Listing  @relation("ListingPhotos", fields: [listingId], references: [id], onDelete: Cascade)
  /// Back-relation only, for Listing.coverPhotoId — never queried from this side.
  coverOfListing Listing? @relation("ListingCoverPhoto")

  @@unique([listingId, displayOrder])
  @@index([listingId])
  @@map("listing_photos")
}
```

### Validation rules

| Rule | Enforced where | Requirement |
|---|---|---|
| At most 8 photos per listing | `listingMediaService`, counted inside the association transaction | FR-004 |
| `displayOrder` contiguous from 0 | `@@unique([listingId, displayOrder])` plus full-set rewrite on every mutation | FR-020 |
| Format ∈ {jpg, png, webp} | Signed `allowed_formats` — Cloudinary rejects before the asset exists | FR-005, FR-033 |
| Asset provenance | Public-ID prefix + `context` account/draft + `resource_type: image` + `type: authenticated` + the `PendingListingMedia` row — never a folder comparison | FR-030, FR-031 |
| Size ≤ 10 MB | Checked at association against Cloudinary's reported `bytes`; an oversized asset is refused with `file_too_large` and queued for deletion. **Not** signed — `max_file_size` is an upload-preset setting, not a signable request parameter (verified against the live service) | FR-006, FR-033 |
| One asset ↔ one listing | `cloudinaryPublicId @unique` | FR-047 |
| Delivery resolves by public ID, never by stored URL | No URL column exists to misuse | FR-044 |

**On `@@unique([listingId, displayOrder])`**: a deliberate tightening over the current schema, which allows gaps — [`removeListingPhoto()`](../../src/server/services/listingService.ts#L543) documents "Leaves a gap in position." FR-020 requires contiguity, so removal and reorder now rewrite the whole set for that listing rather than mutating one row. The constraint means a partial rewrite fails loudly at the database instead of leaving a half-renumbered gallery. Rewrites happen inside a transaction and must assign to a temporary offset first, because swapping two rows' orders in place transiently violates the constraint.

---

## 3. `PendingListingMedia` — new

Bridges the gap between "authorized to upload" and "associated with a listing," which on the create path is a gap where no listing exists yet ([research.md #7](./research.md)).

```prisma
/// An authorized-but-not-yet-associated Cloudinary upload
/// (017-cloudinary-listing-media, FR-030, FR-031, FR-083). Written when the
/// server signs upload params; deleted when the asset is associated with a
/// listing, or swept by mediaCleanupService once expired. This row is the
/// ONLY thing that makes a client-supplied public ID trustworthy.
model PendingListingMedia {
  id                 String   @id @default(cuid())
  accountId          String
  communityId        String
  /// Client-generated per-form-session id. On the edit path this is the real
  /// listingId; on the create path the listing does not exist yet.
  draftId            String
  /// Set only on the edit path, so ownership is re-checkable at association.
  listingId          String?
  cloudinaryPublicId String   @unique
  expiresAt          DateTime
  createdAt          DateTime @default(now())

  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, draftId])
  @@index([expiresAt])
  @@map("pending_listing_media")
}
```

**Lifecycle**:

1. **Created** by the authorize endpoint in **initial mode only**, after all four authorization checks pass, with `expiresAt = now + 30 min`. That 30 minutes is deliberately longer than the client's 10-minute refresh threshold, so a file that sits queued past the threshold always has a valid row for **retry mode** to match against (FR-009 / User Story 3 scenario 7). The threshold is CMarket's own client-side staleness policy, not a claim about when Cloudinary rejects a signature ([research.md #7](./research.md)).
2. **Reused** by the authorize endpoint in **retry mode**: found by `accountId` + `draftId` + `cloudinaryPublicId`, it yields fresh signed params for the same public ID and is **not** duplicated, replaced, or re-counted against the eight-photo cap. A row belonging to another account or draft, or an expired one, is refused. This is why the row is the durable identity of an in-flight upload rather than a disposable receipt.
3. **Consumed** at association: matched on `cloudinaryPublicId` **and** `accountId`, then deleted in the same transaction that creates the `ListingPhoto`.
4. **Swept** by `mediaCleanupService` when `expiresAt < now()` and no `ListingPhoto` references the public ID — FR-083's "identifiable for cleanup," and the reason the row is persisted rather than being a stateless token.

**Why `accountId` is in the match and not just `draftId`**: `draftId` is client-generated, so a second account could send someone else's. Matching on `accountId` too means a forged `draftId` finds nothing. This is the mechanism behind FR-031 and User Story 5 scenario 7, and it is the same reason retry mode matches on `accountId` + `draftId` + `publicId` rather than `publicId` alone.

**Why `onDelete: Cascade` from `Account`**: a deleted account's pending uploads must not become permanently unattributable rows. The assets they point at are swept by `expiresAt` regardless, so no Cloudinary asset is orphaned by the cascade.

**Note**: pending uploads are **not** reachable through the delivery proxy. The proxy resolves a `photoId` to a `ListingPhoto` row; a pending upload has none, so an asset that was uploaded but never associated cannot be viewed through CMarket at all — only the uploading browser's local object-URL preview shows it ([research.md #10](./research.md)).

---

## 4. `MediaCleanupTask` — new

Makes Cloudinary deletion retryable without blocking the member's operation (FR-082, FR-085).

```prisma
/// A Cloudinary asset that must be deleted, retried until it succeeds
/// (017-cloudinary-listing-media, FR-079, FR-082, FR-085). Deliberately NOT
/// community-scoped: it holds only an opaque public ID and outlives the
/// listing (and possibly the community) it came from.
model MediaCleanupTask {
  id                 String   @id @default(cuid())
  cloudinaryPublicId String   @unique
  attempts           Int      @default(0)
  lastError          String?
  nextAttemptAt      DateTime @default(now())
  createdAt          DateTime @default(now())

  @@index([nextAttemptAt])
  @@map("media_cleanup_tasks")
}
```

**Enqueued when**: a photo association is removed; a listing is deleted; a `PendingListingMedia` row expires unassociated.

**Drained by**: `POST /api/listing-media/cleanup`, selecting rows where `nextAttemptAt <= now()`, calling destroy with `invalidate: true`, deleting the row on success. On failure: `attempts++`, record `lastError`, `nextAttemptAt = now + 2^attempts` minutes capped at 24h.

**No `listingId`, deliberately**: by the time a row is drained its listing may not exist. Storing a dangling id would invite a join that cannot be satisfied. The public ID is the only durable fact needed, which is exactly FR-081 ("deletion MUST use stored stable asset references").

**`cloudinaryPublicId @unique`** makes enqueueing idempotent — a retried listing delete cannot queue the same asset twice.

**Deletion visibility under the proxy**: once the `ListingPhoto` row is gone, the delivery route returns 404 immediately, so every CMarket surface stops showing the image at once regardless of whether the Cloudinary asset has been destroyed yet. Because delivery responses are `private, no-cache`, a browser holding the image must revalidate before reusing it and so receives that 404 on its next attempt — there is no TTL window in which a deleted photo keeps displaying ([research.md #9](./research.md)).

### The `deleteListing` ordering trap

`ListingPhoto.listing` is `onDelete: Cascade`, so [`deleteListing()`](../../src/server/services/listingService.ts#L761-L767) destroys the photo rows — the only record of which Cloudinary assets existed — the instant it runs.

```
// REQUIRED order inside deleteListing()'s existing $transaction:
1. read the listing's photo publicIds
2. enqueue MediaCleanupTask rows for all of them
3. cancel PENDING transactions   (existing behaviour, unchanged)
4. listing.delete()              (cascade wipes the photo rows)
```

Reversing steps 2 and 4 orphans every asset of every deleted listing with no record they existed. FR-080 rests entirely on this ordering, and it gets a dedicated contract test.

---

## 5. Entity relationships

```
Account ──1:N──> PendingListingMedia          (cascade on account delete)
Account ──1:N──> Listing                       (existing, unchanged)

Listing ──1:N──> ListingPhoto                  (cascade on listing delete)
Listing ──0:1──> ListingPhoto  [coverPhotoId]  (existing, SetNull, unchanged)

ListingPhoto ──1:1──> Cloudinary Asset         (external, by cloudinaryPublicId,
                                                reachable ONLY by the CMarket server)

MediaCleanupTask ── (no relation)              (opaque publicId, outlives its listing)
```

**Image Variant** is not an entity. It is a three-row constant table in `src/lib/cloudinary/variants.ts` with no database representation — nothing about a variant is per-listing or per-photo, and making it data would invite runtime-editable transformations, which FR-060 forbids.

---

## 6. Migration notes

Directory: `prisma/migrations/20260806_______replace_listing_photos_with_cloudinary/`

Operation order:

1. Enqueue nothing — legacy assets were never in Cloudinary, so there is nothing to clean up there (FR-087).
2. `DELETE FROM listing_photos;` — every existing row's only content was its bytes, and the new NOT NULL Cloudinary columns have no derivable value. Deleting is what makes affected listings fall back to the placeholder (FR-089). `Listing.coverPhotoId` self-clears via `SetNull`.
3. `ALTER TABLE listing_photos RENAME COLUMN position TO display_order;`
4. Drop `data`, `mime_type`, `size_bytes`.
5. Add the six new columns as NOT NULL (safe: the table is now empty).
6. Add `@@unique([listing_id, display_order])` and the two unique indexes.
7. Create `pending_listing_media` and `media_cleanup_tasks`.

**Destructive and irreversible.** It drops user-uploaded content with no recovery path other than a database backup. The constitution's Migrations & backups constraint requires backups to exist and restoration to have been verified; this is the first migration in this project where that is the *only* safety net rather than a precaution. Take a verified backup immediately before applying to any environment with real data.

Generate with `npx prisma migrate dev --name replace_listing_photos_with_cloudinary`, then hand-edit the emitted SQL so step 3 is a `RENAME COLUMN` — Prisma's differ will otherwise emit drop-and-add, harmless here only because step 2 already emptied the table, but the rename states the intent and keeps the migration readable.

Never `prisma db push --accept-data-loss` (FR-095).
