# Phase 1 Quickstart: Cloudinary Listing Media Integration

**Feature**: `017-cloudinary-listing-media` | **Date**: 2026-08-06 | **Plan**: [plan.md](./plan.md)

**Revised 2026-08-06**: delivery is now an authenticated CMarket proxy. Scenario 4 is rewritten, the `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` variable is gone, and every `next/image` / `remotePatterns` check is removed.

**Amended 2026-08-06**: scenario 4a now checks the *delivery* host specifically and verifies the upload flow's permitted metadata rather than asserting a blanket absence of "cloudinary". Scenario 4c switches to `private, no-cache` and adds the two revalidation-revokes-access checks. `LISTING_IMAGE_CACHE_SECONDS` is replaced by `LISTING_IMAGE_CACHE_MODE`.

**Amended again 2026-08-06**: environment setup now distinguishes `.env.example` (names only), `.env` (maintainer-written, uncommitted), and `.env.test` (committed dummies). Scenario 4a gains a no-`folder` assertion and a retry-mode check; 4c requires a **weak** `ETag`; troubleshooting gains the two signature-algorithm confusions and the two retry-mode failures.

How to configure, run, and validate this feature end to end. Entity details are in [data-model.md](./data-model.md); endpoint shapes in [contracts/listing-media-api.md](./contracts/listing-media-api.md); reasoning in [research.md](./research.md).

---

## Prerequisites

1. A Cloudinary account (the free tier is sufficient for development).
2. From its dashboard: **cloud name**, **API key**, **API secret**.
3. The existing local Postgres from `docker-compose.yml`, running.
4. **A verified database backup** if you are applying the migration anywhere holding real listing photos — the migration deletes every existing photo row and its bytes, irreversibly ([data-model.md §6](./data-model.md)).

## Configuration

Add to `.env`, mirroring the comment style already used in [`.env.example`](../../.env.example):

```bash
# Cloudinary — listing media storage (017-cloudinary-listing-media).
# ALL server-side. The browser never builds a Cloudinary URL: images are
# delivered through /api/communities/{id}/listing-photos/{id}, and the upload
# endpoint is returned by /api/listing-media/authorize at runtime. So there is
# deliberately NO NEXT_PUBLIC_CLOUDINARY_* variable (FR-099).
# CLOUDINARY_API_SECRET must never get a NEXT_PUBLIC_ prefix, be committed,
# baked into a Docker image, or logged (FR-098, FR-100).
CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY=""
CLOUDINARY_API_SECRET=""

# Top-level asset PATH SEGMENT: development | test | production. Names the first
# segment of the generated public ID, NOT a Cloudinary `folder` upload parameter —
# no `folder` param is ever sent, so behaviour does not depend on whether the
# account is in fixed-folder or dynamic-folder mode (research.md #5).
# This is what makes it physically impossible for a staging deployment to
# address or delete production assets (FR-102, FR-103).
CLOUDINARY_ENV_FOLDER="development"

# Delivery cache mode: no-cache (default) | no-store (FR-058).
# A MODE, not a TTL. "no-cache" lets the browser store bytes but forces it to
# revalidate before reuse, so leaving a community or switching accounts is
# caught on the next image request. A max-age is deliberately NOT offered:
# permitting reuse without revalidation is exactly what FR-058 prohibits.
LISTING_IMAGE_CACHE_MODE="no-cache"

# Shared secret for POST /api/listing-media/cleanup (scheduler-invoked, not
# session-authenticated). Generate with: openssl rand -hex 32
CLEANUP_TOKEN=""
```

**Three files, three different rules** — conflating them is how secrets get committed:

| File | Contents | Who writes it |
|---|---|---|
| `.env.example` | Names and comments **only**, never a value | Committed; written as part of this feature |
| `.env` | Real development credentials | **You, by hand.** Uncommitted. No task, script, or agent creates or populates it |
| `.env.test` | Deterministic **dummy** values — e.g. `CLOUDINARY_CLOUD_NAME="test-cloud"`, `CLOUDINARY_API_SECRET="test-secret-not-a-real-credential"` | Committed |

`.env.test`'s dummies are safe and sufficient because every Cloudinary call is stubbed at the `src/lib/cloudinary/` boundary, so they are never used against a real account. They exist only so `requireCloudinaryConfig()` passes (it fails loud on empty values — FR-106) and so the signature fixtures have stable inputs to pin against. Keep them self-evidently fake; **never put a real credential in a test fixture, a committed file, or generated source** (FR-100).

## Setup

```bash
npm install                    # no new dependencies — research.md #3
npx prisma migrate dev --name replace_listing_photos_with_cloudinary
npx prisma generate
npm run dev
```

The migration is **destructive**: it deletes all `listing_photos` rows before reshaping the table. Listings that had photos become image-less and render the existing "No photo" placeholder. This is intended (FR-089, SC-018), not a defect to report.

---

## Validation scenarios

Each maps to a user story and a success criterion. Run against a community where your account is a current member with a display name set.

### 1. Multi-image upload through CMarket's own interface — US1, SC-001, SC-002

1. Go to `/communities/{communityId}/listings/new`.
2. Select **five** valid images (JPEG/PNG/WebP, each ≤ 10 MB) in one file-picker action.
3. Expect: five preview tiles, each with its own progress and state.
4. DevTools → Network. Expect: five `POST` to `api.cloudinary.com` (upload stays direct), **no** request for Cloudinary's `widget.js` or any `upload-widget` asset, and **no** image bytes in any request to your own origin.
5. Fill title/price, submit.

**Pass**: listing saves with five photos; at most three concurrent Cloudinary uploads at any moment (SC-020); no Cloudinary-branded UI ever appeared.

### 2. Order and cover survive out-of-order completion — US2, SC-003, SC-004

1. DevTools → Network → throttle to "Slow 3G", or use the Playwright interception in `test_listing_media_flow.spec.ts`.
2. Select four images. While they upload, use move-left/move-right to reverse the order.
3. Choose the **third** tile as cover.
4. Submit once all four read `uploaded`.

**Pass**: detail gallery shows your chosen order, not completion order. The community-view card shows the third image. Reordering worked with clicks alone — no drag required (SC-014).

### 3. Per-file failure and retry — US3, SC-005

1. Select four images.
2. DevTools → block `api.cloudinary.com` after the first two complete.
3. Expect: two tiles `uploaded`, the rest `failed`, each offering **Retry** and **Remove**.
4. Try to submit. Expect: blocked, with a visible "uploads still in progress / failed" explanation (FR-012).
5. Unblock. Press **Retry** on one failed tile.
6. Expect: exactly **one** new Cloudinary request. The two successes are not re-sent (FR-009, FR-077).
7. Press **Remove** on the last failed tile, then submit.

**Pass**: listing saves with three photos. Network log confirms no successful upload was repeated.

### 4. Authenticated proxy delivery — US4, SC-007, SC-008, SC-009, SC-010

**4a. No Cloudinary *delivery* data in the browser** (FR-056, FR-107, FR-108, SC-007)

Check the delivery host and persisted identifiers specifically. Do **not** grep for the bare word "cloudinary" — the uploader legitimately receives an upload endpoint at runtime (FR-108), so a blunt keyword check either fails spuriously or gets weakened until it proves nothing.

1. Open a listing with photos. View source, and inspect every listing and image response.
2. Expect: every image `src` is `/api/communities/{communityId}/listing-photos/{photoId}?v=…`.

```bash
# Forbidden: the DELIVERY host, in listing markup or client chunks
curl -s -b "$COOKIE" "localhost:3000/communities/$CID/listings/$LID" | grep -c "res.cloudinary.com"   # expect 0
npm run build && grep -rl "res.cloudinary.com" .next/static/ && echo "LEAK" || echo "clean"
grep -rn "NEXT_PUBLIC_CLOUDINARY" . --exclude-dir=node_modules --exclude-dir=.next && echo "LEAK" || echo "clean"

# Forbidden: the proxy must STREAM, never redirect (FR-107)
curl -s -o/dev/null -w '%{http_code}\n' -b "$COOKIE" "$IMG"    # expect 200, never 30x
curl -si -b "$COOKIE" "$IMG" | grep -i "^location:" && echo "REDIRECT LEAK" || echo "clean"

# Permitted: the authorize response DOES carry upload metadata, and NO secret (FR-108)
curl -s -X POST localhost:3000/api/listing-media/authorize -b "$COOKIE" \
  -H 'Content-Type: application/json' -d "{\"communityId\":\"$CID\",\"draftId\":\"draft1\"}" | tee /tmp/auth.json
grep -q 'apiKey' /tmp/auth.json && grep -q 'signature' /tmp/auth.json && echo "upload metadata present (correct)"
grep -q '"folder"' /tmp/auth.json && echo "UNEXPECTED folder param" || echo "no folder param (correct)"
grep -qi "$(grep '^CLOUDINARY_API_SECRET' .env | cut -d= -f2- | tr -d '"')" /tmp/auth.json && echo "SECRET LEAK" || echo "no secret (correct)"

# Retry mode: sending back an issued publicId reuses it and creates no second pending row
PID=$(grep -o '"publicId":"[^"]*"' /tmp/auth.json | cut -d'"' -f4)
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pending_listing_media WHERE draft_id='draft1'"   # expect 1
curl -s -X POST localhost:3000/api/listing-media/authorize -b "$COOKIE" \
  -H 'Content-Type: application/json' \
  -d "{\"communityId\":\"$CID\",\"draftId\":\"draft1\",\"publicId\":\"$PID\"}" | grep -o '"publicId":"[^"]*"'
# expect the SAME publicId back, with a fresh timestamp/signature
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pending_listing_media WHERE draft_id='draft1'"   # still expect 1
```

**Pass**: zero delivery-host matches in listing markup and client chunks; no `NEXT_PUBLIC_CLOUDINARY_*` variable exists at all; the proxy answers `200` with no `Location` header; the association response body carries no `publicId`; and the authorize response *does* carry `apiKey`/`signature`/`publicId` while carrying no secret. Both halves matter — asserting only absence would let someone "fix" a false positive by breaking uploads.

**4b. The URL alone grants nothing** (FR-057, SC-008)

```bash
IMG="localhost:3000/api/communities/$CID/listing-photos/$PHOTO_ID?v=card"

curl -i "$IMG"                        # no cookie          -> 401
curl -i -b "$NON_MEMBER_COOKIE" "$IMG"  # signed in, not a member -> 403
curl -i -b "$MASTER_COOKIE" "$IMG"      # MASTER             -> 403 (no membership)
curl -i -b "$COOKIE" "localhost:3000/api/communities/$OTHER_CID/listing-photos/$PHOTO_ID?v=card"
                                      # photo in a different community -> 404
curl -i -b "$COOKIE" "localhost:3000/api/communities/$CID/listing-photos/clnonexistent?v=card"
                                      # nonexistent -> 404, identical to the above
```

**Pass**: no bytes in any of these. The wrong-community and nonexistent cases are **byte-for-byte identical** — a distinguishable response would confirm another community's photo exists (FR-054).

**4c. Caching, revalidation, and variants** (FR-058, FR-059, FR-060, FR-109, SC-009, SC-010)

```bash
curl -i -b "$COOKIE" "$IMG" | grep -iE "cache-control|etag|vary|content-type"
# expect: Cache-Control: private, no-cache / ETag: W/"…" / Vary: Accept
# must NOT contain max-age, s-maxage, or public
# the ETag must be WEAK (W/ prefix) — f_auto negotiates format, so identical
# variants legitimately differ byte-for-byte and a strong validator would lie

ETAG=$(curl -s -D- -o/dev/null -b "$COOKIE" "$IMG" | grep -i etag | cut -d' ' -f2 | tr -d '\r')
curl -i -b "$COOKIE" -H "If-None-Match: $ETAG" "$IMG" | head -1      # expect 304
```

**Authorization must precede the `304`** (FR-109) — the check that matters most here, because the natural implementation shortcut gets it wrong:

```bash
# Same valid ETag, but the caller is no longer entitled.
# Remove the account's membership in $CID (or use a second account's cookie), then:
curl -i -b "$COOKIE" -H "If-None-Match: $ETAG" "$IMG" | head -1
# expect 403 or 404 — NOT 304

# Different account, same browser, same cached ETag:
curl -i -b "$OTHER_MEMBER_COOKIE" -H "If-None-Match: $ETAG" \
  "localhost:3000/api/communities/$OTHER_CID/listing-photos/$PHOTO_ID?v=card" | head -1
# expect 404 — NOT 304
```

A `304` here would mean "your cached copy is still good" to someone no longer allowed to see it. If either command returns `304`, the handler is checking `If-None-Match` before the membership gate — the exact ordering bug FR-109 exists to prevent.

```bash
for V in thumbnail card detail; do
  echo -n "$V: "; curl -s -o/dev/null -w '%{size_download}\n' -b "$COOKIE" "${IMG%v=card}v=$V"
done
# expect thumbnail < card < detail

curl -s -o/dev/null -w '%{size_download}\n' -b "$COOKIE" \
  "localhost:3000/api/communities/$CID/listing-photos/$PHOTO_ID?v=w_9999,c_crop"
# expect: same size as v=card — the bogus variant falls back, never passes through (FR-061)
```

**Pass**: `private, no-cache` (never `public`, never `s-maxage`, never `max-age`), a working `304` for an authorized caller, a refusal rather than a `304` for an unauthorized one, three distinct sizes, and an arbitrary transformation string ignored rather than honoured.

**4d. Presentation** (FR-064, FR-065, FR-067, FR-068, SC-015)

1. Inspect a gallery image. Expect: `width` and `height` attributes from stored dimensions, and `loading="lazy"` on non-cover gallery images.
2. Resize 1440px → 375px. Expect: no horizontal page scroll, no distortion, no layout jump on load.
3. Confirm `alt` reads like `"<listing title> — photo 2 of 3"`, never a filename or cuid.

**Pass**: all three hold. Note `npm run lint` **will** report exactly one `@next/next/no-img-element` suppression, in `app/_components/ListingImage.tsx`. That is expected and documented — `next/image` is deliberately not used (FR-063). More than one, or one anywhere else, is a defect.

### 5. Upload authorization — US5, SC-011

```bash
# Unauthenticated -> 401
curl -i -X POST localhost:3000/api/listing-media/authorize \
  -H 'Content-Type: application/json' \
  -d '{"communityId":"<id>","draftId":"draft1"}'

# Signed-in NON-member -> 403 not_a_member
# MASTER -> 403 not_authorized   (FR-032, Principle IX)
# Non-owner against someone else's listing -> 403 not_owner

# Forged asset: authorize once, then associate a DIFFERENT public id
# -> 403 unauthorized_asset, and no ListingPhoto row is created (FR-031)
curl -i -X POST "localhost:3000/api/communities/$CID/listings/$LID/photos" \
  -H 'Content-Type: application/json' -b "$COOKIE" \
  -d '{"draftId":"draft1","photos":[{"publicId":"cmarket/production/listings/other/deadbeef","displayOrder":0}]}'
```

**Pass**: every call refused, and `SELECT count(*) FROM listing_photos` unchanged after the forged attempt.

### 6. Secret containment — SC-012

```bash
npm run build
SECRET=$(grep '^CLOUDINARY_API_SECRET' .env | cut -d= -f2- | tr -d '"')
grep -ri "$SECRET" .next/ && echo "LEAK" || echo "clean"
grep -rn "NEXT_PUBLIC_CLOUDINARY" . --exclude-dir=node_modules --exclude-dir=.next && echo "LEAK" || echo "clean"
grep -ri "$SECRET" docker-compose.yml .env.example 2>/dev/null && echo "LEAK" || echo "clean"
npm run test:unit -- tests/unit/test_no_cloudinary_in_client_bundle.ts
```

**Pass**: all three greps print `clean` (the second should find nothing at all — no such variable exists under this design), and the unit test passes. Also confirm the secret appears in no committed file and in no server log from an upload, delivery, or delete.

**Check specifically that no log line contains a signed delivery URL** (FR-104) — the secret is not recoverable from one, but the URL is itself a read capability, which is why it is forbidden in logs for the same reason it is forbidden in responses and redirects. A `publicId` in a server log is fine; FR-056 governs browser-reachable responses, not server diagnostics.

### 7. Deletion and retryable cleanup — US6, SC-013

1. Edit a listing with three photos; remove one; save.
2. Expect: it disappears from every surface immediately, and its proxy URL now returns `404` (FR-078) — including for a browser that already had it cached, because `no-cache` forces revalidation before reuse.
3. `SELECT * FROM media_cleanup_tasks;` → one row for that public ID.
4. `curl -X POST localhost:3000/api/listing-media/cleanup -H "X-Cleanup-Token: $CLEANUP_TOKEN"`
5. Expect: `{"ok":true,…,"deleted":1,…}`; the row is gone; the asset is absent from your Cloudinary Media Library.

**Retry path**: block `api.cloudinary.com`, remove a photo, save. Expect: the listing edit **succeeds anyway** (FR-085) and a task row exists. Drain → the row survives with `attempts: 1`, a populated `lastError`, and a future `nextAttemptAt`. Unblock, drain again → deleted.

**Listing deletion (the ordering trap)**: delete a listing with photos, then check `media_cleanup_tasks`. Expect one row **per photo**. Zero rows means cleanup was enqueued after the cascade wiped the photo rows — the exact bug [data-model.md §4](./data-model.md) warns about, silently orphaning every asset of every deleted listing.

### 8. Hard cutover — US7, SC-016, SC-017

```bash
# No byte columns remain
npx prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns WHERE table_name = 'listing_photos';
SQL
# Expect: no data / mime_type / size_bytes; no secure_url either

# No legacy code remains — the AUTHORITATIVE check.
npm run test:unit -- tests/unit/test_no_legacy_image_paths.ts
```

**Use the test, not a shell grep.** A naive `grep -rn "MAX_PHOTO_BYTES" src/ app/` reports a false positive, because `listingService.ts` carries a comment explaining that the constant was deliberately removed — and `ListingImage.tsx` likewise documents why `next/image` is *not* used. A grep that fails on its own documentation would only ever get the documentation deleted. `test_no_legacy_image_paths.ts` strips comments before matching, so it audits code rather than prose, and it additionally pins the two permitted `no-img-element` suppressions and asserts `getListingPhoto()` still exists.

**Pass**: that suite is green, and a legacy listing that had photos before the migration renders the "No photo" placeholder with no console error and no 404 (SC-018 — covered by `test_listing_media_flow.spec.ts`).

Note `getListingPhoto()` **is expected to still exist** in `listingService.ts` — retained with a new body, because its authorization gate is exactly what the delivery route needs ([research.md #12](./research.md)). Its absence would mean the gate was reinvented somewhere else.

### 9. Regression — SC-019

```bash
npm run test:unit
npm run test:e2e
npm run lint
npm run typecheck
```

**Pass**: everything green. `tests/contract/test_listings.ts` passes with its photo blocks rewritten against the Cloudinary model — not skipped, not deleted, and not passing because a legacy path was left alive to satisfy them (FR-096).

---

## Production deployment

1. **Take and verify a database backup.** The migration destroys listing photo bytes irreversibly.
2. Set all six variables in the Dokploy environment. `CLOUDINARY_ENV_FOLDER=production`. Confirm `CLOUDINARY_API_SECRET` is an environment secret, **not** baked into the image (FR-100).
3. Confirm the application server has outbound network access to Cloudinary. Under this design that is required at **read** time, not only at write time — if it is blocked, listing images stop rendering entirely.
4. Deploy. The pipeline applies the migration via `prisma migrate deploy` — never `db push --accept-data-loss` (FR-095).
5. Schedule `POST /api/listing-media/cleanup` with the `X-Cleanup-Token` header. Every 15 minutes is ample; the endpoint is idempotent and safe to over-call.
6. **Confirm no shared cache or CDN sits in front of `/api/communities/*/listing-photos/*`.** The route returns `private, no-cache`, but a misconfigured reverse proxy that caches on URL alone would serve one member's authorized bytes to an unauthorized caller and defeat the entire access model (FR-058). Verify from outside the network that a request without a session cookie returns `401` rather than cached bytes.
7. Announce that existing listing photos are gone and sellers should re-upload — every pre-cutover listing now shows the placeholder. This is the accepted cost of the hard cutover (FR-089), but it is user-visible and should not arrive unannounced.
8. Post-deploy: create a listing with two photos, confirm they render, sign out and confirm the image URLs return 401, then delete the listing and confirm the cleanup drain removes both assets.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `provider_unconfigured` on first upload or image load | A `CLOUDINARY_*` variable is missing or empty. `requireCloudinaryConfig()` failing loud by design (FR-106). |
| All images `502` | The app server cannot reach Cloudinary, or the delivery signature is wrong. Check the server log — it records the status and Cloudinary's message, without the signed URL. |
| All images `401` in the browser | Session cookie not sent. Check the request is same-origin and credentials are not stripped. |
| Images `404` for a member who should see them | The photo's listing is in a different community than the path names, or its `operationalEpoch` is stale after a community restoration. Both are correct refusals. |
| Cloudinary `401` on upload | Clock skew, or a signed parameter altered between signing and upload. Every signed field must be sent back byte-identical. Also check nothing added `resource_type`, `cloud_name`, `api_key`, or `file` to the string-to-sign — those four must be excluded. |
| Cloudinary `401` on delivery fetch | Most likely the delivery signer reused the **upload** algorithm. Delivery is SHA-256 → URL-safe Base64 → first 8 characters over `{transformation}/{publicId}`; upload is SHA-256 **hex** over sorted params. A hex digest in `s--…--` never validates. Also check the asset was uploaded with `type: authenticated`. |
| Asset lands at an unexpected path | Something is sending a `folder` parameter alongside the path-bearing `public_id`. Remove it — the public ID is the only path mechanism, precisely so behaviour cannot depend on the account's folder mode. |
| `unauthorized_asset` on submit | The `PendingListingMedia` row expired (> 30 min) or the `draftId` changed mid-session. Re-select the files. |
| Retrying a file fails with `photo_limit_reached` | The retry went through **initial** mode instead of retry mode, minting a second public ID and re-counting the file against the cap. The client must send back the `publicId` the server originally issued. |
| A retried file uploads but never associates | Same root cause: the browser uploaded under a new public ID while the form still submits the old one. Check the per-file state keeps the issued `publicId`. |
| Uploads succeed, association fails, photos "lost" | Expected and recoverable: the assets remain valid pending rows until `expiresAt`. Resubmit — no re-upload needed (FR-077). |
| A removed photo still displays for one user | Should not happen under `no-cache`. If it does, the response is carrying a `max-age` (check `LISTING_IMAGE_CACHE_MODE` and the handler), or a reverse proxy is rewriting cache headers. |
| A former member still sees images | Same cause: something is permitting cache reuse without revalidation, or the handler answers `304` before the membership gate (FR-109). Reproduce with the conditional-request commands in scenario 4c. |
| Images reload on every scroll | Expected to *revalidate*, not re-download — a `304` should be cheap. If full bytes come back each time, the `ETag` is unstable; it must derive from `cloudinaryAssetId` + variant, not from anything per-request. |
| Assets accumulating in Cloudinary | The cleanup endpoint is not scheduled, or `CLEANUP_TOKEN` mismatches (silent `401`). Check `SELECT count(*) FROM media_cleanup_tasks`. |
| Lint reports a `no-img-element` warning | Expected — exactly one, in `ListingImage.tsx`. `next/image` is deliberately not used (FR-063). |
