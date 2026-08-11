---

description: "Task list for 017-cloudinary-listing-media"
---

# Tasks: Cloudinary Listing Media Integration

**Input**: Design documents from `/specs/017-cloudinary-listing-media/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/listing-media-api.md](./contracts/listing-media-api.md), [quickstart.md](./quickstart.md)

**Tests**: **MANDATORY.** Constitution Principle VIII names **product listing** as a critical flow, so tests are required regardless of what the spec asks for, MUST be written before implementation, MUST fail first (red), and MUST block merge in CI. Every story phase below leads with its test tasks for that reason.

**Organization**: Tasks are grouped by user story. Note honestly that this feature is a **hard cutover**, not seven parallel slices — the migration, the Cloudinary access module, and the legacy-field removal are genuinely shared prerequisites and live in Phase 2. Each story phase is still independently *testable*; see each phase's Independent Test.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US7)
- Exact file paths are included in every task

## Path Conventions

Single Next.js/Prisma project at repository root: `app/`, `src/`, `prisma/`, `tests/`. Matches [plan.md](./plan.md)'s Project Structure exactly.

## Explicitly NOT tasks

Recorded so nobody "helpfully" does them — each was decided against in [research.md #12](./research.md):

- **Do not modify `next.config.ts`.** No `images.remotePatterns` block is needed; the browser never requests a Cloudinary host.
- **Do not modify `src/server/services/profileService.ts`.** Its existing `coverPhotoId` field is already what a future surface needs to build a proxy URL.
- **Do not delete `getListingPhoto()`.** It is retained with a new body (T031); its authorization gate is what the delivery route reuses.
- **Do not add `next/image`, a loader, `remotePatterns`, or `srcset`.** Plain `<img>` is the decision (FR-063).
- **Do not add a `secureUrl` column.** Dropped from the design ([data-model.md §2](./data-model.md)).
- **Do not add `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`.** The authorize response supplies the upload endpoint at runtime (FR-099).
- **Do not add the optional server-side byte cache.** Explicitly out of MVP scope (FR-062).
- **Do not add a Cloudinary SDK or `next-cloudinary`.** Zero new dependencies ([research.md #3](./research.md)).
- **Do not send or sign the legacy `folder` upload parameter.** The complete server-generated public ID already carries the path, and sending both makes behaviour depend on whether the Cloudinary account is in fixed-folder or dynamic-folder mode. Repository inspection confirms no folder mode has been configured — there is no Cloudinary integration in the codebase yet — so the unambiguous choice is public ID only ([research.md #5](./research.md)).
- **Do not write real Cloudinary credentials into any file an agent creates.** `.env.example` carries names and documentation only; local `.env` is populated manually by the maintainer and stays uncommitted; `.env.test` uses deterministic dummy values because every Cloudinary call is stubbed.
- **Do not reuse one signature implementation for both upload and delivery.** They are different algorithms with different encodings — hex for upload, URL-safe Base64 truncated to 8 characters for delivery ([research.md #3](./research.md)).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration surface and fail-loud config access, needed by every later phase.

- [X] T001 Add the six server-side media variables to `.env.example` with explanatory comments matching the file's existing style: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_ENV_FOLDER`, `LISTING_IMAGE_CACHE_MODE`, `CLEANUP_TOKEN`. Comment must state that no `NEXT_PUBLIC_CLOUDINARY_*` variable exists and why (FR-099), and that `LISTING_IMAGE_CACHE_MODE` is a mode toggle with no TTL option (FR-058)
- [X] T002 Add **deterministic dummy** values for the five Cloudinary/media variables to `.env.test` — e.g. `CLOUDINARY_CLOUD_NAME="test-cloud"`, `CLOUDINARY_API_KEY="000000000000000"`, `CLOUDINARY_API_SECRET="test-secret-not-a-real-credential"`, `CLOUDINARY_ENV_FOLDER="test"`, `LISTING_IMAGE_CACHE_MODE="no-cache"` — so `requireCloudinaryConfig()` passes. Every Cloudinary call is stubbed (T004), so no real credential is needed and the dummy values must be stable enough for the T006 fixtures to pin against. **Do not create or populate `.env`, and do not write a real credential into any file**: local `.env` values are supplied manually by the maintainer and stay uncommitted (FR-100)
- [X] T003 [P] Create `src/lib/cloudinary/config.ts` exporting `requireCloudinaryConfig()` that reads the five Cloudinary/media variables and **throws on first use** if any is missing or empty. Must not be a module-level or startup assertion — `next build` runs without production secrets and a build-time check would break the Docker build (FR-106, [research.md #11](./research.md))

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema cutover, the Cloudinary access module, and the shared test stub. Nothing in Phases 3–9 can begin until this is done.

**⚠️ CRITICAL**: This phase contains the destructive migration and the legacy-field removal. It is where the hard cutover actually happens.

### Test stub and unit tests first

- [X] T004 Create `tests/helpers/cloudinaryStub.ts` providing a stub for the `src/lib/cloudinary/` boundary — `signUploadParams`, `signDeliveryPath`, `verifyAsset`, `destroyAsset`, `fetchAssetBytes` — so **no test ever contacts Cloudinary** ([research.md #8](./research.md)). Include a deterministic fixture asset (known `asset_id`, `public_id`, `width`, `height`, `format`, `bytes`)
- [X] T005 [P] Write `tests/unit/test_cloudinary_variants.ts` and confirm it FAILS: asserts the variant table has exactly `thumbnail`/`card`/`detail`; every entry uses `c_limit` and never `c_fill`/`c_scale` so aspect ratio cannot be distorted (FR-064); every entry carries `f_auto,q_auto` (FR-054); an unknown name falls back to `card` (FR-061); and no code path concatenates a request-supplied value into a transformation string (FR-060)
- [X] T006 [P] Write **two independent** signature fixture suites in `tests/unit/test_cloudinary_signature.ts` and confirm they FAIL — they must not share a helper, because the two algorithms differ in input, encoding, and length ([research.md #3](./research.md)):
  - **Upload signature**: given a fixed param set, assert the string-to-sign is every signed body parameter sorted alphabetically and joined `k=v&k=v`, that `CLOUDINARY_API_SECRET` is appended, and that the output is the **SHA-256 hexadecimal** digest. Assert `file`, `cloud_name`, `resource_type`, and `api_key` are **excluded** from the string-to-sign, and that no `folder` parameter appears at all
  - **Delivery signature**: given a fixed frozen transformation and public ID, assert the string-to-sign is exactly the URL components that follow the signature component (`{transformation}/{publicId}`) with the secret appended, and that the output is a **SHA-256 digest encoded URL-safe Base64 and truncated to its first eight characters**, embedded as `s--{signature}--`. Assert the result is not a hex digest and does not equal what the upload signer would produce for the same input

### Schema and destructive migration

- [X] T007 Reshape `ListingPhoto` in `prisma/schema.prisma` per [data-model.md §2](./data-model.md): drop `data`/`mimeType`/`sizeBytes`; rename `position` → `displayOrder`; add `cloudinaryAssetId @unique`, `cloudinaryPublicId @unique`, `width`, `height`, `format`, `bytes`; add `@@unique([listingId, displayOrder])`. Leave `Listing` completely untouched — `coverPhotoId` and both relations stay exactly as they are
- [X] T008 Add the `PendingListingMedia` model to `prisma/schema.prisma` per [data-model.md §3](./data-model.md), including `cloudinaryPublicId @unique`, `expiresAt`, the `Account` relation with `onDelete: Cascade`, and both indexes
- [X] T009 Add the `MediaCleanupTask` model to `prisma/schema.prisma` per [data-model.md §4](./data-model.md), including `cloudinaryPublicId @unique`, `attempts`, `lastError`, `nextAttemptAt`, and the `nextAttemptAt` index. Deliberately no `listingId` and no community scoping
- [X] T010 Generate the migration with `npx prisma migrate dev --name replace_listing_photos_with_cloudinary`, then **hand-edit the emitted SQL** so the operations run in [data-model.md §6](./data-model.md)'s order and step 3 is an `ALTER TABLE … RENAME COLUMN position TO display_order` rather than Prisma's default drop-and-add. Take a verified database backup before applying anywhere with real data — this migration destroys user-uploaded content irreversibly
- [X] T011 Run `npx prisma generate` and confirm `npm run typecheck` now fails only in the places the cutover is expected to break (`listingService.ts` byte handling, the two photo route handlers, `ListingForm.tsx`, the three rendering surfaces, `tests/contract/test_listings.ts`). This failure list is the cutover work-list for Phases 3–9

### Cloudinary access module

- [X] T012 [P] Create `src/lib/cloudinary/signature.ts` with **two independent functions sharing no code path** (server-only; must make T006 pass):
  - `signUploadParams(params)` — take every signed upload **body** parameter, sort keys alphabetically, join `k=v&k=v`, append `CLOUDINARY_API_SECRET`, and return the **SHA-256 hex** digest. Signed params are `timestamp`, `public_id`, `type`, `allowed_formats`, `max_file_size`, `context`, plus any other applicable body parameter. **Excluded from the string-to-sign**: `file`, `cloud_name`, `resource_type`, `api_key` — `resource_type=image` lives in the endpoint URL path (`/image/upload`), not in the signed string. No `folder` parameter exists to sign
  - `signDeliveryPath(transformation, publicId)` — sign exactly the URL components that follow the signature component, i.e. `{transformation}/{publicId}`, append the secret, take the **SHA-256** digest, encode it **URL-safe Base64**, and return the **first eight characters** for embedding as `s--{signature}--`. Do not call or wrap `signUploadParams` — same secret, different algorithm and different encoding
- [X] T013 [P] Create `src/lib/cloudinary/variants.ts` with the frozen three-entry table from [research.md #6](./research.md) — `thumbnail: c_limit,w_320,f_auto,q_auto`, `card: c_limit,w_640,f_auto,q_auto`, `detail: c_limit,w_1280,f_auto,q_auto` — plus a `resolveVariant(name)` that returns the `card` entry for anything unrecognized. **Lookup only, never interpolation.** Must make T005 pass
- [X] T014 Create `src/lib/cloudinary/delivery.ts` exporting `signedDeliveryUrl(publicId, variant)` building a `type: authenticated` URL as `…/image/authenticated/s--{sig}--/{transformation}/{publicId}` using `signDeliveryPath()` (never `signUploadParams()`), and `fetchAssetBytes(publicId, variant, acceptHeader)` returning bytes plus content type. Depends on T012, T013
- [X] T015 [P] Create `src/lib/cloudinary/admin.ts` exporting `verifyAsset(publicId, { expectedPrefix, expectedAccountId, expectedDraftId })` and `destroyAsset(publicId)` (signed destroy `POST` with `invalidate: true`). `verifyAsset` calls the authenticated Admin API `GET` (HTTP Basic `api_key:api_secret`) and confirms **all four**: the returned `public_id` starts with the exact expected prefix `cmarket/{env}/listings/{draftId}/`; the asset's `context` carries the expected account and draft; `resource_type === "image"`; and `type === "authenticated"`. **No folder-field comparison** — provenance is established by the public-ID prefix plus context, so the check works identically under fixed-folder and dynamic-folder accounts. Depends on T012
- [X] T016 [P] Add failure logging across `src/lib/cloudinary/` that records `publicId`, operation, HTTP status, and Cloudinary's message, and **never** the signature, the signed delivery URL, the API key, or the secret (FR-100, FR-104). A `publicId` in a server log is fine; FR-056 governs browser-reachable responses only

### Legacy removal in the service layer

- [X] T017 In `src/server/services/listingService.ts`, change `MAX_PHOTOS_PER_LISTING` from `6` to `8` (FR-004) and delete `MAX_PHOTO_BYTES` and `ALLOWED_PHOTO_MIME_TYPES` — both move into signed upload params ([research.md #5](./research.md))
- [X] T018 In `src/server/services/listingService.ts`, remove `addListingPhoto()`'s `data`/`mimeType` inputs and its `invalid_photo` result branch. Photo creation moves to `listingMediaService` (T034); keep only what genuinely belongs to a listing
- [X] T019 Create `src/server/services/mediaCleanupService.ts` with `enqueueCleanup(tx, publicIds)` writing idempotent `MediaCleanupTask` rows inside a caller-supplied transaction. The drain half comes later (T081) — enqueue is needed by Phases 3–5 and so belongs here

**Checkpoint**: schema cut over, Cloudinary module usable and unit-tested, cleanup enqueue available. Story phases can begin.

---

## Phase 3: User Story 1 - Upload multiple listing images through CMarket's interface (Priority: P1) 🎯 MVP

**Goal**: A member selects several images in one action inside the existing create/edit forms, sees each previewed, and has them uploaded direct-to-Cloudinary and associated with the saved listing — with no Cloudinary Upload Widget anywhere.

**Independent Test**: Open `/communities/{id}/listings/new`, select five valid images in one file-picker action, confirm five preview tiles appear, submit, and confirm five `ListingPhoto` rows exist for the listing. Verifiable without the delivery proxy — previews are local object URLs and association is checked in the database and the response.

### Tests for User Story 1 ⚠️ Write first, confirm they FAIL

- [X] T020 [P] [US1] In `tests/contract/test_listing_media.ts` (new), write authorize-endpoint tests for **both modes** and confirm they FAIL:
  - **Initial authorization**: returns `url`/`apiKey`/`timestamp`/`signature`/`publicId`/`type`/`context` and **no `folder` field**; writes exactly one `PendingListingMedia` row with `expiresAt ≈ now + 30 min`; `400 invalid_input` for malformed ids or `listingId !== draftId`; `409 photo_limit_reached` when 8 are already associated-plus-pending (FR-004); `500 provider_unconfigured` when config is missing (FR-106)
  - **Retry authorization** (a previously server-issued `publicId` is supplied): returns fresh signed params for **the same** `publicId`; creates **no** additional `PendingListingMedia` row; does **not** count that file a second time against the eight-photo cap; refuses with `403` when the pending row belongs to a different `accountId` or a different `draftId`; refuses when the row has expired; refuses a `publicId` that has no pending row at all

  Together these pin the invariant that matters: **retrying a file never mints a second identity for it.**
- [X] T021 [P] [US1] In `tests/contract/test_listing_media.ts`, write association-endpoint tests and confirm they FAIL: a full ordered set creates contiguous `ListingPhoto` rows from `displayOrder: 0`; `PendingListingMedia` rows are consumed and deleted; the same `publicId` submitted twice creates exactly one row (FR-019); `409 photo_limit_reached` beyond 8 combined; `422 asset_not_found` when `verifyAsset` misses; `503 provider_unavailable` leaves pending rows intact so a resubmit succeeds without re-upload (FR-077)
- [X] T022 [P] [US1] Rewrite the photo blocks of `tests/contract/test_listings.ts` against the Cloudinary model and confirm they FAIL: the 6-photo assertion at line 393 becomes 8; the `Buffer`-based oversize/wrong-MIME fixtures at lines 359-389 are **deleted with no successor**, because upload bytes never reach the server. Do not leave a legacy code path alive to keep an old test green (FR-096)
- [X] T023 [P] [US1] Write `tests/integration/test_listing_media_flow.spec.ts` (new) covering multi-select and confirm it FAILS: five files chosen in one action produce five preview tiles; no request is made for Cloudinary's `widget.js` or any `upload-widget` asset (FR-002, SC-002); a 9th file is rejected with a maximum-photo message; an unsupported type and an oversize file are each rejected with a message naming that file (FR-013); the form still saves with zero images and shows the existing placeholder

### Implementation for User Story 1

- [X] T024 [US1] Create `src/server/services/listingMediaService.ts` with `authorizeUpload({ accountId, communityId, draftId, listingId, publicId? })` supporting **two modes**, sharing one authorization gate — reject a MASTER **first**, then require current membership, then `isCommunityActive`, then (edit path) listing ownership:
  - **Initial** (`publicId` absent): generate `cmarket/{env}/listings/{draftId}/{16-byte-hex}` ([research.md #5](./research.md)), enforce the eight-photo cap across associated plus pending, and write one `PendingListingMedia` row
  - **Retry** (`publicId` present): look up the unexpired `PendingListingMedia` row by `accountId` + `draftId` + `cloudinaryPublicId`; reject if it is missing, expired, or owned by another account or draft. Reuse **that exact** public ID, write **no** new row, and skip the cap check — the file is already counted, and re-counting it would make a retry of the eighth photo fail

  Both modes sign `timestamp`, `public_id`, `type: authenticated`, `allowed_formats=jpg,png,webp`, `max_file_size=10485760`, `context` — sorted alphabetically, hex digest, via `signUploadParams()`. **No `folder` parameter is sent or signed**, and `resource_type` is not signed; it lives in the endpoint URL path
- [X] T025 [US1] Add `associatePhotos({ accountId, listingId, draftId, photos, coverPublicId })` to `listingMediaService.ts` executing [contracts §3](./contracts/listing-media-api.md)'s seven steps in one `$transaction`: match each `publicId` against a `PendingListingMedia` row on **both** `publicId` and `accountId`; `verifyAsset` each against the expected public-ID prefix, account/draft context, `resource_type: image`, and `type: authenticated` (T015); upsert `ListingPhoto` keyed on `cloudinaryPublicId`; rewrite `displayOrder` contiguous **via a temporary offset** (an in-place swap transiently violates `@@unique([listingId, displayOrder])`); set `Listing.coverPhotoId`; delete consumed pending rows; enqueue cleanup for dropped photos
- [X] T026 [US1] Create `app/api/listing-media/authorize/route.ts` — `POST` accepting an optional `publicId` to select retry mode, and mapping `authorizeUpload`'s result to `200`/`400`/`401`/`403`/`409`/`500` per [contracts §2](./contracts/listing-media-api.md). The response deliberately carries `apiKey`, `timestamp`, `signature`, and `publicId`; it MUST NOT carry the API secret (FR-108) and MUST NOT carry a `folder` field
- [X] T027 [US1] Replace `app/api/communities/[communityId]/listings/[listingId]/photos/route.ts`: delete the multipart `POST` and its `FormData`/`Buffer` handling entirely, and implement the JSON association `POST` per [contracts §3](./contracts/listing-media-api.md). The response returns `id`, `width`, `height`, `displayOrder`, `isCover` and **omits `publicId`, `format`, and any URL** — it is a listing read, and a persisted public ID does not belong there (FR-056)
- [X] T028 [P] [US1] Create `app/communities/[communityId]/listings/ListingMediaTile.tsx` — one pending or saved photo: local object-URL preview (revoked on removal), per-file state badge (`queued`/`uploading`/`uploaded`/`failed`), progress bar, and Remove / Retry / Move-left / Move-right / Set-cover controls. Presentational; all state is owned by the container
- [X] T029 [US1] Create `app/communities/[communityId]/listings/ListingMediaUploader.tsx` — Client Component owning a `Map` of file-id → per-file state, **kept separate from display order** ([research.md #10](./research.md)); one `<input type="file" multiple accept="image/jpeg,image/png,image/webp">`; client-side type/size rejection before any upload with a per-file dismissible error row; a generated `draftId` per form session; and the 8-photo cap across pending plus already-saved photos
- [X] T030 [US1] Rewrite the media part of `app/communities/[communityId]/listings/ListingForm.tsx`: delete `uploadPhotos()` and the raw `<input type="file">` (lines 72-82 and 215-223), mount `ListingMediaUploader`, and post the ordered public-ID set to the association endpoint **after** the listing is created or updated. A duplicate file selection must remain a distinct entry
- [X] T031 [US1] Rewrite `getListingPhoto()`'s body in `src/server/services/listingService.ts` so its successful **internal** result carries exactly `cloudinaryAssetId`, `cloudinaryPublicId`, `width`, and `height` instead of `data`/`mimeType`, **keeping its existing authorization gate verbatim** — `requireCommunityMembership(..., { allowSuspended: true })` then verify the photo's listing matches `communityId`. `cloudinaryAssetId` is required because the delivery `ETag` is derived from it (T057) and `cloudinaryPublicId` because the fetch resolves by it; **neither may reach a proxy response or a listing-read payload** (FR-056). This is a server-internal shape only. The delivery route in Phase 6 consumes it; do not reinvent the gate there

**Checkpoint**: a member can select, preview, and upload multiple images and have them associated with a listing. Saved photos are not yet viewable — that is US4.

---

## Phase 4: User Story 2 - Arrange photos and choose a cover image (Priority: P1)

**Goal**: The owner controls gallery order and picks the cover, and the saved order is the member's chosen order regardless of upload-completion order.

**Independent Test**: Select four images, reverse their order with the move buttons, choose the third as cover, save, and confirm `displayOrder` matches the chosen order and `Listing.coverPhotoId` points at the chosen photo.

### Tests for User Story 2 ⚠️ Write first, confirm they FAIL

- [X] T032 [P] [US2] In `tests/contract/test_listing_media.ts`, write ordering and cover tests and confirm they FAIL: with no explicit cover, `displayOrder: 0` becomes the cover (FR-016); an explicit `coverPublicId` becomes the only cover, duplicating and removing nothing; a payload whose order differs from insertion order is honoured (FR-017); `displayOrder` stays contiguous from 0 after add, remove, and reorder (FR-020); `400 invalid_input` when `coverPublicId` is absent from `photos`
- [X] T033 [P] [US2] In `tests/contract/test_listing_media.ts`, write reorder-endpoint tests and confirm they FAIL: a permutation of the current set succeeds; a set with an addition or omission returns `409 stale_photo_set`; `403 not_owner` for a non-owner; `409 community_not_active` when suspended; a two-element swap succeeds, proving the temporary-offset rewrite does not trip `@@unique([listingId, displayOrder])`
- [X] T034 [P] [US2] Confirm the existing cover-behaviour tests at `tests/contract/test_listings.ts:569-650` still express the same assertions with only their setup changed — cover semantics are unchanged by this feature ([research.md #4](./research.md)), so a rewritten assertion there is a signal something drifted
- [X] T035 [P] [US2] In `tests/integration/test_listing_media_flow.spec.ts`, write ordering tests and confirm they FAIL: reorder four throttled uploads mid-flight, choose the third as cover, save, then confirm the detail gallery renders the chosen order and the community-view card shows the chosen cover (SC-003, SC-004). Reordering must succeed by **clicks alone**, no drag (FR-010, SC-014)

### Implementation for User Story 2

- [X] T036 [US2] Add `reorderPhotos({ accountId, listingId, photoIds, coverPhotoId })` to `src/server/services/listingMediaService.ts`: owner-only, `isCommunityActive`, reject any set that is not an exact permutation of the listing's current photos with `stale_photo_set`, then rewrite `displayOrder` via the temporary offset and set `coverPhotoId`
- [X] T037 [US2] Create `app/api/communities/[communityId]/listings/[listingId]/photos/order/route.ts` — `PATCH` per [contracts §4](./contracts/listing-media-api.md), returning the same shape as the association endpoint
- [X] T038 [US2] Add move-left / move-right and set-cover handling to `ListingMediaUploader.tsx`, reordering the display array **without disturbing in-flight uploads** — this is what keeps FR-017 true, and it is why per-file state is keyed by file id rather than by index
- [X] T039 [US2] Keep `app/api/communities/[communityId]/listings/[listingId]/cover/route.ts`'s contract byte-identical while pointing its internals at the reshaped model. Its existing contract tests must pass unchanged ([contracts §6](./contracts/listing-media-api.md))

**Checkpoint**: order and cover are member-controlled and survive out-of-order upload completion.

---

## Phase 5: User Story 3 - See upload progress and recover from failures (Priority: P1)

**Goal**: Per-file progress and state, bounded to three concurrent uploads, with per-file retry and remove that never re-send a successful upload.

**Independent Test**: Upload four images with `api.cloudinary.com` blocked after the first two complete; confirm two read `uploaded` and the rest offer Retry and Remove; retry one and confirm exactly one new Cloudinary request.

### Tests for User Story 3 ⚠️ Write first, confirm they FAIL

- [X] T040 [P] [US3] In `tests/integration/test_listing_media_flow.spec.ts`, write progress and concurrency tests and confirm they FAIL: each file shows its own state; with eight files selected, **never more than three** uploads are in flight at any moment (FR-011, SC-020) — assert by counting concurrent intercepted requests, not by timing
- [X] T041 [P] [US3] In `tests/integration/test_listing_media_flow.spec.ts`, write failure-recovery tests and confirm they FAIL: route-intercept a forced failure on two of four files; the two successes stay `uploaded` and are never re-sent; Retry re-authorizes and re-uploads **only** that file (FR-009, SC-005); Remove aborts an in-flight upload and drops the entry; submission is blocked while any file is `queued`/`uploading` with a visible explanation (FR-012)
- [X] T042 [P] [US3] In `tests/integration/test_listing_media_flow.spec.ts`, write the re-authorization test and confirm it FAILS: a queued file that has been waiting past the **client-side refresh threshold** re-authorizes in retry mode against its still-valid `PendingListingMedia` row and uploads, without restarting completed uploads (FR-009, [data-model.md §3](./data-model.md)). Assert the retry request carries the **same** `publicId` it was originally issued, that the response returns that same `publicId` with a fresh `timestamp` and `signature`, and that no second `PendingListingMedia` row appears. The threshold is CMarket's own client-side staleness policy — **do not assert that Cloudinary rejects a signature at any particular age**

### Implementation for User Story 3

- [X] T043 [US3] Add a promise-pool to `ListingMediaUploader.tsx` — three workers pulling from a queue, per [research.md #10](./research.md). Bounded concurrency must be structural, not a timing coincidence
- [X] T044 [US3] Implement per-file upload in `ListingMediaUploader.tsx` using `XMLHttpRequest` with `upload.onprogress`, **with a comment stating that `fetch` is not used because it still exposes no upload-progress event** — otherwise a future "modernization" silently removes FR-007
- [X] T045 [US3] Add per-file `AbortController` wiring so Remove cancels an in-flight upload in `ListingMediaUploader.tsx`, and revoke that file's object URL to avoid a leak
- [X] T046 [US3] Add retry in `ListingMediaUploader.tsx` that re-authorizes that one file in **retry mode** — sending back the `publicId` the server originally issued for it — before re-uploading, leaving every other file's state untouched. Also refresh authorization for any file still `queued` past the client-side staleness threshold before its upload starts. The component keeps each file's issued `publicId` in its per-file state precisely so a retry reuses the same asset identity rather than requesting a new one
- [X] T047 [US3] Disable the submit control in `ListingForm.tsx` while any file is `queued`/`uploading`/`failed`, with a visible message distinguishing "still uploading" from "one file failed — retry or remove it" (FR-012, FR-076)

**Checkpoint**: an unstable connection costs one file, not the batch.

---

## Phase 6: User Story 4 - Display images through authenticated CMarket delivery (Priority: P1)

**Goal**: Every listing image reaches the browser through an authenticated CMarket route that re-checks session and membership on every request, streams bytes, and leaks nothing about Cloudinary.

**Independent Test**: Open a listing with photos, confirm every `img src` is `/api/communities/{id}/listing-photos/{id}?v=…`, then confirm the same URL returns 401 with no cookie, 403 for a non-member, and 404 for a photo in another community.

**Note**: testable with seeded `ListingPhoto` rows, so it does not strictly require US1 — but US1 first makes it far easier to exercise.

### Tests for User Story 4 ⚠️ Write first, confirm they FAIL

- [X] T048 [P] [US4] Write `tests/contract/test_listing_photo_delivery.ts` (new) covering the gate and confirm it FAILS: `401` unauthenticated; `403` for a non-member; `403` for a MASTER (no special-case needed — a MASTER holds no membership); `404` for a nonexistent photo, a photo whose listing is in another community, and a listing with a stale `operationalEpoch` — **all three byte-for-byte identical**, since a distinguishable response would confirm another community's photo exists (FR-054)
- [X] T049 [P] [US4] In `tests/contract/test_listing_photo_delivery.ts`, write caching tests and confirm they FAIL: a `200` carries `Cache-Control: private, no-cache`, a **weak** `ETag: W/"{cloudinaryAssetId}-{variant}"`, and `Vary: Accept`, and **never** `max-age`, `s-maxage`, or `public` (FR-058). The validator must be weak because `f_auto` negotiates format from `Accept`, so the same variant legitimately yields different bytes — a strong validator would be a false claim of byte-equality. Assert the `ETag` differs between variants and is stable across repeated requests for the same variant
- [X] T050 [P] [US4] In `tests/contract/test_listing_photo_delivery.ts`, write the **authorization-before-`304`** tests and confirm they FAIL (FR-109): a valid `If-None-Match` from a still-authorized member returns `304`; the same valid `ETag` from a caller who has lost membership returns `403`/`404` and **not** `304`; the same `ETag` from a different account against another community's photo returns `404` and **not** `304`. This is the highest-value test in the phase — the natural implementation checks `If-None-Match` early as a fast path and thereby hands cached bytes to someone no longer entitled to them
- [X] T051 [P] [US4] In `tests/contract/test_listing_photo_delivery.ts`, write no-leak and no-redirect tests and confirm they FAIL: the response status is `200`, never `3xx`, and carries no `Location` header (FR-107); no body or header contains `res.cloudinary.com`, a signed source URL, a public ID, or the cloud name (FR-056); each variant name maps to its expected transformation; `?v=w_9999,c_crop` resolves to `card` and is never forwarded (FR-060, FR-061); a deleted photo returns `404` (FR-078)
- [X] T052 [P] [US4] Write `tests/unit/test_no_cloudinary_in_client_bundle.ts` (new) and confirm it FAILS: `CLOUDINARY_API_SECRET` appears in no `.next` client chunk; the **delivery** host `res.cloudinary.com` appears in no client chunk; no source file references a `NEXT_PUBLIC_CLOUDINARY_*` name; no client component imports `src/lib/cloudinary/`. **Deliberately does not assert on the bare word "cloudinary" or on `api.cloudinary.com`** — the uploader legitimately receives an upload endpoint at runtime (FR-108), so a blunt keyword check would either fail spuriously or be weakened until it proved nothing
- [X] T053 [P] [US4] In `tests/integration/test_listing_media_flow.spec.ts`, write rendering tests and confirm they FAIL: every `img src` points at the proxy route; rendered listing markup contains no `res.cloudinary.com`; non-cover gallery images carry `loading="lazy"` (FR-067); images carry `width`/`height` from stored dimensions (FR-068); no horizontal overflow at 375px (FR-065); `alt` reads like `"<title> — photo 2 of 3"` and never a filename or cuid (FR-066); and a legacy image-less listing renders the existing `data-testid="listing-cover-placeholder"` (FR-069, SC-018)
- [X] T054 [P] [US4] In `tests/integration/test_listing_media_flow.spec.ts`, assert the **permitted** half of the exposure boundary and confirm it FAILS: the authorize response *does* carry an upload endpoint, `apiKey`, `timestamp`, `signature`, and `publicId`, and *does not* carry the API secret (FR-108). Pinning both halves stops a future tightening of the leak check from silently breaking uploads

### Implementation for User Story 4

- [X] T055 [US4] Create `app/api/communities/[communityId]/listing-photos/[photoId]/route.ts` — `GET` executing [contracts §1](./contracts/listing-media-api.md)'s seven steps **in the stated order**. Steps 1–3 are `getCurrentAccount()`, then `getListingPhoto()`'s gate (T031), then the photo-to-community check. `If-None-Match` is consulted at **step 4 only**, after authorization; it must not be an early fast path (FR-109)
- [X] T056 [US4] In `app/api/communities/[communityId]/listing-photos/[photoId]/route.ts`, resolve `?v=` through `resolveVariant()` (T013), call `fetchAssetBytes()` (T014) forwarding the client's `Accept` header so `f_auto` can negotiate, and **stream the bytes** in the response. Never `redirect()`, never `NextResponse.redirect` — a `302` to a signed URL would deposit a read capability in the browser's history and referrers (FR-107)
- [X] T057 [US4] In `app/api/communities/[communityId]/listing-photos/[photoId]/route.ts`, set `Cache-Control` from `LISTING_IMAGE_CACHE_MODE` (`no-cache` default, `no-store` optional — never a `max-age`), plus `ETag: W/"{cloudinaryAssetId}-{variant}"` built from T031's internal result, `Vary: Accept`, and the negotiated `Content-Type`. The `ETag` is a **weak** validator because `f_auto` makes bytes vary by `Accept`. `cloudinaryAssetId` is used to *derive* the header and must not be emitted in any other form (FR-056). Map upstream failure to a generic `502` with the Cloudinary detail logged server-side only, signed URL omitted (FR-104)
- [X] T058 [US4] Create `app/_components/ListingImage.tsx` rendering a plain `<img>` with `src` built as `/api/communities/{communityId}/listing-photos/{photoId}?v={variant}`, a closed `variant` union, stored `width`/`height`, required `alt`, and `loading`. **This file holds the single `eslint-disable-next-line @next/next/no-img-element`**, with a comment explaining that delivery is proxied and `next/image` is deliberately not used. A suppression anywhere else is a review defect
- [X] T059 [US4] Add the no-photo placeholder branch to `ListingImage.tsx`, preserving the existing markup and `data-testid="listing-cover-placeholder"` so current tests keep passing (FR-069)
- [X] T060 [P] [US4] Replace the inline `<img>` at `app/communities/[communityId]/page.tsx:98-113` with `ListingImage` at `variant="card"`, keeping the `aspect-[4/3]` container and `object-cover`, and removing that file's `no-img-element` suppression
- [X] T061 [P] [US4] Replace the inline `<img>` at `app/communities/[communityId]/listings/page.tsx:98-113` the same way, removing its suppression
- [X] T062 [P] [US4] Replace the gallery `<img>` at `app/communities/[communityId]/listings/[listingId]/page.tsx:53-64` with `ListingImage` at `variant="thumbnail"`, ordered by `displayOrder`, with `loading="lazy"` on every image after the first, and remove its suppression
- [X] T063 [US4] Update `getListing()` and `listListings()` in `src/server/services/listingService.ts` so their returned photo shapes carry `id`, `width`, `height`, and `displayOrder` — everything `ListingImage` needs — and **no `cloudinaryPublicId`**, keeping a persisted Cloudinary identifier out of listing reads (FR-056)

**Checkpoint**: images render everywhere they did before, gated on every request, with nothing Cloudinary visible to the browser.

---

## Phase 7: User Story 5 - Securely authorize browser uploads (Priority: P1)

**Goal**: Upload authorization and every media mutation are refused for unauthenticated callers, non-members, non-owners, and MASTER identities, and a forged asset identifier can never be associated.

**Independent Test**: Request authorization and attempt association as each unauthorized caller type, and confirm each is refused with no `ListingPhoto` row created.

**Note**: the endpoints exist from US1/US2; this phase is the security matrix over them plus the hardening they need.

### Tests for User Story 5 ⚠️ Write first, confirm they FAIL

- [X] T064 [P] [US5] In `tests/contract/test_listing_media.ts`, write the authorization matrix and confirm it FAILS: for **each** of authorize, associate, reorder, set-cover, and remove — `401` unauthenticated, `403 not_a_member`, `403 not_owner`, and `403 not_authorized` for a MASTER (FR-026–FR-028, FR-032, SC-011). Assert the MASTER check runs **before** the membership check, so the reason returned is `not_authorized` rather than the accidental `not_a_member`
- [X] T065 [P] [US5] In `tests/contract/test_listing_media.ts`, write asset-provenance tests and confirm they FAIL: a `publicId` with no `PendingListingMedia` row returns `403 unauthorized_asset` and creates nothing; a `publicId` whose row belongs to a **different account** is likewise refused, proving the match is on `accountId` and not on the client-supplied `draftId` alone (FR-030, FR-031); an expired row is refused
- [X] T066 [P] [US5] In `tests/contract/test_listing_media.ts`, write signed-parameter tests and confirm they FAIL: `timestamp`, `public_id`, `type`, `allowed_formats`, `max_file_size`, and `context` are all inside the signature, so a client that alters any of them invalidates it — this is what makes FR-033's server-side enforcement real rather than advisory. Also assert the **exclusions**: `resource_type`, `cloud_name`, `api_key`, and `file` are absent from the string-to-sign, and no `folder` parameter is sent or signed at all. `resource_type=image` is enforced by the endpoint URL path and re-checked at `verifyAsset`, not by the signature
- [X] T067 [P] [US5] In `tests/contract/test_listing_media.ts`, write a membership-race test and confirm it FAILS: an account that loses membership between authorization and association is refused at association (Edge Cases)

### Implementation for User Story 5

- [X] T068 [US5] Harden `authorizeUpload()` in `listingMediaService.ts` so the gate order is exactly MASTER → authenticated → current member → community active → (edit path) owner, matching [contracts §"Authorization gates"](./contracts/listing-media-api.md), and add the `expiresAt` check to the association path
- [X] T069 [US5] Re-verify membership inside `associatePhotos()` in `src/server/services/listingMediaService.ts` rather than trusting the earlier authorization, closing the race in T067
- [X] T070 [US5] Add the MASTER rejection via `getCurrentMaster()` to `app/api/listing-media/authorize/route.ts`, the association route, the order route, the cover route, and the photo `DELETE` route — five call sites, and Principle IX means a miss on any one is a constitutional violation, not a cosmetic gap
- [X] T071 [US5] Confirm `CLOUDINARY_API_SECRET` is referenced only inside `src/lib/cloudinary/` and never returned, rendered, or logged, and that `src/lib/cloudinary/` is imported by no client component. Make T052 pass

**Checkpoint**: the upload path cannot be used as unauthenticated storage, and a forged identifier associates nothing.

---

## Phase 8: User Story 6 - Edit and delete Cloudinary listing media (Priority: P2)

**Goal**: An owner can remove, replace, and re-cover photos after publication, and every unreferenced asset eventually leaves Cloudinary — including after a transient failure.

**Independent Test**: Remove one of three photos and save; confirm it vanishes from every surface, its proxy URL 404s, and a `MediaCleanupTask` row exists; drain the queue and confirm the asset is gone from Cloudinary.

### Tests for User Story 8 ⚠️ Write first, confirm they FAIL

- [X] T072 [P] [US6] In `tests/contract/test_listing_media.ts`, write photo-removal tests and confirm they FAIL: deleting a photo removes its row, enqueues exactly one `MediaCleanupTask`, rewrites `displayOrder` contiguous — **a change from today's documented gap-leaving** (FR-020) — and reassigns the cover deterministically when the removed photo was the cover (FR-018)
- [X] T073 [P] [US6] Write the **`deleteListing` ordering** test in `tests/contract/test_listings.ts` and confirm it FAILS: deleting a listing with three photos leaves exactly three `MediaCleanupTask` rows. Zero rows means cleanup was enqueued after `ListingPhoto`'s `onDelete: Cascade` had already destroyed the only record those assets existed — the trap in [data-model.md §4](./data-model.md), which silently orphans every asset of every deleted listing
- [X] T074 [P] [US6] Write cleanup-drain tests in `tests/contract/test_media_cleanup.ts` (new) and confirm they FAIL: a due row is destroyed with `invalidate: true` and deleted; a transient failure increments `attempts`, records `lastError`, and pushes `nextAttemptAt` out by `2^attempts` minutes capped at 24h; enqueueing the same `publicId` twice yields one row; expired unassociated `PendingListingMedia` rows are swept into cleanup (FR-083); a bad `X-Cleanup-Token` returns `401`
- [X] T075 [P] [US6] Write the cleanup-non-blocking test in `tests/contract/test_media_cleanup.ts` and confirm it FAILS, asserting the two halves **separately** (FR-085) — a Cloudinary outage must not become a listing-editing outage:
  - **Removal half**: removing a photo succeeds and `destroyAsset` is **never called** during it. Assert the stub records zero calls, and that exactly one `MediaCleanupTask` row is committed. Do not assert that removal calls Cloudinary — it does not, by design, which is precisely what makes it outage-proof
  - **Drain half**: with `destroyAsset` stubbed to fail, run `drainCleanup()` and assert the task row is still **present**, `attempts` incremented, `lastError` recorded, and `nextAttemptAt` moved forward — and that the listing edit performed before the drain remains committed and unaffected
- [X] T076 [P] [US6] In `tests/integration/test_listing_media_flow.spec.ts`, write an edit-flow test and confirm it FAILS: on an existing listing, remove one photo, upload a replacement, change the cover, save, and confirm the final gallery and cover match — with already-saved photos previewing through the proxy at `v=thumbnail` while pending files preview from local object URLs

### Implementation for User Story 6

- [X] T077 [US6] Add `removePhoto({ accountId, listingId, photoId })` to `listingMediaService.ts`: owner-only, `isCommunityActive`, and in one transaction delete the row, enqueue cleanup, rewrite `displayOrder` via the temporary offset, and reassign the cover using the existing deterministic rule
- [X] T078 [US6] Update `app/api/communities/[communityId]/listings/[listingId]/photos/[photoId]/route.ts`: **delete the byte-serving `GET` handler entirely** (superseded by T055) and point `DELETE` at `removePhoto`, keeping its `204`/`403`/`404` contract byte-identical ([contracts §5](./contracts/listing-media-api.md))
- [X] T079 [US6] Modify `deleteListing()` in `src/server/services/listingService.ts` to read the listing's photo `publicId`s and enqueue their cleanup rows **inside the existing `$transaction`, before `listing.delete()`**. Order is: read publicIds → enqueue → cancel PENDING transactions (existing, unchanged) → delete. Reversing enqueue and delete is the silent-orphan bug T073 exists to catch
- [X] T080 [US6] Add `drainCleanup({ limit })` to `src/server/services/mediaCleanupService.ts`: select `nextAttemptAt <= now()`, call `destroyAsset` with `invalidate: true`, delete on success, and on failure increment `attempts`, record `lastError`, and back off `2^attempts` minutes capped at 24h
- [X] T081 [US6] Add expired-pending sweeping to `mediaCleanupService.ts`: for each `PendingListingMedia` with `expiresAt < now()` and no referencing `ListingPhoto`, enqueue cleanup and delete the pending row (FR-083)
- [X] T082 [US6] Create `app/api/listing-media/cleanup/route.ts` — `POST` authenticated by an `X-Cleanup-Token` header compared with `crypto.timingSafeEqual` (a scheduler, not a person), returning `{ processed, deleted, failed, expiredPendingSwept }` per [contracts §7](./contracts/listing-media-api.md)
- [X] T083 [US6] Make already-saved photos in `ListingMediaUploader.tsx` preview through `ListingImage` at `variant="thumbnail"` while pending files keep their local object URLs — a pending upload has no `ListingPhoto` row and so is unreachable through the proxy ([data-model.md §3](./data-model.md))

**Checkpoint**: media is fully editable post-publication and storage does not leak.

---

## Phase 9: User Story 7 - Replace the previous image system completely (Priority: P1)

**Goal**: Exactly one Cloudinary-backed implementation handles every listing-media operation, with no legacy field, route, service, or rendering branch left alive.

**Independent Test**: Run the cutover audit greps from [quickstart.md §8](./quickstart.md) and confirm each reports clean, and that a pre-cutover listing renders the placeholder with no console error and no 404.

**Note**: the destructive schema half of this story is Phase 2 (T007–T011) because everything else depends on it. This phase is the **audit and sweep** — the part that is only checkable once Phases 3–8 have landed.

### Tests for User Story 7 ⚠️ Write first, confirm they FAIL

- [X] T084 [P] [US7] Write `tests/unit/test_no_legacy_image_paths.ts` (new) and confirm it FAILS: no source file under `src/` or `app/` references `MAX_PHOTO_BYTES`, `ALLOWED_PHOTO_MIME_TYPES`, `mimeType` on a photo, `sizeBytes`, or `photo.data`; no route file exports a `GET` under `listings/[listingId]/photos/[photoId]`; and `@next/next/no-img-element` is suppressed in exactly one file, `app/_components/ListingImage.tsx`
- [X] T085 [P] [US7] Write a schema-shape assertion in `tests/contract/test_listing_media.ts` and confirm it FAILS: `information_schema` shows no `data`, `mime_type`, `size_bytes`, or `secure_url` column on `listing_photos`, and shows `display_order` rather than `position`
- [X] T086 [P] [US7] In `tests/integration/test_listing_media_flow.spec.ts`, write the legacy-listing test and confirm it FAILS: a listing whose photos were deleted by the migration renders the no-photo placeholder on the community view, the discovery view, and its detail page, with no 404 request and no console error (FR-089, SC-018)

### Implementation for User Story 7

- [X] T087 [US7] Sweep `src/server/services/listingService.ts`, `src/server/services/listingMediaService.ts`, and every file under `app/api/communities/` and `app/communities/` for remaining references to the removed byte fields and delete them, using T011's typecheck failure list as the work-list. Make `tests/unit/test_no_legacy_image_paths.ts` pass
- [X] T088 [US7] Confirm no runtime path in `src/server/services/listingService.ts` or `src/server/services/listingMediaService.ts` performs a fallback read against the previous implementation (FR-088) — a fallback branch is exactly the "two parallel implementations" FR-091 forbids, and it would make the placeholder in T086 unreachable
- [X] T089 [US7] Verify `next.config.ts` and `src/server/services/profileService.ts` are **unmodified** by this feature, per the Explicitly NOT tasks list above. If either changed, revert it and record why in the plan
- [X] T090 [US7] Run the full cutover audit from [quickstart.md §8](./quickstart.md) and confirm every grep reports clean, including that `getListingPhoto()` **still exists** — its absence would mean its authorization gate was reinvented in the route instead of reused

**Checkpoint**: one media system, no legacy remnants.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T091 [P] Run `npm run test:unit` and `npm run test:e2e` and confirm every test file added or rewritten in Phases 2–9 passes — `tests/contract/test_listing_media.ts`, `tests/contract/test_listing_photo_delivery.ts`, `tests/contract/test_media_cleanup.ts`, `tests/contract/test_listings.ts`, `tests/unit/test_cloudinary_variants.ts`, `tests/unit/test_cloudinary_signature.ts`, `tests/unit/test_no_cloudinary_in_client_bundle.ts`, `tests/unit/test_no_legacy_image_paths.ts`, `tests/integration/test_listing_media_flow.spec.ts` — with none skipped and none passing because a legacy path was left alive to satisfy it (FR-096, SC-019)
- [X] T092 [P] Run `npm run lint` and `npm run typecheck` clean, expecting **exactly one** `@next/next/no-img-element` suppression, in `app/_components/ListingImage.tsx`
- [X] T093 [P] Verify every test file stubs the `src/lib/cloudinary/` boundary and that no test performs real network I/O to Cloudinary ([research.md #8](./research.md))
- [X] T094 [P] Walk [quickstart.md](./quickstart.md) scenarios end to end against a live Cloudinary account. Done via `scripts/verify-cloudinary-live.ts` (12/12 against cloud `n5kifrrq`), which discharges research.md #3's accepted signature-drift risk and **found a real defect**: `max_file_size` is not a signable upload parameter, so size enforcement moved to association time
- [X] T095 [P] Verify at 375px, 768px, and 1440px that `ListingMediaUploader.tsx` and all three rendering surfaces (`app/communities/[communityId]/page.tsx`, `app/communities/[communityId]/listings/page.tsx`, `app/communities/[communityId]/listings/[listingId]/page.tsx`) have no horizontal overflow, no distortion, and touch-only reorder (Principle V, SC-014)
- [X] T096 Add a CI job in `.github/workflows/` (create the workflow file if the repository has none) running `npm run test:unit` and `npm run test:e2e` on every pull request and **blocking merge** on failure — Principle VIII requires this explicitly: "a quality gate that depends on someone remembering to run it manually is not a gate"
- [X] T097 Document the deployment runbook additions in `README.md`: the six environment variables, the pre-migration verified backup, scheduling `POST /api/listing-media/cleanup` with `X-Cleanup-Token`, the requirement that **no shared cache or CDN** sit in front of `/api/communities/*/listing-photos/*`, and that outbound Cloudinary access is now needed at **read** time
- [X] T098 Draft the member-facing notice in `specs/017-cloudinary-listing-media/release-notice.md` stating that pre-cutover listing photos are gone and sellers should re-upload. This is the accepted cost of the hard cutover (FR-089), but it is user-visible and should not arrive unannounced

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: no dependencies
- **Phase 2 Foundational**: depends on Phase 1 — **BLOCKS everything else**. Contains the destructive migration and the Cloudinary module
- **Phases 3–9 User Stories**: all depend on Phase 2
- **Phase 10 Polish**: depends on every story phase you intend to ship

### User Story Dependencies

Stated honestly rather than claiming seven independent slices:

- **US1 (P1)** — after Phase 2. No story dependencies. Fully testable alone
- **US2 (P1)** — needs US1's association endpoint (order arrives in its payload). Testable alone once US1 lands
- **US3 (P1)** — needs US1's uploader component. Testable alone once US1 lands
- **US4 (P1)** — technically independent of US1 (seed `ListingPhoto` rows directly), but US1 first makes it far easier to exercise. **Highest-risk phase**: T050 and T055 carry Principle II
- **US5 (P1)** — the security matrix over US1's and US2's endpoints, plus their hardening. Needs both
- **US6 (P2)** — needs US1 (photos to remove) and Phase 2's `enqueueCleanup`. Lowest priority, and the only P2
- **US7 (P1)** — the audit half must come **last**, since it verifies the absence of things Phases 3–8 remove. Its schema half is already in Phase 2

### Within Each Story

Tests first and failing (Principle VIII) → service functions → route handlers → components → surface integration.

### Parallel Opportunities

- T005, T006 in parallel; then T012, T013, T015, T016 in parallel (T014 waits on T012+T013)
- All test-writing tasks inside a phase are `[P]` — different files or independent `describe` blocks
- T060, T061, T062 in parallel — three separate surface files
- With several developers: US2 and US3 can proceed in parallel after US1, and US4 in parallel with both
- **Do not parallelize** T024→T025→T027 or T055→T056→T057: each edits the file the previous one creates

---

## Parallel Example: User Story 4

```bash
# Write all US4 tests together, confirm all FAIL:
Task: "T048 Delivery gate tests in tests/contract/test_listing_photo_delivery.ts"
Task: "T049 Cache-header tests in tests/contract/test_listing_photo_delivery.ts"
Task: "T050 Authorization-before-304 tests in tests/contract/test_listing_photo_delivery.ts"
Task: "T051 No-leak and no-redirect tests in tests/contract/test_listing_photo_delivery.ts"
Task: "T052 Client-bundle tests in tests/unit/test_no_cloudinary_in_client_bundle.ts"
Task: "T053 Rendering tests in tests/integration/test_listing_media_flow.spec.ts"

# Then the three surface swaps together:
Task: "T060 ListingImage in app/communities/[communityId]/page.tsx"
Task: "T061 ListingImage in app/communities/[communityId]/listings/page.tsx"
Task: "T062 ListingImage in app/communities/[communityId]/listings/[listingId]/page.tsx"
```

---

## Implementation Strategy

### MVP scope

**Phase 1 + Phase 2 + US1 + US4.** US1 alone is not shippable: a member could upload photos but nobody could see them, because the byte endpoint US1 replaces is gone. US4 is what makes the feature visible, so the smallest honest increment is both. That is a deviation from the usual "US1 is the MVP" pattern, and it is a consequence of the hard cutover rather than of scope creep.

### Incremental delivery

1. Phases 1–2 → schema cut over, Cloudinary module tested. **Not deployable** — listing media is broken between here and US4
2. + US1 + US4 → upload and view work. **First deployable increment**
3. + US2 → order and cover
4. + US3 → progress and per-file recovery
5. + US5 → security matrix closed
6. + US7 audit → cutover verified
7. + US6 → post-publication editing and storage cleanup
8. Phase 10 → CI gate, runbook, member notice

**Do not deploy to production between steps 1 and 2.** The migration deletes existing photo bytes and the old byte route is removed, so any intermediate deploy shows placeholders everywhere with no upload path to fix it.

### Two ordering traps

Both are places where the obvious implementation is wrong, both have a dedicated test, and both are worth naming in review:

1. **T055 / T050** — authorization must complete before any `304`. Checking `If-None-Match` early as a cheap fast path returns "your cached copy is still good" to a caller who has lost membership or become a different account
2. **T079 / T073** — cleanup rows must be enqueued before `listing.delete()`. `ListingPhoto` cascades, so the delete destroys the only record of which Cloudinary assets existed; getting this backwards silently orphans every asset of every deleted listing

---

## Notes

- `[P]` = different files, no dependencies on incomplete work
- Tests must be written and **failing** before their implementation (Principle VIII, product listing is a named critical flow)
- Take a verified database backup before T010 anywhere holding real data — the migration is irreversible
- Commit after each task or logical group
- Stop at any checkpoint to validate independently
