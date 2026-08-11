# Implementation Plan: Cloudinary Listing Media Integration

**Branch**: `017-cloudinary-listing-media` | **Date**: 2026-08-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-cloudinary-listing-media/spec.md`

**Revised 2026-08-06**: delivery changed from public Cloudinary URLs rendered through Next.js Image to **authenticated CMarket proxy routes**. Every `next/image`, `remotePatterns`, loader, and `srcset` requirement is gone. **The Principle II deviation and its maintainer sign-off are withdrawn** — the proxy preserves the existing member-gated guarantee instead of relaxing it, so this plan now has zero constitutional violations.

**Amended 2026-08-06** (FR-107–FR-109): the exposure prohibition is scoped precisely to **delivery and listing reads**, since the direct-upload protocol structurally requires the browser to receive an upload endpoint, key, timestamp, signature, and public ID. And delivery caching moves from `private, max-age=300` to **`private, no-cache` with `ETag`**, with authorization mandated before any `304`. The second change strengthens Principle II further: revocation now takes effect on the next image request rather than after a five-minute window.

**Amended again 2026-08-06** — six implementation-level corrections, no requirement or principle change: (1) the upload and delivery signature algorithms are specified separately and must not share an implementation; (2) the legacy `folder` upload parameter is removed entirely so behaviour cannot depend on the account's folder mode; (3) `authorizeUpload()` gains a real **retry mode**, without which re-uploading a failed file would mint a second public ID and double-count the eight-photo cap; (4) `getListingPhoto()` must return `cloudinaryAssetId` because the weak delivery `ETag` derives from it; (5) populating real credentials is a maintainer action, not an agent task — `.env.test` uses deterministic dummies; (6) the cleanup non-blocking test is split so it stops asserting a `destroyAsset` call that photo removal never makes. Items 3, 4, and 6 were defects in the previous revision.

## Summary

Replace CMarket's in-database listing-image storage with a Cloudinary-backed media system, in one hard cutover with no parallel path and no legacy migration. Today `ListingPhoto.data Bytes` holds image bytes in PostgreSQL and a membership-gated route streams them back. After this feature, PostgreSQL holds only Cloudinary references and presentation metadata, browsers upload bytes directly to Cloudinary using short-lived server-signed parameters, and browsers *read* images through an authenticated CMarket route that re-validates session and membership on every request before fetching the bytes from Cloudinary server-side.

The two directions are deliberately asymmetric, and so is what the browser is allowed to know about each. **Upload** is direct browser-to-Cloudinary, because upload bytes are large, one-time, and already authorized by a signature — which structurally requires the browser to receive the upload endpoint, API key, timestamp, signature, and server-generated public ID (FR-108). Those values authorize one write and confer no read. **Delivery** is proxied and exposes nothing Cloudinary at all (FR-056), because delivery is where community isolation is either preserved or broken, and any durable URL or identifier there is a bearer capability that outlives membership. The proxy streams bytes and never redirects (FR-107), since a redirect would convert a server-side detail into exactly such a capability, logged in the browser's history and referrers. Cloudinary assets use `type: authenticated`, so even a leaked public ID grants nothing without a server-signed URL — two independent controls rather than one.

Work splits into six parts: a schema change dropping the byte columns and adding two operational tables (`PendingListingMedia`, `MediaCleanupTask`); a small first-party `src/lib/cloudinary/` module for signing, verification, delivery fetch, and deletion (no SDK — [research.md #3](./research.md)); a custom multi-file uploader Client Component shared by the create and edit forms; the authenticated delivery route with its server-side variant catalogue; rewritten media functions in `listingService.ts`; and an out-of-band cleanup drain so a Cloudinary outage never blocks a member's listing edit.

Rendering scope is **replacement only** — the three surfaces that show listing media today, and no new ones ([research.md #2](./research.md)).

## Technical Context

**Language/Version**: TypeScript, Next.js 16.2.10 (App Router), React 19.2.7 — unchanged from 002-016, no new language or runtime.

**Primary Dependencies**: **None added.** [research.md #3](./research.md) rejects both the `cloudinary` SDK and `next-cloudinary` in favour of a ~140-line first-party `src/lib/cloudinary/` module on `node:crypto` and `fetch`, mirroring the deliberately vendor-agnostic pattern [`src/lib/email/sendEmail.ts`](../../src/lib/email/sendEmail.ts) already establishes for outbound email. The revision strengthens this: nothing Cloudinary-related runs in the browser at all, so the module is purely server-side and needs no client-safe subset. Reuses `requireCommunityMembership()` and `isCommunityActive()` from [`listingService.ts`](../../src/server/services/listingService.ts) unchanged as the authorization gates — including for the delivery route, which keeps `getListingPhoto()`'s existing gate and swaps only its byte source. No image-rendering library: plain `<img>` behind one shared component (FR-063). Reordering is two buttons per tile, not a drag-and-drop library ([research.md #10](./research.md)).

**Storage**: PostgreSQL via Prisma 6.19. **One destructive migration.** `ListingPhoto` loses `data`, `mimeType`, `sizeBytes` and gains `cloudinaryAssetId`, `cloudinaryPublicId`, `width`, `height`, `format`, `bytes`; `position` is renamed `displayOrder`. Note `secureUrl` is **not** added — the previous plan stored it as a diagnostic, but under `type: authenticated` a stored URL is neither usable nor meaningful, and FR-044 forbids a URL being how delivery resolves an asset. Two new tables: `PendingListingMedia` (authorized-but-unassociated uploads, so abandoned assets stay findable — FR-083) and `MediaCleanupTask` (retryable deletion — FR-082). `Listing.coverPhotoId` is **kept exactly as it is** ([research.md #4](./research.md)) — cover semantics do not change, only where bytes live. Existing rows' image bytes are dropped, not migrated (FR-087, FR-093); affected listings fall back to the existing "No photo" placeholder. Applied by `prisma migrate dev`, reaching production only through the versioned migration the constitution's Migrations constraint requires — never `db push --accept-data-loss` (FR-095).

**Testing**: Vitest for contract/unit (`npm run test:unit`), Playwright for integration (`npm run test:e2e`). New: `tests/contract/test_listing_media.ts`, `tests/contract/test_listing_photo_delivery.ts`, `tests/unit/test_cloudinary_variants.ts`, `tests/unit/test_no_cloudinary_in_client_bundle.ts`, `tests/integration/test_listing_media_flow.spec.ts`. Rewritten: the photo blocks of [`tests/contract/test_listings.ts`](../../tests/contract/test_listings.ts) — the `Buffer` fixtures at lines 359-389 have no successor because upload bytes never reach the server, and the 6-photo cap assertion at line 393 becomes 8. Product listing is a **named Principle VIII critical flow**, so these are written first, must fail first, and block merge in CI. The delivery route's authorization matrix is the single most important new test surface: it is the code path that carries Principle II. Cloudinary is never contacted from tests — upload, verification, delivery fetch, and destroy are all stubbed at the `src/lib/cloudinary/` boundary ([research.md #8](./research.md)).

**Target Platform**: The existing single Next.js web app, installable PWA, Docker/Dokploy. No new deployable unit. **`next.config.ts` is unmodified** — the previous plan added `images.remotePatterns`, but the browser never requests a Cloudinary host now, so there is nothing to allowlist. Cloudinary becomes a server-to-server runtime dependency for uploads' verification, delivery fetches, and deletion; outbound network access to Cloudinary is now required at *read* time, not only at write time.

**Project Type**: Extension of the existing single Next.js/Prisma project. No new top-level project.

**Performance Goals**: Bounded upload concurrency of three (FR-011, SC-020). Delivery: predefined variants (`card` ≈ 640px, `thumbnail` ≈ 320px) plus `f_auto,q_auto`, with `Cache-Control: private, no-cache` and weak `ETag: W/"{cloudinaryAssetId}-{variant}"` revalidation — weak because `f_auto` negotiates format, so identical variants legitimately differ byte-for-byte — so a reuse costs one conditional request answered by a small `304`, not a re-download. Deliberately not `max-age`: permitting reuse without revalidation is what created the revocation window this amendment closes.

**Honest note on the delivery trade-off**: the proxy puts the application server back on the image byte path, which public CDN URLs would have avoided entirely. This is a real cost, accepted to preserve membership gating. It is still a clear net improvement on today: the same bytes currently come out of PostgreSQL at full original size on every card render, so moving to Cloudinary-sourced variants cuts per-render bytes by roughly two orders of magnitude *even with* the proxy hop, and stops the database and its backups growing with every uploaded photo. If proxy bandwidth later binds, the escape hatches are the optional server-side byte cache (FR-062, explicitly out of MVP) or a membership-validating CDN edge — neither of which touches the schema, uploader, or cleanup. Recorded in [research.md #1](./research.md) rather than left implicit.

**Constraints**: The API secret never leaves the server and never carries a `NEXT_PUBLIC_` prefix (FR-098, FR-100) — asserted by a test, not only by review. **No Cloudinary value is baked into the client bundle** (FR-099): `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` does not exist, because the authorize response supplies the complete upload endpoint at runtime. Note the precise boundary — the upload flow *may* hand the browser an endpoint, key, timestamp, signature, and public ID (FR-108); delivery and listing reads may expose none of those (FR-056). Tests pin both sides, so tightening the leak check cannot silently break uploads. Signed **delivery** URLs must never appear in a response, header, redirect, or log line (FR-056, FR-104, FR-107). Two orderings in this feature are traps where the obvious arrangement is wrong: authorization must precede any `304` (FR-109), and cleanup rows must be enqueued before `listing.delete()` (below).

**The two signature algorithms are different and must not share an implementation** ([research.md #3](./research.md)). Upload: signed body params (`allowed_formats`, `context`, `public_id`, `timestamp`, `type`) sorted alphabetically, secret appended, **SHA-256 hex** — with `file`, `cloud_name`, `api_key`, and `resource_type` explicitly *excluded*, since `resource_type=image` lives in the endpoint URL path. Delivery: `{transformation}/{publicId}`, secret appended, **SHA-256 → URL-safe Base64 → first 8 characters** inside `s--{sig}--`. Both are verified end-to-end against the live service by `scripts/verify-cloudinary-live.ts`, which is how research.md #3's accepted "hand-rolled signer could drift" risk is discharged.

**`max_file_size` is not signable** — an upload-preset setting, not a request parameter; signing it makes Cloudinary reject every upload. Format enforcement rides on the signature (`allowed_formats`); **size** enforcement moved to association, where Cloudinary's own reported byte count is checked and an oversized asset is refused and queued for deletion (FR-006, FR-033).

**No `folder` parameter is sent or signed.** The complete public ID carries the path; sending both would make the asset's resulting path depend on whether the account is in fixed-folder or dynamic-folder mode, and would make provenance verification pass in one mode and fail in the other. Provenance is instead established by public-ID prefix, `context` account/draft, `resource_type`, `type`, and the `PendingListingMedia` row ([research.md #5](./research.md)).

**Authorization has two modes** ([research.md #7](./research.md)): initial mints a public ID and one pending row; retry accepts a previously issued public ID, reuses it, writes no row, and skips the cap check. Without retry mode, re-uploading one failed file would mint a second identity for it and double-count the eight-photo cap. Variant transformations come from a lookup table with **no string interpolation from the request** (FR-060). Every variant uses `c_limit`, never `c_fill`/`c_scale`, so aspect ratio cannot be distorted at the transformation layer (FR-064). The `deleteListing()` cascade is an ordering trap: `ListingPhoto` is `onDelete: Cascade`, so cleanup rows **must** be enqueued inside the same `$transaction` before `listing.delete()`, or every deleted listing silently orphans its assets with no record they existed ([research.md #9](./research.md)). Upload progress needs `XMLHttpRequest.upload.onprogress` because `fetch` still exposes no upload-progress event. Reordering must work on touch, so it is buttons rather than HTML5 drag (Principle V).

**Scale/Scope**: Eight photos per listing, 10 MB each, three server-defined variants. Three rendering surfaces changed, two API route files replaced, one route added, one form component rewritten, one service file's media section rewritten, one migration. Roughly 12 files modified, 9 created, 1 deleted.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | N/A | No membership path is touched. Upload authorization and delivery both *consume* membership; neither creates it. |
| II. Community Isolation (NON-NEGOTIABLE) | **PASS** | **Preserved, not relaxed** — this is what changed in the revision, and the amendment strengthens it further. The delivery route re-applies `requireCommunityMembership()` on every image request, exactly as today's byte endpoint does, and additionally verifies the photo's listing belongs to the community named in the path (FR-051–FR-054). No Cloudinary delivery URL ever reaches a browser (FR-056) and the route never redirects to one (FR-107), so there is no bearer capability that outlives membership. `type: authenticated` means a leaked public ID grants nothing without a server-signed URL. Every CMarket read path keeps its existing gate and `operationalEpoch` filter. **The residual TTL exposure is now eliminated, not merely bounded**: `private, no-cache` forces revalidation before any cached reuse, and authorization runs before any `304` (FR-109), so leaving a community — or a second account signing in on the same browser — is caught on the very next image request. |
| III. Administrator as Community Gatekeeper | **PASS** | Media mutations stay **owner-only**, never `requireCommunityAdministrator()`, matching `updateListing()`'s existing pattern. No administrator gains a media capability they lack today. Delivery is membership-gated, not role-gated, exactly as the current endpoint is. |
| IV. Non-Custodial Payments (NON-NEGOTIABLE) | N/A | No money or payment path is touched. |
| V. Single Web Application, Installable as PWA | **PASS** | Required and tested (FR-010, FR-065, SC-014). The uploader must work in a mobile viewport, and reordering is buttons rather than HTML5 drag specifically because native drag events do not fire on touch — a drag-only reorder would make a core interaction desktop-only, which this principle forbids. Variants mean mobile clients fetch ~40 KB cards rather than multi-megabyte originals, which matters on the connections Principle V's mobile-first stance implies. |
| VI. Contact & Data Privacy Gating | **PASS** | Strengthened. Listing media is item imagery, not contact data. Original filenames never become identifiers or appear in any URL (FR-101, [research.md #5](./research.md)) — public IDs are random. Under the proxy, asset locations are not browser-visible at all, so a member's file no longer has any externally addressable location. |
| VII. Simplicity & MVP-First | **PASS** | Zero new dependencies ([research.md #3](./research.md)); no image-rendering library. Cover semantics reuse the existing `Listing.coverPhotoId` FK rather than inventing `isCover` ([research.md #4](./research.md)). Delivery is one route plus a three-row lookup table, not a transformation builder. The optional server-side byte cache is **explicitly excluded from MVP** (FR-062) rather than built speculatively. `next.config.ts` and `profileService.ts` both end up unmodified, and `getListingPhoto()` is retained with a new body rather than deleted and reinvented ([research.md #12](./research.md)). Rendering scope held to the three surfaces that show media today. The two new tables are each justified by a specific FR (FR-083, FR-082). |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **PASS — mandatory** | **Product listing is a named critical flow.** Tests written before implementation, failing first, blocking merge in CI. Matrix in [research.md #8](./research.md). The delivery route's authorization matrix gets its own contract file, because that route is where Principle II now lives. Also covers the `deleteListing` cleanup-ordering trap and the no-Cloudinary-in-client-bundle assertion. |
| IX. Platform Administration Authority (NON-NEGOTIABLE) | **PASS** | A MASTER is explicitly rejected from upload authorization and every media mutation (FR-032, SC-011), and — because a MASTER holds no Membership — is refused by the delivery route's membership gate with no special-casing needed. Without the explicit upload check, `getCurrentMaster()`-authenticated callers could plausibly acquire a marketplace capability, which this principle forbids: a MASTER "MUST NOT … participate in marketplace activity." No `/master` surface renders or manages listing media. |

**Additional Constraints check**:

- **Tenancy** — community scoping is now a *first-class part of the delivery URL* (`/api/communities/{communityId}/listing-photos/{photoId}`), which is stronger than retrofitting a check: the request states the community it claims, and the server verifies the photo actually belongs to it. `PendingListingMedia` carries `communityId`, validated against current membership at authorization time. `MediaCleanupTask` is deliberately **not** community-scoped: it holds only an opaque `publicId` and exists after its listing may already be gone, so scoping would be both impossible and meaningless. Recorded so the omission reads as a decision, not an oversight.
- **Stack** — no deviation, no new dependency.
- **Migrations & backups** — one explicit versioned Prisma migration (FR-094), destructive by design and accepted by the spec (FR-093). Never `db push --accept-data-loss` (FR-095). This migration **drops user data** (existing image bytes), so it is the first migration in this project for which a verified backup before apply is not merely good practice but the only recovery path.
- **No stored value / platform billing / pricing** — not touched.

**Gate result**: **no violations.** Complexity Tracking is not required. Phase 0 proceeded.

*Re-check after Phase 1 design*: [data-model.md](./data-model.md) and [contracts/listing-media-api.md](./contracts/listing-media-api.md) confirm — every media mutation carries an owner check; the authorize endpoint carries authenticated + current-member + not-MASTER + (edit mode) owner checks; the delivery route carries session + current-member + photo-belongs-to-community checks **before** choosing between `200` and `304`, and returns the project's existing indistinguishable refusal shape; the route streams and never redirects; no listing read, association response, or delivery response carries a Cloudinary delivery URL, signed source URL, or persisted public ID, while the authorize response's upload metadata is explicitly permitted and carries no secret; no new PII field is introduced; no administrator- or MASTER-only media route or field was created; the association step trusts no client-supplied identifier the server did not itself previously write into a `PendingListingMedia` row (FR-030, FR-031). No principle deviation surfaced during design, and none was carried over — the Phase 0 gate result is unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/017-cloudinary-listing-media/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── listing-media-api.md
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
prisma/
├── schema.prisma                                   # MODIFIED: ListingPhoto reshaped; 2 new models
└── migrations/
    └── 20260806_______replace_listing_photos_with_cloudinary/   # NEW (destructive)

src/lib/cloudinary/
├── config.ts                                       # NEW: requireCloudinaryConfig(), fail-loud
├── signature.ts                                    # NEW: upload + delivery signing (node:crypto)
├── variants.ts                                     # NEW: the 3-entry variant table, no interpolation
├── delivery.ts                                     # NEW: signed URL build + server-side byte fetch
└── admin.ts                                        # NEW: verifyAsset(), destroyAsset()

src/server/services/
├── listingService.ts                               # MODIFIED: media section rewritten;
│                                                   #   getListingPhoto() KEPT, new body
├── listingMediaService.ts                          # NEW: authorize / associate / reorder / cover / remove
└── mediaCleanupService.ts                          # NEW: enqueue + drain with backoff

app/api/communities/[communityId]/
├── listing-photos/[photoId]/route.ts               # NEW: the authenticated delivery proxy (GET)
└── listings/[listingId]/
    ├── photos/route.ts                             # REPLACED: multipart POST -> JSON association POST
    ├── photos/[photoId]/route.ts                   # MODIFIED: byte GET removed; DELETE kept
    ├── photos/order/route.ts                       # NEW: PATCH reorder
    └── cover/route.ts                              # MODIFIED: unchanged contract, new internals

app/api/listing-media/
├── authorize/route.ts                              # NEW: POST -> signed upload params
└── cleanup/route.ts                                # NEW: POST -> drain MediaCleanupTask

app/communities/[communityId]/listings/
├── ListingForm.tsx                                 # MODIFIED: uploadPhotos()/file input removed
├── ListingMediaUploader.tsx                        # NEW: Client Component, the custom uploader
└── ListingMediaTile.tsx                            # NEW: per-file preview/state/actions

app/_components/
└── ListingImage.tsx                                # NEW: the only <img> for listing media;
                                                    #   holds the single no-img-element suppression

app/communities/[communityId]/
├── page.tsx                                        # MODIFIED: inline <img> -> ListingImage
├── listings/page.tsx                               # MODIFIED: inline <img> -> ListingImage
└── listings/[listingId]/page.tsx                   # MODIFIED: gallery -> ListingImage

.env.example                                        # MODIFIED: 6 Cloudinary/media variables documented

tests/
├── contract/test_listing_media.ts                  # NEW
├── contract/test_listing_photo_delivery.ts          # NEW
├── contract/test_listings.ts                       # MODIFIED: photo blocks rewritten
├── unit/test_cloudinary_variants.ts                # NEW
├── unit/test_no_cloudinary_in_client_bundle.ts     # NEW
└── integration/test_listing_media_flow.spec.ts     # NEW
```

**Not modified** (changed from the previous plan): `next.config.ts` needs no `images` block, and `profileService.ts` needs no change — its existing `coverPhotoId` is exactly what a future surface would use to build a proxy URL ([research.md #12](./research.md)).

**Structure Decision**: Extends the existing layout with no new top-level directories. Provider access goes in `src/lib/cloudinary/` alongside the existing `src/lib/auth/`, `src/lib/email/`, `src/lib/validation/` peers — the established home for third-party and cross-cutting concerns. It splits into five small files because signing, the variant table, delivery, admin operations, and config have genuinely different reasons to change, and `variants.ts` in particular should be reviewable in isolation: it is the file that guarantees no request value reaches a transformation string.

Media orchestration goes in a **new** `listingMediaService.ts` rather than growing `listingService.ts`, which is already 843 lines. `listingService.ts` keeps only what genuinely belongs to a listing — `MAX_PHOTOS_PER_LISTING`, cover reassignment, and `getListingPhoto()`, whose authorization logic the delivery route reuses verbatim.

The delivery route lives at `communities/[communityId]/listing-photos/[photoId]` rather than nested under `listings/[listingId]/`, because a photo id already determines its listing; requiring the caller to also supply a correct listing id would add a redundant path segment and a third thing to get wrong, while the community segment earns its place by making the isolation check assertable against the request's own claim.

The uploader splits into container plus tile because the tile owns per-file state and actions, and one component holding both the promise pool and eight tiles' worth of state is the kind of file nobody wants to review. `ListingImage.tsx` exists so exactly one place in the codebase knows how a listing image is fetched and rendered — which is also where the single documented `@next/next/no-img-element` suppression lives, so that exception is confined and explained rather than sprinkled.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified.

**Not applicable — the Constitution Check found no violations.**

The previous revision of this plan carried one entry here: a Principle II relaxation for publicly deliverable Cloudinary URLs, pending maintainer sign-off. The authenticated-proxy architecture removes that relaxation entirely, so the entry and its sign-off requirement are withdrawn. The delivery route preserves the exact membership gate the current byte endpoint enforces.

The one thing worth restating without being a violation: the proxy costs application-server bandwidth that public CDN URLs would not, which is a deliberate engineering trade rather than a constitutional compromise. It is documented in Technical Context above and in [research.md #1](./research.md), with two named escape hatches if it ever binds.
