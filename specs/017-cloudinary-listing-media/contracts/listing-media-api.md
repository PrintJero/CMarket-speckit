# Phase 1 Contracts: Listing Media API

**Feature**: `017-cloudinary-listing-media` | **Date**: 2026-08-06 | **Plan**: [plan.md](./plan.md)

**Revised 2026-08-06**: adds §1, the authenticated delivery proxy. The rendering contract in §9 is rewritten for plain `<img>` — every `next/image`, `remotePatterns`, loader, and `srcset` guarantee is removed.

**Amended 2026-08-06**: §1 switches to `Cache-Control: private, no-cache` and mandates authorization **before** any `304` (FR-109). §2 now states explicitly which Cloudinary values the browser is *permitted* to receive during an authorized upload (FR-108), replacing the earlier blanket prohibition that contradicted the direct-upload protocol.

Every JSON endpoint follows this codebase's established shape: `{ ok: true, ... }` / `{ ok: false, reason: "..." }`, discriminated-union result types in the service, HTTP status mapped in the route handler. Reason strings reuse the existing vocabulary (`not_found`, `not_owner`, `not_a_member`, `community_not_active`, `invalid_input`) so client error handling stays uniform. The delivery route in §1 is the one exception — it returns image bytes, not JSON.

## Authorization gates

| Gate | Mechanism | Applies to | Requirement |
|---|---|---|---|
| Authenticated | `getCurrentAccount()` → `401` if null | all | FR-026, FR-051 |
| Not a MASTER | `getCurrentMaster()` → `403 not_authorized` if present | mutations + authorize | FR-032 |
| Current member | `requireCommunityMembership()`, unchanged | all | FR-027, FR-052 |
| Community active | `isCommunityActive()` | mutations only | existing FR-053 (009) |
| Listing owner | `listing.ownerId === callerAccountId` — never `requireCommunityAdministrator()` | mutations | FR-028, Principle III |

The MASTER check comes **first** on mutating endpoints, before the membership check. A MASTER has no membership, so a membership-first order would reject with `not_a_member` and hide the real reason — leaving the guarantee resting on an accident rather than an explicit rule. On the delivery route no explicit MASTER check is needed: the membership gate refuses a MASTER for the same structural reason, and adding a redundant check there would imply the gate is insufficient.

Reads (delivery, §1) tolerate a SUSPENDED community via `{ allowSuspended: true }`, matching the current `getListingPhoto()` behaviour and 009's FR-052. Mutations do not.

---

## 1. `GET /api/communities/{communityId}/listing-photos/{photoId}` — authenticated delivery proxy

The **only** way a browser obtains listing image bytes. Replaces the byte `GET` that previously lived at `…/listings/{listingId}/photos/{photoId}`.

**Query parameters**

| Param | Values | Default | Notes |
|---|---|---|---|
| `v` | `thumbnail` \| `card` \| `detail` | `card` | Server-side allowlist. An unrecognized value resolves to the default, never an error and never passed through (FR-060, FR-061). |

No other parameter is read. There is deliberately no `w`, `h`, `q`, or `t` — a width or transformation string from the client would both violate FR-060 and hand a caller a transformation-cost amplifier against the Cloudinary account.

**Processing**

**The order below is mandatory, not incidental** (FR-109). Steps 1–3 are authorization and run before *any* response is chosen, including a `304`. An implementation that checks `If-None-Match` early as a fast path would hand cached bytes to a caller who has since lost membership or signed in as a different account — the exact hole this amendment closes.

1. `getCurrentAccount()` → `401` if absent. (FR-051)
2. `requireCommunityMembership(accountId, communityId, { allowSuspended: true })` → refuse if false. (FR-052)
3. Load the photo with its listing. Refuse unless the listing's `communityId` matches the path and its `operationalEpoch` matches the community's current epoch. (FR-053)
4. **Only now** consider `If-None-Match`. On a match, return `304` and stop. (FR-109)
5. Resolve `v` through the variant table to a fixed transformation string. (FR-059, FR-060)
6. Build a **signed** Cloudinary `type: authenticated` delivery URL server-side and `fetch` it, forwarding the client's `Accept` header so `f_auto` can negotiate format. (FR-055)
7. Stream the bytes back with the headers below. **Never redirect** — see below.

**Response `200`**

```http
Content-Type: image/webp            # whatever f_auto negotiated
Cache-Control: private, no-cache
Vary: Accept
ETag: W/"<cloudinaryAssetId>-<variant>"
```

**The `ETag` is a weak validator, deliberately.** `f_auto` negotiates format from `Accept`, so the same photo at the same variant legitimately returns WebP to one client and JPEG to another. A strong `ETag` would assert byte-for-byte equality — a false claim; `W/` asserts semantic equivalence, which is true. `Vary: Accept` then stops a cache serving one negotiated format to a client that cannot accept it. The identifier half is `cloudinaryAssetId`, immutable for the asset's lifetime, so the header is stable per variant and differs across variants. `getListingPhoto()` must therefore return `cloudinaryAssetId` in its internal result; FR-056 still forbids emitting it in any other form.

`Cache-Control: private, no-cache` is load-bearing, not decoration:

- **`private`** — a `public` or `s-maxage` response would let a shared cache serve one member's authorized bytes to an unauthorized caller, defeating the entire proxy. This route must never sit behind a shared cache keyed on URL alone.
- **`no-cache`** — the browser may *store* the bytes but must revalidate before *reusing* them. This is what makes revocation immediate: a member who leaves a community, or a second account signing in on the same browser, is re-checked on the very next image request. A `max-age` would let the browser reuse authorized bytes with no server involvement for the whole window, which is why it is prohibited (FR-058).

Note `no-cache` is not `no-store`: caching still happens and revalidation is a cheap `304`, so the cost is one conditional request per reuse, not a full re-download. A stricter `no-store` mode may exist as optional configuration; `no-cache` is the MVP default (FR-058).

**Response `304`** when `If-None-Match` matches **and steps 1–3 passed**.

**Streams, never redirects** (FR-107). The route must not answer with `302`/`307` to a signed Cloudinary URL, and must not rewrite the request. A redirect would be cheaper on server bandwidth, and is prohibited anyway: the signed URL would land in the browser's network log, history, and referrer header, leaking a delivery capability while superficially appearing to satisfy FR-056.

**No Cloudinary delivery data in the response** (FR-056). Not in the body, not in a header, not in an error message: no `res.cloudinary.com`, no signed source URL, no public ID, no cloud name. An upstream failure returns a generic status, and the Cloudinary detail goes to the server log only — with the signed URL omitted (FR-104), since a proxy that logs it undoes the point of not sending it. This prohibition is specific to delivery; §2 documents what the upload flow is permitted to expose.

**Errors**

| Status | When | Notes |
|---|---|---|
| `401` | unauthenticated | no body |
| `403` | not a current member of `communityId` | mirrors `getListingPhoto()`'s existing `not_a_member` |
| `404` | photo does not exist; belongs to a listing in another community; listing's epoch is stale; photo was deleted | **All four collapse to one response** (FR-054), matching how `getListing()` already treats a cross-community listing id as indistinguishable from a nonexistent one. A distinguishable "exists but not yours" would confirm the existence of another community's photo — a Principle II leak. |
| `502` | Cloudinary unreachable or returned an error | generic; upstream detail logged server-side only |
| `500` | `requireCloudinaryConfig()` threw | FR-106 |

**Why community-scoped by path rather than nested under a listing**: a `photoId` already determines its listing, so a listing segment would be redundant and a third thing to get wrong. The community segment earns its place — it makes the isolation check assertable against the request's own claim rather than inferred from the record, which is what turns step 3 into a real check instead of a lookup.

---

## 2. `POST /api/listing-media/authorize`

Issues short-lived signed upload parameters. Called once per file, including on retry. **Unchanged by the delivery revision** — upload remains a direct browser-to-Cloudinary transfer.

**Request**

```json
{
  "communityId": "clxxx…",
  "draftId": "clyyy…",
  "listingId": "clzzz…",
  "publicId": "cmarket/production/listings/clyyy…/a1b2c3…"
}
```

`draftId` is client-generated once per form session. `listingId` is present on the edit path only; when present it must equal `draftId`.

**`publicId` selects the mode**, and is the difference between authorizing a new file and re-authorizing one already in flight:

| Mode | Request | Behaviour |
|---|---|---|
| **Initial** | `publicId` omitted | Generate a fresh public ID, enforce the eight-photo cap across associated plus pending, write **one** `PendingListingMedia` row |
| **Retry** | `publicId` set to a value this server previously issued | Look up the **unexpired** row by `accountId` + `draftId` + `publicId`; return fresh signed params for **that exact same** public ID; write **no** row; **skip** the cap check |

Retry mode exists because calling the initial path again would mint a second public ID and a second pending row for one file — double-counting it against the cap (so retrying the eighth photo would fail for no comprehensible reason) and orphaning the first upload under an identifier nothing references. Both modes run the identical authorization gate first; retry is narrower, never weaker.

**Response `200`**

```json
{
  "ok": true,
  "upload": {
    "url": "https://api.cloudinary.com/v1_1/<cloud>/image/upload",
    "apiKey": "1234…",
    "timestamp": 1786000000,
    "signature": "<sha256 hex>",
    "publicId": "cmarket/production/listings/clyyy…/a1b2c3…",
    "type": "authenticated",
    "context": "account=clxxx…|draft=clyyy…"
  }
}
```

**There is no `folder` field, by design.** The `publicId` already carries the full path. Sending `folder` as well would make the resulting asset path depend on whether the Cloudinary account is in fixed-folder or dynamic-folder mode — an account setting no code can inspect — and would make `verifyAsset`'s prefix check pass in one mode and fail in the other. Repository inspection confirms no folder mode is configured, so the unambiguous choice is public ID only ([research.md #5](./research.md)).

**Every field above is deliberately browser-visible, and that is correct** (FR-108). The signed direct-upload protocol cannot work otherwise: the browser must know where to POST (`url`, which embeds the cloud name), which key the signature belongs to (`apiKey`), and exactly which parameter values were signed (`timestamp`, `publicId`, `type`, `context`) — a signature only validates if the signed values are sent back byte-identical. `signature` is derived from the secret but does not contain it and cannot be reversed. **The secret itself never appears** (FR-024, FR-025, FR-098, FR-100) — that exclusion has no exceptions.

This is the boundary the amendment draws: **upload exposure is bounded and temporary; delivery exposure is prohibited.** The values here are single-purpose — they authorize one upload of one asset — and confer no ability to *read* anything, because the asset lands at `type: authenticated` and is unreadable without a separately signed delivery URL the server never emits. The uploader may also hold Cloudinary's own upload response in memory to learn the result, but must not persist it anywhere the browser can re-read, render it, log it client-side, or use it as an image source (FR-108).

**Signed parameters**, sorted alphabetically, joined `k=v&k=v`, secret appended, **SHA-256 hex**: `allowed_formats=jpg,png,webp`, `context`, `public_id`, `timestamp`, `type=authenticated`. A client that alters any of them invalidates the signature — which is what makes FR-033's **format** enforcement real rather than advisory. `type: authenticated` being signed is what guarantees uploads land as restricted-delivery assets, so a leaked public ID is not publicly fetchable ([research.md #1](./research.md)).

**Explicitly not signed**: `file`, `cloud_name`, `api_key`, and `resource_type`. `resource_type=image` is fixed by the endpoint URL path (`/image/upload`) and re-asserted at verification (§3, step 2), not carried in the string-to-sign.

**`max_file_size` is not sent at all.** It is an upload-**preset** setting, not an upload-API request parameter; signing it makes Cloudinary reject the upload with `Invalid Signature` (verified against the live service). The 10 MB limit is enforced at **association** instead — §3 refuses an oversized asset with `422 file_too_large`, consumes its pending row, and queues it for deletion. The browser must send back exactly the signed set and nothing more: one extra signable field breaks every upload.

This is the **only** endpoint permitted to return Cloudinary-identifying values to a browser. FR-056's prohibition covers listing reads and delivery; it is not violated here. And because this response supplies the complete upload endpoint at runtime, no Cloudinary value needs to be baked into the client bundle — which is why `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` does not exist (FR-099).

**Side effect**: in initial mode, one `PendingListingMedia` row with `expiresAt = now + 30 min`. In retry mode, none.

**On timing**: the client re-authorizes a file that has been queued longer than a conservative refresh threshold (10 minutes) before starting its upload. That threshold is **CMarket's own client-side staleness policy** — not a claim that Cloudinary rejects a signature at that age. Cloudinary's timestamp tolerance is a separate setting on their side and is more generous; nothing here depends on its exact value. What does matter, and is ours to control, is that the pending row's 30-minute lifetime exceeds the refresh threshold, so a refresh always has a valid row to match (FR-009).

**Errors**

| Status | `reason` | When |
|---|---|---|
| `401` | — | unauthenticated |
| `403` | `not_authorized` | caller is a MASTER (FR-032) |
| `403` | `not_a_member` | not a current member of `communityId` (FR-027) |
| `403` | `not_owner` | edit path, caller does not own `listingId` (FR-028) |
| `409` | `community_not_active` | community SUSPENDED or ARCHIVED |
| `409` | `photo_limit_reached` | initial mode only — already 8 associated + pending for this draft (FR-004). **Never returned in retry mode**, since the file is already counted |
| `403` | `unauthorized_asset` | retry mode — the supplied `publicId` has no pending row, or its row belongs to another `accountId` or `draftId` |
| `409` | `authorization_expired` | retry mode — the pending row exists but `expiresAt` has passed |
| `400` | `invalid_input` | missing/malformed ids, or `listingId !== draftId` |
| `500` | `provider_unconfigured` | `requireCloudinaryConfig()` threw (FR-106) |

The cap is checked in initial mode **as well as** at association — not redundancy for its own sake, but so a member learns they are at eight before spending upload bandwidth. Association remains authoritative, since it holds the transaction.

---

## 3. `POST /api/communities/{communityId}/listings/{listingId}/photos`

Associates uploaded assets with a listing. **Replaces** the current multipart handler — no bytes, no `FormData`.

**Request**

```json
{
  "draftId": "clyyy…",
  "photos": [
    { "publicId": "cmarket/production/listings/clyyy…/a1b2c3…", "displayOrder": 0 },
    { "publicId": "cmarket/production/listings/clyyy…/d4e5f6…", "displayOrder": 1 }
  ],
  "coverPublicId": "cmarket/production/listings/clyyy…/d4e5f6…"
}
```

The client sends the **full desired ordered set**, not a delta. This is what makes FR-017/SC-003 hold: the member's chosen order arrives as data, wholly independent of the order uploads happened to complete in. `coverPublicId` is optional; when omitted, `displayOrder: 0` becomes the cover (FR-016).

**Processing** — one transaction:

1. For each `publicId`, find a `PendingListingMedia` row matching **both** the public ID and `accountId`. A miss → `403 unauthorized_asset`. (FR-030, FR-031)
2. Verify each asset with Cloudinary's Admin API. **Four checks, none folder-based**: the returned `public_id` starts with the exact expected prefix `cmarket/{env}/listings/{draftId}/`; its `context` carries the expected account and draft; `resource_type === "image"`; and `type === "authenticated"`. A miss on any → `422 asset_not_found`. Prefix-plus-context rather than a folder comparison is what keeps this correct regardless of the account's folder mode ([research.md #5](./research.md)).
3. Upsert `ListingPhoto` rows keyed on `cloudinaryPublicId`. The unique constraint absorbs a repeated submit (FR-019).
4. Rewrite `displayOrder` for the listing's full set, contiguous from 0, via a temporary offset (see [data-model.md §2](../data-model.md)).
5. Set `Listing.coverPhotoId`.
6. Delete the consumed `PendingListingMedia` rows.
7. Enqueue `MediaCleanupTask` for any previously-associated photo absent from `photos` (FR-079).

**Response `200`**

```json
{
  "ok": true,
  "photos": [
    { "id": "clp1…", "width": 3024, "height": 4032, "displayOrder": 0, "isCover": false },
    { "id": "clp2…", "width": 1600, "height": 1200, "displayOrder": 1, "isCover": true }
  ]
}
```

**The response deliberately omits `publicId`, `format`, and any URL.** The client needs `id` to build a proxy URL, plus `width`/`height` for layout — nothing more. The client already knows the public IDs it just sent, so echoing them back adds nothing; but this response is a **listing read**, and once an asset is associated its public ID is a *persisted* identifier, which FR-056 keeps out of listing reads. The upload allowance in FR-108 is bounded to the upload flow and does not extend here. `isCover` is **derived** from `Listing.coverPhotoId`, not a stored column ([research.md #4](./research.md)).

**Errors**: `401`; `403 not_owner`; `403 not_a_member`; `403 unauthorized_asset`; `409 community_not_active`; `409 photo_limit_reached` (> 8 combined — FR-004); `422 asset_not_found`; `422 file_too_large` (the asset exceeds 10 MB per Cloudinary's own byte count — the authoritative size check, since `max_file_size` cannot be signed); `400 invalid_input` (duplicate `publicId`, non-contiguous or negative `displayOrder`, `coverPublicId` not in `photos`).

**If the Admin API is unreachable**: association fails with `503 provider_unavailable` and the assets stay pending. The member's successful uploads are **not** lost (FR-077) — they remain valid pending rows until `expiresAt`, so a retried submit succeeds without re-uploading.

---

## 4. `PATCH /api/communities/{communityId}/listings/{listingId}/photos/order`

Reorder and/or change cover on an already-saved listing, without re-uploading. New endpoint.

**Request**

```json
{
  "photoIds": ["clp2…", "clp1…", "clp3…"],
  "coverPhotoId": "clp1…"
}
```

`photoIds` must be exactly the listing's current photo set — a permutation, no additions, no omissions. This makes a stale client fail loudly with `409 stale_photo_set` rather than silently dropping a photo.

**Response `200`**: same shape as §3.

**Errors**: `401`; `403 not_owner`; `409 community_not_active`; `409 stale_photo_set`; `400 invalid_input` (`coverPhotoId` not in `photoIds`).

---

## 5. `DELETE /api/communities/{communityId}/listings/{listingId}/photos/{photoId}`

**Contract unchanged** from today — same path, same method, same `204`, same `403`/`404` mapping. Internals change: the `ListingPhoto` row is deleted, a `MediaCleanupTask` is enqueued in the same transaction, `displayOrder` is rewritten contiguous (FR-020, a change from today's documented gap-leaving), and cover reassignment reuses the existing deterministic rule (FR-018).

The sibling byte `GET` on this path **is removed** — superseded by §1's community-scoped delivery route. This breaks a URL the three rendering surfaces currently use; all three are updated in the same change, and no other caller exists (verified by `grep`).

After deletion, §1 returns `404` for that `photoId` immediately (FR-078). Because delivery responses are `no-cache`, a browser holding the image must revalidate before reusing it, so it receives that `404` on its next attempt rather than continuing to display a deleted photo for a TTL window.

---

## 6. `PUT /api/communities/{communityId}/listings/{listingId}/cover`

**Contract unchanged.** [`setCoverPhoto()`](../../../src/server/services/listingService.ts#L593) keeps its signature and its existing contract tests. Kept as a distinct endpoint even though §4 can also set the cover, because it already exists, is already tested, and deleting a working owner-gated endpoint to fold it into a new one would be churn for its own sake.

---

## 7. `POST /api/listing-media/cleanup`

Drains `MediaCleanupTask`. Not member-facing.

**Auth**: shared-secret header (`X-Cleanup-Token`), compared with `crypto.timingSafeEqual`. Not session auth — the caller is a scheduler, not a person. `401` on mismatch.

**Response `200`**

```json
{ "ok": true, "processed": 12, "deleted": 11, "failed": 1, "expiredPendingSwept": 3 }
```

**Processing**: select `nextAttemptAt <= now()`, capped per invocation; destroy with `invalidate: true`; delete the row on success; on failure `attempts++`, record `lastError`, `nextAttemptAt = now + 2^attempts` min (capped 24h). Also sweeps `PendingListingMedia` where `expiresAt < now()` with no referencing `ListingPhoto`, enqueueing each for deletion (FR-083).

Logs `publicId`, operation, status, and Cloudinary's message. **Never** the signature, a signed URL, the API key, or the secret (FR-100, FR-104).

---

## 8. Client-side contract: the uploader

Not an HTTP contract, but a behavioural one the integration tests assert against.

**Per-file state**: `queued` → `uploading` → `uploaded` | `failed`. Held in a `Map` keyed by a generated file id, **separate from display order** ([research.md #10](./research.md)).

| Behaviour | Requirement |
|---|---|
| Multi-select in one action | FR-003 |
| At most 3 concurrent uploads | FR-011, SC-020 |
| Client-side reject on type/size before upload, per-file message naming the file | FR-005, FR-006, FR-013 |
| Reject the 9th file with a maximum-photo message | FR-004 |
| Local object-URL preview per pending file, revoked on removal | FR-007 |
| Already-saved photos (edit mode) preview via §1 at `v=thumbnail` | FR-070 |
| Per-file progress via `XMLHttpRequest.upload.onprogress` | FR-007 |
| Retry re-authorizes and re-uploads **only** that file | FR-009, SC-005 |
| Remove aborts in-flight via `AbortController` and drops the entry | FR-008 |
| Submit disabled while any file is `queued` or `uploading`, with a visible explanation | FR-012, FR-076 |
| Reorder via move-left/move-right buttons — **never** HTML5 drag alone | FR-010, Principle V |
| Cover selectable on any tile; exactly one at a time | FR-015 |
| Duplicate selection of the same file is a distinct entry | Edge case |

**Rejected files are never silently dropped.** A rejected file shows its own dismissible error row, so a batch where two of ten files were too large does not look like a batch of eight.

---

## 9. Rendering contract: `ListingImage`

The **only** component that renders listing media.

```tsx
<ListingImage
  communityId={communityId}
  photoId={photo.id}
  variant="card" | "thumbnail" | "detail"
  width={photo.width}
  height={photo.height}
  alt={`${listing.title} — photo ${index + 1} of ${total}`}
  loading="lazy" | "eager"
  className="h-full w-full object-cover"
/>
```

It builds `src={`/api/communities/${communityId}/listing-photos/${photoId}?v=${variant}`}` and renders a plain `<img>`.

| Guarantee | Requirement |
|---|---|
| `src` is always a CMarket route; never a Cloudinary URL | FR-049, FR-056 |
| Plain `<img>`; `next/image`, `remotePatterns`, a loader, and `srcset` are **not** used and **not** required | FR-063 |
| `variant` is a closed union — the component cannot request an arbitrary size | FR-059, FR-060 |
| Stored `width`/`height` passed through so the browser reserves correct proportions | FR-068 |
| `object-cover` within a fixed-aspect container; never distorts | FR-064 |
| Never exceeds its container's width | FR-065 |
| `alt` derived from listing title and position; never a filename or id | FR-066, FR-101 |
| `loading="lazy"` for non-cover gallery images; the cover may load eagerly | FR-067 |
| Renders the existing "No photo" placeholder, `data-testid="listing-cover-placeholder"` retained, when there is no cover | FR-069 |

**The single `@next/next/no-img-element` suppression lives here**, with a comment explaining that listing media is delivered through an authenticated proxy and `next/image` is deliberately not used. One suppression in one file is expected; its appearance anywhere else is a review defect ([research.md #12](./research.md)).

**`next.config.ts` is not modified** — no `images.remotePatterns` entry is needed, because the browser never requests a Cloudinary host.
