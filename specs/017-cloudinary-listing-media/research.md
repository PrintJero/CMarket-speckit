# Phase 0 Research: Cloudinary Listing Media Integration

**Feature**: `017-cloudinary-listing-media` | **Date**: 2026-08-06 | **Spec**: [spec.md](./spec.md)

**Revised 2026-08-06**: the delivery architecture changed from public Cloudinary URLs rendered through Next.js Image to **authenticated CMarket proxy routes**. Decision 1 is rewritten, decision 6 is replaced, and decisions 3, 8, 9, and 12 are amended. **The maintainer sign-off this document previously demanded is withdrawn — the Principle II relaxation it guarded no longer exists**, because the proxy preserves the existing member-gated guarantee rather than trading it away.

**Amended 2026-08-06** (two corrections): decision 1 gains an explicit **upload-exposure vs. delivery-exposure** boundary — the earlier blanket "nothing Cloudinary reaches the browser" was incompatible with the direct-upload protocol it sits beside. Decision 6's caching switches from `private, max-age=300` to **`private, no-cache` with `ETag`**, with authorization mandated before any `304`; the five-minute reuse window it previously accepted is eliminated rather than tuned, so decisions 6 and 9 lose their "residual exposure" caveats entirely.

---

## 1. Image access model — authenticated CMarket proxy

**Decision**: The browser fetches every listing image from `GET /api/communities/{communityId}/listing-photos/{photoId}?v={variant}`. That route validates the session, validates current membership, verifies the photo's listing belongs to the community in the path, then fetches the bytes from Cloudinary server-side and returns them. Cloudinary assets are uploaded with **`type: authenticated`** delivery, so even a leaked public ID is not fetchable without a server-signed URL.

**Status**: Settled. No sign-off outstanding.

**What this preserves**: exactly today's guarantee. [`getListingPhoto()`](../../src/server/services/listingService.ts#L427) already calls `requireCommunityMembership()` before returning bytes; the proxy keeps that call site and swaps only the byte source — a PostgreSQL column becomes an authenticated Cloudinary fetch. An ex-member, a member of another community, and an unauthenticated caller are refused on **every** request, forever, with no bearer capability escaping into the wild.

**Rationale**:

- Principle II is NON-NEGOTIABLE and states cross-community leakage is "a security defect, not a bug of convenience." A proxy makes compliance structural: there is no URL a member could share that would work for anyone else, because there is no URL that works without a session cookie.
- `type: authenticated` is defence in depth, and it is nearly free here. The reason authenticated delivery was expensive under the previous design — rotating signed URLs defeat browser and CDN caching — evaporates when the signing happens server-side inside the proxy. The browser caches the *proxy* URL, which is stable; the signed Cloudinary URL is an internal implementation detail with a lifetime of one server-side `fetch`.
- Two independent controls now have to fail before an asset leaks: the proxy's authorization *and* Cloudinary's signature requirement. Under `type: upload` (public) with a secret public ID, only obscurity stands between a leaked identifier and the file.
- The route shape is community-scoped by path, which means the isolation check is on the request's own terms rather than inferred. A request naming community A for a photo in community B is refused as not found — the same shape `getListing()` already uses for a cross-community listing id.

**Accepted cost, stated plainly**: the application server is back on the image byte path. This is a genuine regression against CDN delivery — every card render costs the Next server a Cloudinary round trip and outbound bandwidth, where public URLs cost it nothing. Three things make it acceptable rather than merely tolerated:

1. It is still strictly better than today, where the same bytes come out of PostgreSQL — a far more expensive place to store and serve them, and one that grows the database and its backups without bound.
2. Predefined variants (decision 6) mean a card fetches ~40 KB instead of a 4 MB original. The current implementation serves full-size originals to every card, so per-render bytes drop by roughly two orders of magnitude even with the proxy hop.
3. `Cache-Control: private, no-cache` with `ETag` means a member browsing a feed re-downloads bytes only when they actually change; a reuse costs one conditional request answered by a small `304`, not a full transfer.

### The upload/delivery exposure boundary

An earlier draft of this decision claimed no Cloudinary hostname, URL, or public ID ever reaches the browser. That was wrong, and incompatible with the direct-upload architecture in decision 7 — a browser cannot POST to Cloudinary without knowing the endpoint, and a signature only validates if the signed values are echoed back byte-identical. The correct boundary is not "Cloudinary is invisible" but **"a read capability is never issued to the browser"**:

| Direction | Browser may see | Rationale |
|---|---|---|
| **Upload** (authorize response, then the upload itself) | Upload endpoint incl. cloud name or a complete URL, API key, timestamp, signature, server-generated public ID; and Cloudinary's upload response held temporarily in memory | Structurally required by the signed upload protocol. Single-purpose: authorizes one upload of one asset for ten minutes, and confers **no** read ability, because the asset lands `type: authenticated` and is unreadable without a separately signed delivery URL the server never emits. |
| **Delivery** (listing pages, cards, galleries, listing/association responses, proxy responses) | Nothing Cloudinary — no delivery URL, no signed source URL, no persisted public ID | These are repeated reads of content whose access must be re-checked. Any durable identifier or URL here is a capability that can be copied and outlive membership. |

`CLOUDINARY_API_SECRET` is excluded from the upload allowance without exception. And the allowance is *temporary*: the uploader must not persist upload metadata anywhere the browser can re-read it, render it, log it client-side, or use it as an image source (FR-108).

This is also why the proxy must **stream rather than redirect** (FR-107). A `302` to a signed Cloudinary URL would be cheaper on server bandwidth and is prohibited anyway: it converts a server-side implementation detail into a browser-visible read capability, recorded in network logs, history, and referrers. A redirect would satisfy the letter of "the response body contains no Cloudinary URL" while defeating its entire purpose.

If proxy bandwidth later becomes the binding constraint, the escape hatch is the optional server-side byte cache (FR-062, deliberately out of MVP scope) or a signed-cookie CDN edge that still validates membership — neither of which requires revisiting the schema, the uploader, or cleanup.

**Alternatives considered**:

| Alternative | Rejected because |
|---|---|
| Public Cloudinary delivery URLs with unguessable public IDs (the previous plan) | Relaxes Principle II: a URL, once obtained, is fetchable by anyone forever, including a former member. Required maintainer sign-off, which the revised instruction withdraws in favour of the proxy. |
| Proxy, but with assets left at `type: upload` (public) | Works, and is marginally simpler — no signed-URL generation. Rejected because it leaves the file publicly reachable by anyone who ever learns the public ID, so FR-057 would hold only by obscurity. The signing code is ~15 lines and buys a genuine second control. |
| `type: private` | Blocks derived transformations, which the variant catalogue depends on. `authenticated` is the Cloudinary delivery type that restricts access *and* permits transformations. |
| Redirect (302) from the proxy to a short-lived signed Cloudinary URL | Cheapest on bandwidth — bytes never touch the app server — but the signed URL lands in the browser's network log, history, and any referrer, which fails FR-056 outright. |
| Store bytes in PostgreSQL, keep today's endpoint | This is the status quo the feature exists to remove (FR-045). |

---

## 2. Which surfaces render listing media

**Decision**: **Replacement only.** The three surfaces that render listing media today render Cloudinary media; no new surface gains listing thumbnails. Unchanged by the revision.

| Surface | File | Renders | Variant |
|---|---|---|---|
| Community main view | [page.tsx:98](../../app/communities/[communityId]/page.tsx#L98) | cover, `aspect-[4/3]`, or "No photo" placeholder | `card` |
| Community listings (discovery) | [page.tsx:98](../../app/communities/[communityId]/listings/page.tsx#L98) | same card shape | `card` |
| Listing detail | [page.tsx:53-64](../../app/communities/[communityId]/listings/[listingId]/page.tsx#L53-L64) | full ordered gallery, 140×105 thumbnails | `thumbnail` |

**Rationale**: Account, My listings, public profiles, and transaction listing context were verified to render **no** listing media today — `grep` for `<img`, `photos`, and `coverPhoto` across `app/**/*.tsx` matches only the three files above. Adding thumbnails to four new surfaces is new feature work, not a storage-backend swap, and Principle VII forbids building it alongside the requested feature: *"Speculative functionality … MUST NOT be built alongside the requested feature — new ideas MUST be captured in the backlog instead."*

**Note on the detail gallery**: it currently renders 140×105 thumbnails and nothing larger — there is no full-size lightbox today. So the `detail` variant is defined and available but **initially unused by any surface**. That is deliberate: FR-059 requires the variant set, and defining it now costs one line in a lookup table, whereas a future lightbox would otherwise need to re-open this decision. It is a table entry, not speculative UI.

**Backlog item created by this decision**: "Show listing cover thumbnails on Account, My listings, public profiles, and transaction listing context." Cheap once this feature lands.

**One consequence handled, not deferred**: [`profileService.ts:46`](../../src/server/services/profileService.ts#L46) already returns `coverPhotoId` on its profile-listing shape even though no profile UI renders it. Under the proxy model that id is exactly what a future surface needs to build an image route URL, so the field is **kept as-is** — no re-typing required, which is one small simplification the revision buys.

---

## 3. Cloudinary client library — SDK vs. `node:crypto` + `fetch`

**Decision**: **No Cloudinary SDK.** A small first-party module, `src/lib/cloudinary/`, implements what this feature needs against Cloudinary's documented HTTP API using `node:crypto` and `fetch`.

Four operations, total:

1. **Upload signature** — take every signed upload **body** parameter, sort by key, join as `k=v&k=v`, append the API secret, and emit the **SHA-256 hexadecimal** digest. Signed: `timestamp`, `public_id`, `type`, `allowed_formats`, `context`. **Excluded from the string-to-sign**: `file`, `cloud_name`, `resource_type`, `api_key` — `resource_type=image` belongs to the endpoint URL path (`/image/upload`), not the signed string. Roughly ten lines.

   **Amended after live verification: `max_file_size` is NOT signable.** The original design signed it to make FR-033's size limit tamper-evident. Cloudinary rejected every such upload with `Invalid Signature`, helpfully echoing the string it had computed — identical to ours except that `max_file_size` was absent. It is an upload-**preset** setting, not an upload-API request parameter. Size is therefore enforced at **association** time from the byte count Cloudinary reports (decision 7): an oversized asset is refused with `file_too_large`, its pending row is consumed so it cannot be resubmitted, and it is queued for deletion. That is *stronger* than the original plan, not weaker — the client cannot influence it at all, whereas a signed parameter still relies on the provider honouring it.
2. **Signed delivery URL** *(new in this revision)* — for `type: authenticated`, sign exactly the URL components that follow the signature component, i.e. `{transformation}/{publicId}`, append the secret, take the **SHA-256** digest, encode it **URL-safe Base64**, and use its **first eight characters** as `s--{sig}--`, producing `…/image/authenticated/s--{sig}--/{transformation}/{publicId}`. Server-only, never returned to a browser.

   **These two must not share an implementation.** Same secret, different input, different encoding (hex vs. truncated URL-safe Base64), different length. A single "sign this" helper serving both is the shape that produces a delivery URL Cloudinary rejects with a 401 and an afternoon of confusion — hence two separate fixture suites in decision 8.
3. **Asset verification** — one authenticated `GET` to the Admin API resource endpoint (HTTP Basic, `api_key:api_secret`), confirming the asset exists and that **all four** hold: its `public_id` starts with the exact expected prefix, its `context` carries the authorizing account and draft, `resource_type === "image"`, and `type === "authenticated"` (FR-030, FR-031). Deliberately **no folder-field comparison** — see decision 5.
4. **Deletion** — one signed `POST` to the destroy endpoint.

**Rationale**:

- All four are stable, documented, small contracts. The SDK's value is concentrated in what this feature explicitly does not use: the upload widget (FR-002, forbidden), server-side upload streams (upload bytes never touch the server), transformation builders (a fixed variant table covers every need), and video.
- Precedent: [`src/lib/email/sendEmail.ts`](../../src/lib/email/sendEmail.ts) deliberately posts to a generic webhook rather than adding Resend/Postmark/SendGrid, and [`.env.example`](../../.env.example) records that this is "so this feature stays vendor-agnostic." Same reasoning for a media provider.
- Principle VII: a dependency whose 5% is used is added complexity needing justification against a sufficient simpler alternative.
- The revision *strengthens* this decision. Under the proxy model nothing Cloudinary-related runs in the browser at all, so the module is purely server-side and needs no client-safe subset — which removes the one awkwardness the SDK's Node-only surface would have caused.

**Alternatives considered**: `cloudinary` npm package (rejected: heavy for four operations, pulls widget/video/streaming surface, contradicts the established vendor-agnostic pattern); `next-cloudinary` (rejected: its headline exports are `CldUploadWidget`, forbidden by FR-002, and `CldImage`, which wraps `next/image` — a dependency this revision explicitly removes as a requirement).

**Risk accepted**: if Cloudinary changes either signature algorithm, this breaks where an SDK would not. Mitigated by the algorithms' stability and by decision 8's fixture-pinned tests, which cover the upload signature and the delivery signature **as two independent suites** — including an assertion that the two produce different output for the same input, so a future refactor cannot quietly collapse them into one helper.

---

## 4. Cover state — keep it on `Listing`

**Decision**: **Keep cover state on `Listing`** as a nullable FK, exactly as today. Do **not** add `isCover` to the photo row. Unchanged by the revision.

**Rationale**:

- FR-041 explicitly allows either, and spec.md's model note permits keeping cover on the listing.
- `Listing.coverPhotoId String? @unique` already exists with `SetNull` behavior and working reassignment logic in [`removeListingPhoto()`](../../src/server/services/listingService.ts#L559-L572) and [`setCoverPhoto()`](../../src/server/services/listingService.ts#L593-L609). Reusing it confines the cutover to media storage and leaves cover *semantics* untouched.
- An `isCover` boolean makes "exactly one cover" a rule the application must police on every write. A single FK on the parent makes it true by construction — a stronger design given FR-015, not merely a cheaper one.
- It preserves the existing cover contract tests at [`tests/contract/test_listings.ts:569-650`](../../tests/contract/test_listings.ts#L569) as behavioural tests, so test churn is confined to how photos are created.

**Alternatives considered**: `isCover Boolean` on the photo (rejected: multi-cover states become representable, needing a partial unique index or transactional policing, and it discards working code); derive cover as `displayOrder = 0` (rejected: FR-018 wants explicit member choice, which would then require reordering the whole set to change the cover).

---

## 5. Asset identity and naming — public ID only, no `folder` parameter

**Decision**: The server generates the public ID; the client never proposes one. Layout:

```
cmarket/<env>/listings/<listingId>/<random>
```

- `<env>` from a required `CLOUDINARY_ENV_FOLDER` (`development` | `test` | `production`) — FR-029, FR-102, and the mechanism behind FR-103.
- `<listingId>` on the create path is a client-generated draft id the server validates as a cuid-shaped opaque string, because no listing exists yet (decision 7).
- `<random>` is 16 bytes of `crypto.randomBytes` hex — carries no filename (FR-101) and is not guessable.

**The complete public ID is the only path mechanism. No `folder` parameter is sent or signed.**

Cloudinary accounts run in either fixed-folder or dynamic-folder mode, and the two treat a `folder` parameter alongside a path-bearing `public_id` differently — one prepends it, the other treats the public ID as authoritative. Sending both would make the resulting asset path depend on an account setting no code can inspect, which in turn would make `verifyAsset`'s prefix check pass in one mode and fail in the other. Repository inspection confirms no Cloudinary integration and no folder mode exists yet, so there is no legacy behaviour to match: the unambiguous choice is to send the full public ID and nothing else. **The implementation must not depend on which mode the account is in.**

Signed upload params are therefore `timestamp`, `public_id`, `type: "authenticated"`, `allowed_formats`, and a `context` carrying the authorizing account id and draft/listing id — sorted alphabetically, SHA-256 hex. Because all of these sit inside the signature, a tampering client invalidates it, which is what makes FR-033's **format** enforcement real rather than advisory. `resource_type` is **not** signed: it is fixed by the endpoint URL path and re-asserted at verification. `max_file_size` is **not** signable at all (decision 3); the **size** limit is enforced at association time from Cloudinary's reported byte count.

**Provenance without folders.** `verifyAsset` checks four things — the exact expected public-ID prefix `cmarket/{env}/listings/{draftId}/`, the account and draft recorded in `context`, `resource_type: image`, and `type: authenticated` — on top of the `PendingListingMedia` row that must already exist for that account. Five independent facts, none depending on folder-mode semantics.

**Note on unguessability under the revision**: random public IDs are no longer load-bearing for *access* — the proxy and `type: authenticated` handle that. They remain required for FR-101 (no filenames in identifiers) and as a third layer of defence. Downgrading to predictable ids would be safe in principle and is still rejected: it would put member filenames into asset paths and logs.

**Rationale for the path shape**: a per-listing path segment makes listing-deletion cleanup a prefix operation rather than an unbounded search, and makes an orphaned-asset audit a prefix listing. Environment as the top-level segment means a staging deployment physically cannot address production assets — the only robust form of FR-103, since an env check in application code is bypassable by a bug while a path prefix is not.

**Alternatives considered**: sending `folder` alongside the public ID (rejected: behaviour becomes account-mode-dependent, as above); a flat path with a composite public ID (rejected: no prefix operations, listing-scoped audit becomes a full-account scan); `<accountId>` in the path (rejected: the authorizing account is already in `context` and in Postgres, and it would place account identity into asset paths for no gain); Cloudinary tags instead of path prefixes (rejected: tag-based bulk delete is rate-limited and eventually consistent).

---

## 6. Variant catalogue and proxy caching *(replaces the former `remotePatterns` decision)*

**Decision**: A server-side variant table. The client names a variant; it never supplies dimensions.

| Variant | Transformation | Intended use | Approx. bytes |
|---|---|---|---|
| `thumbnail` | `c_limit,w_320,f_auto,q_auto` | detail-page gallery tiles (140×105 rendered, 2× for density) | ~15–25 KB |
| `card` | `c_limit,w_640,f_auto,q_auto` | listing cards in feeds and discovery | ~35–60 KB |
| `detail` | `c_limit,w_1280,f_auto,q_auto` | full-size view — defined, not yet used by any surface (decision 2) | ~120–200 KB |

**Key properties**:

- **`c_limit`, never `c_fill` or `c_scale`** — `c_limit` only ever shrinks and always preserves the source aspect ratio, so FR-064 (no distortion) is guaranteed at the transformation layer rather than relying on CSS. The existing card UI's `aspect-[4/3]` container with `object-cover` still crops *visually*, which is presentation, not distortion.
- **`f_auto,q_auto`** — Cloudinary negotiates format from the `Accept` header the proxy forwards, and picks quality automatically.
- **The variant name is the only client input**, resolved through a lookup with no string interpolation from the request. An unknown name resolves to `card` rather than erroring, so a stale client renders something instead of broken images (FR-061). No client-supplied value ever reaches a Cloudinary transformation string (FR-060) — this is the whole reason the table is a table and not a builder.

**Caching**: `Cache-Control: private, no-cache`, plus `ETag: W/"{cloudinaryAssetId}-{variant}"` and `Vary: Accept` because `f_auto` makes the bytes format-dependent.

**The validator is deliberately weak.** `f_auto` negotiates format from the request's `Accept` header, so the same photo at the same variant legitimately returns WebP to one client and JPEG to another. A strong `ETag` asserts byte-for-byte equality, which would be a false claim; `W/` asserts semantic equivalence, which is exactly what is true. `Vary: Accept` then keeps a cache from serving one negotiated format to a client that cannot accept it. The identifier half comes from `cloudinaryAssetId`, which is immutable for the asset's lifetime, so the header is stable across requests and differs across variants — and note that using it here requires `getListingPhoto()` to return it (decision 12's retained-function note), while FR-056 still forbids emitting it in any other form.

`no-cache` is widely misread as "do not cache." It means the opposite of `no-store`: the browser **may** store the response but **must revalidate** before reusing it. So the cache still works — a reuse is a conditional request answered by a small `304`, not a re-download — while every reuse passes back through authorization.

That property is the whole point, and it is why a `max-age` is prohibited (FR-058). Under the previously planned `max-age=300`, two concrete holes existed:

- A member who **left the community** kept seeing its listing images for up to five minutes, because the browser answered from cache without consulting the server at all.
- **Two accounts on one browser** — sign out, sign in as someone else — and the second account's page reused the first account's authorized bytes, with no request reaching CMarket to notice.

Neither is exotic; both are ordinary sequences. `no-cache` closes both by construction rather than by shortening a window.

**Authorization must precede the `304`** (FR-109). This is the correctness detail that makes the above true, and it is easy to get backwards: the natural implementation instinct is to check `If-None-Match` first as a cheap fast path, before touching the database. Doing so would return `304` — an implicit "your cached copy is still good, use it" — to a caller who has since lost membership or become a different account. The `304` is an authorization decision, not a caching shortcut, so the gate runs first. This gets its own contract test, and it sits alongside the `deleteListing` ordering trap as one of two orderings in this feature where the obvious arrangement is the wrong one.

Never `public`, never `s-maxage`. The route must not sit behind a shared cache keyed on URL alone — that would serve one member's authorized bytes to an unauthorized caller, defeating the entire proxy (FR-058).

**Cost accepted**: one conditional request per image reuse, where `max-age` would have had zero. For a feed of twenty cards that is twenty cheap `304`s on revisit instead of silence. This is the correct trade — the alternative is a revocation delay measured in minutes — and `no-store` was considered and rejected as the opposite over-correction, since it would force a full re-download of every image on every render.

**`next.config.ts` is not modified.** The previous plan added `images.remotePatterns`; under the proxy the browser never requests a Cloudinary host, so there is nothing to allowlist. One fewer configuration surface, and no `NEXT_PUBLIC_` Cloudinary variable is needed anywhere (FR-099).

**Alternatives considered**: arbitrary `?w=` passed through to Cloudinary (rejected: FR-060, and it hands an attacker a transformation-cost amplifier against the Cloudinary account); `next/image` against the proxy route (rejected: no longer a requirement, and it would double-optimize already-variant-sized bytes for no benefit); one universal size (rejected: FR-070, and it wastes the largest available saving); storing physical renditions per variant (rejected: multiplies storage and cleanup surface for something Cloudinary derives on demand).

---

## 7. The create-listing ordering problem — uploads before a listing exists

**Problem**: uploads must be authorized against something, but on the create path no listing exists yet — no `listingId` to own the asset, no owner to check. Today the form dodges this by creating the listing first and uploading afterwards ([ListingForm.tsx:143](../../app/communities/[communityId]/listings/ListingForm.tsx#L143)), which is exactly why a failed upload today silently yields a listing with missing photos.

**Decision**: A persisted **`PendingListingMedia`** row per authorized upload, keyed by a client-generated `draftId`. Unchanged by the revision.

1. Client generates a `draftId` once per form session, sending it with each authorization request.
2. Server authorizes — authenticated (FR-026), current member (FR-027), not a MASTER (FR-032), and in edit mode the listing's owner (FR-028) — then writes a `PendingListingMedia` row recording `accountId`, `communityId`, `draftId`, `publicId`, `expiresAt`, and returns signed params.
3. Browser uploads directly to Cloudinary.
4. On submit the client sends the ordered list of public IDs. The server matches each against a row **owned by the submitting account** for that `draftId`, verifies the asset with Cloudinary, creates `ListingPhoto` rows in one transaction, and deletes the pending rows.

### Re-authorization is a distinct mode, not a second authorization

An earlier draft said a stale file "re-authorizes" without saying how, which would have meant calling the initial path again. That does not work: the initial path mints a **new** public ID and writes a **new** pending row, so a single retried file would end up with two identities, two pending rows, and two counts against the eight-photo cap — and retrying the eighth photo would fail with `photo_limit_reached` for no reason the member could understand. The original upload's asset would also be orphaned under a public ID nothing references.

So `authorizeUpload()` takes an optional `publicId`:

| Mode | Trigger | Behaviour |
|---|---|---|
| **Initial** | no `publicId` supplied | Generate a fresh public ID, enforce the eight-photo cap across associated plus pending, write one `PendingListingMedia` row |
| **Retry** | a previously server-issued `publicId` supplied | Find the **unexpired** row by `accountId` + `draftId` + `publicId`; reuse that exact public ID; write **no** row; **skip** the cap check, because the file is already counted |

Retry refuses a row belonging to another account or another draft, and refuses an expired row. Both modes run the identical authorization gate first — retry is a narrower operation, never a weaker one.

**On the refresh threshold**: the client refreshes authorization for a file that has been queued longer than a conservative threshold (10 minutes) before starting its upload. That number is **CMarket's own client-side staleness policy**, not a claim about Cloudinary. Cloudinary's own timestamp tolerance is a separate server-side setting on their end and is considerably more generous; the plan deliberately does not depend on its exact value. The `PendingListingMedia` row's 30-minute `expiresAt` is longer than the refresh threshold precisely so a refresh has something valid to match against — that relationship is the one that matters, and it is ours to control on both sides.

**Why persisted rather than a stateless signed token**: FR-083 requires abandoned uploads to be *identifiable*. A stateless token dropped on tab close leaves an asset in Cloudinary that Postgres never heard of, findable only by scanning the whole account — the exact audit FR-083 exists to avoid. A row makes the abandoned set a trivial query.

**Why this also satisfies FR-030/FR-031**: association trusts nothing from the client except an opaque public ID that must already appear in a row the server itself wrote for that account. A forged or unrelated public ID has no row, so it never associates — FR-031 and User Story 5 scenario 7 fall out of the design.

**Idempotency (FR-019)**: `ListingPhoto.cloudinaryPublicId` is `@unique`, so a double-submitted form cannot create a second row for the same asset.

**Alternatives considered**: create the listing first then upload (rejected: today's bug, and FR-076 requires the opposite); stateless signed JWT (rejected: fails FR-083); upload to a staging folder and rename on association (rejected: doubles Cloudinary calls and adds a failure mode between two states that must agree).

---

## 8. Test strategy

Constitution Principle VIII names **product listing** as a critical flow, so tests are mandatory, written first, failing first, blocking merge in CI. This feature changes how listing media is created, read, ordered, covered, delivered, and deleted.

| Layer | File | Covers |
|---|---|---|
| Contract (Vitest) | `tests/contract/test_listing_media.ts` (new) | authorization matrix for authorize/associate/reorder/cover/remove — unauthenticated, non-member, non-owner, MASTER (FR-026–FR-028, FR-032); 8-photo cap (FR-004); duplicate-public-ID idempotency (FR-019); contiguous order after add/remove/reorder (FR-020); cover auto-assign, explicit set, deterministic reassign on removal (FR-016–FR-018); pending-row expiry and forged-public-ID rejection (FR-030, FR-031); the signed-parameter set and its **exclusions** (`resource_type`, `cloud_name`, `api_key`, `file` unsigned; no `folder` sent at all); and **both authorize modes** — initial mints one row, retry reuses the same public ID, writes no second row, does not re-count the cap, and refuses a foreign or expired row (decision 7) |
| Unit (Vitest) | `tests/unit/test_cloudinary_signature.ts` (new) | two **independent** suites: the upload signature's alphabetical string-to-sign and **SHA-256 hex** output with `file`/`cloud_name`/`resource_type`/`api_key` excluded; and the delivery signature's `{transformation}/{publicId}` input with **SHA-256 → URL-safe Base64 → first 8 characters** output. Asserts the two produce different output for identical input, so a refactor cannot quietly collapse them into one helper (decision 3) |
| Contract (Vitest) | `tests/contract/test_listing_photo_delivery.ts` (new) | the proxy's own gate: 401 unauthenticated; refusal for a non-member; refusal for a photo whose listing is in another community (FR-053, FR-054); refusal for a MASTER; success returns bytes with `Cache-Control: private, no-cache` and an `ETag`, and **never** a `max-age` (FR-058); `Vary: Accept`; **authorization precedes `304`** — a matching `If-None-Match` from a caller who has lost membership, or from a different account, is refused rather than answered `304` (FR-109); a valid conditional request returns `304` only after the gate passes; the route responds `200` and **never** `3xx` (FR-107); each variant name maps to its expected transformation; an unknown variant resolves to `card` and never interpolates client input (FR-060, FR-061); no Cloudinary delivery URL, signed source URL, or public ID in body or headers (FR-056); a deleted photo returns 404 on its next conditional request (FR-078) |
| Contract (Vitest) | `tests/contract/test_media_cleanup.ts` (new) | the cleanup queue: a due row is destroyed with `invalidate: true` and deleted; a transient failure increments `attempts`, records `lastError`, and backs off `2^attempts` minutes capped at 24h; enqueueing the same `publicId` twice yields one row; expired unassociated `PendingListingMedia` rows are swept in (FR-083); a bad `X-Cleanup-Token` returns `401`. Non-blocking is asserted as **two halves** (FR-085): removal succeeds with **zero** `destroyAsset` calls and one committed task row — removal never contacts Cloudinary, which is exactly what makes it outage-proof — and a separate drain with `destroyAsset` failing leaves the row present with `attempts` incremented, `lastError` recorded, `nextAttemptAt` advanced, and the earlier listing edit still committed |
| Contract (Vitest) | `tests/contract/test_listings.ts` (rewrite) | the existing `addListingPhoto`/`removeListingPhoto`/`setCoverPhoto` blocks rewritten against the Cloudinary-backed model, plus the `deleteListing` enqueue-before-cascade ordering test. FR-096 means rewritten, not kept alongside — the `6`-photo assertion at line 393 becomes `8`, and the `Buffer` fixtures at lines 359-389 have no successor because upload bytes never reach the server |
| Unit (Vitest) | `tests/unit/test_cloudinary_variants.ts` (new) | the variant table: every entry uses `c_limit` (never `c_fill`/`c_scale`, so aspect ratio cannot be distorted — FR-064); every entry carries `f_auto,q_auto`; unknown names fall back; no code path concatenates a request value into a transformation |
| Unit (Vitest) | `tests/unit/test_no_cloudinary_in_client_bundle.ts` (new) | asserts `CLOUDINARY_API_SECRET` appears in no `.next` client chunk; that the **delivery** host `res.cloudinary.com` appears in no client chunk and no rendered listing markup; that no source file references a `NEXT_PUBLIC_CLOUDINARY_*` name; and that no client component imports `src/lib/cloudinary/` (FR-098, FR-099, FR-100, SC-012). **Deliberately does not assert on the bare word "cloudinary" or on `api.cloudinary.com`** — the uploader legitimately receives an upload endpoint at runtime (FR-108), so a blunt keyword assertion would either fail spuriously or have to be weakened until it proved nothing. The test distinguishes forbidden delivery data from permitted upload metadata, which is the whole point |
| Integration (Playwright) | `tests/integration/test_listing_media_flow.spec.ts` (new) | multi-select, per-file preview and state, reorder by button, cover choice, per-file retry/remove, submit-blocked-while-uploading, order preserved when completion order differs, mobile viewport with touch reorder, placeholder for a legacy image-less listing, `loading="lazy"` on non-cover gallery images (FR-067), `width`/`height` present on rendered images (FR-068), no horizontal overflow (FR-065), every `img src` pointing at `/api/communities/…/listing-photos/…`, and that rendered listing markup contains no `res.cloudinary.com` (FR-056, SC-007). Separately asserts the **permitted** side of the boundary: the authorize response *does* carry an upload endpoint, API key, timestamp, signature, and public ID, and *does not* carry the API secret (FR-108) — so the suite pins both what must be absent and what must be present, and a future "tighten the leak check" change cannot silently break uploads |

**Removed from the previous strategy** (no longer requirements): the `next/image` rendering assertions, the `remotePatterns` misconfiguration probe, and the lint assertion that no `@next/next/no-img-element` suppression exists. The last one **inverts** — one suppression is now expected, in the single shared media component, and its presence is fine while its spread beyond that file is not.

**Cloudinary is never contacted from tests.** Upload, verification, delivery fetch, and destroy are all stubbed at the `src/lib/cloudinary/` boundary — a second reason decision 3 keeps that module first-party and small. Playwright intercepts the direct-to-Cloudinary upload request to produce forced failures and out-of-order completion deterministically, and stubs the proxy's upstream fetch so delivery tests need no network.

---

## 9. Cleanup and retry

**Decision**: A `MediaCleanupTask` table plus a route that drains it, invoked by whatever scheduler the deployment already has. No new queue infrastructure, no new dependency.

- Every asset that becomes unreferenced — photo removed, listing deleted, pending upload expired — gets a row.
- Rows carry `publicId`, `attempts`, `lastError`, `nextAttemptAt`. Backoff is `nextAttemptAt = now + 2^attempts` minutes, capped at 24h.
- Cleanup **never blocks** the member's operation (FR-085): the listing write and the cleanup enqueue happen in one transaction; the Cloudinary call happens afterwards, out of band.

**The `deleteListing` ordering trap**: `ListingPhoto` has `onDelete: Cascade`, so [`deleteListing()`](../../src/server/services/listingService.ts#L761-L767) destroys the photo rows — and therefore the only record of which Cloudinary assets existed — the moment it runs. Cleanup rows **must** be enqueued inside that same `$transaction`, before `listing.delete()`. Getting this backwards silently orphans every asset of every deleted listing, with no record they ever existed. FR-080 depends entirely on this ordering, and it gets its own contract test.

**Cache invalidation under the proxy revision**: destroy still passes `invalidate: true`, though it now matters less — no CDN sits between Cloudinary and the browser, and the proxy is the only reader.

The browser-cache concern the earlier draft accepted here is **gone**. Under `private, no-cache` a browser must revalidate before reusing a stored image, so a deleted photo produces a `404` on the very next attempt rather than continuing to display for a TTL window. Combined with public IDs being random and never reused — a replaced photo is always a different photo id and therefore a different proxy URL — there is no stale-after-delete and no stale-after-replace case left to reason about.

**Alternatives considered**: best-effort fire-and-forget delete (rejected: FR-082 requires recorded retryability, and a transient 5xx would silently orphan an asset); Cloudinary webhook-driven deletion (rejected: adds an inbound webhook surface and signature-verification burden for a problem a table solves); blocking the listing write on successful deletion (rejected: FR-085, and it turns a Cloudinary outage into a listing-editing outage).

---

## 10. Upload concurrency and per-file state

**Decision**: A plain promise-pool in the uploader component — three workers pulling from a queue of pending files (FR-011, SC-020). Per-file state is `queued | uploading | uploaded | failed`, held in a `Map` keyed by a client-side file id, kept **separate** from display order (FR-017).

**Rationale**: separating "where is this file in the upload lifecycle" from "where does the member want it shown" is the whole of FR-017 and SC-003. Keying by a generated file id rather than by name or index means duplicate selections of the same file are distinct entries, reordering does not disturb in-flight uploads, and removing an entry mid-upload is a `Map` delete plus an `AbortController` abort rather than an index-shifting bug.

Progress uses `XMLHttpRequest.upload.onprogress`, not `fetch` — `fetch` still exposes no upload-progress event, and FR-007 requires per-file progress. This is the one place the implementation deliberately reaches for the older API, and it should carry a comment saying why so it is not "modernized" into a regression.

**Touch reorder (FR-010, Principle V)**: move-left/move-right buttons on each tile, not HTML5 drag-and-drop. Native drag events do not fire on touch, so a drag-only reorder would make a core interaction desktop-only, which Principle V forbids outright. Buttons are keyboard-reachable for free.

**Previews stay local**: pending-file previews come from `URL.createObjectURL(file)`, revoked on removal — not from the proxy, which cannot serve an asset that has no `ListingPhoto` row yet. Already-saved photos in edit mode render from the proxy.

**Alternatives considered**: unbounded parallel upload (rejected: FR-011); sequential upload (rejected: needlessly slow for eight files); a drag-and-drop library (rejected: a new dependency for two buttons, and Principle VII).

---

## 11. Configuration and fail-loud behavior

New environment variables — **all server-side**. The revision removes the previously planned `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` entirely: delivery needs no client-side Cloudinary value, and the authorize endpoint returns the complete upload endpoint dynamically at runtime, so nothing Cloudinary has to be baked into the client bundle (FR-099).

| Variable | Scope | Notes |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | server | |
| `CLOUDINARY_API_KEY` | server | Sent to authorized clients as part of the upload protocol only |
| `CLOUDINARY_API_SECRET` | server only | **Never** `NEXT_PUBLIC_` (FR-098), never logged (FR-100) |
| `CLOUDINARY_ENV_FOLDER` | server | `development` \| `test` \| `production`. Names the top **path segment**, not a Cloudinary `folder` parameter (decision 5) — FR-102, FR-103 |
| `LISTING_IMAGE_CACHE_MODE` | server | `no-cache` (default) \| `no-store`. A mode toggle, **not** a TTL — `max-age` is not an option, because permitting reuse without revalidation is exactly what FR-058 prohibits |
| `CLEANUP_TOKEN` | server | Shared secret for the cleanup drain endpoint |

**Decision on FR-106 (fail loud)**: a `requireCloudinaryConfig()` accessor that throws on first use if any server variable is missing or empty. Not a startup assertion — `next build` runs without production secrets, so a build-time check would break the Docker build. First-use throw gives a loud, actionable failure on the first upload or delivery attempt instead of an application that silently renders no images.

**Decision on how each environment gets its values**: three different mechanisms, because they have three different trust levels, and conflating them is how secrets end up committed.

| File | Contents | Who writes it |
|---|---|---|
| `.env.example` | Variable **names** and explanatory comments only — never a value | Committed, written as part of this feature |
| `.env` | Real development credentials | **The maintainer, by hand.** Uncommitted. No task, script, or agent may create or populate it |
| `.env.test` | Deterministic **dummy** values (`test-cloud`, `test-secret-not-a-real-credential`, …) | Committed. Safe because every Cloudinary call is stubbed at the `src/lib/cloudinary/` boundary (decision 8), so the values are never used against a real account — they exist only so `requireCloudinaryConfig()` passes and so the signature fixtures have stable inputs to pin |

No real credential may appear in a test fixture, a task artifact, a committed file, or generated source (FR-100). This is why the dummy values are chosen to be self-evidently fake rather than realistic-looking.

Logging (FR-104): failures log `publicId`, operation, HTTP status, and Cloudinary's error message. **Never** the signature, the signed delivery URL, the API key, or the secret. Signed delivery URLs are explicitly on the forbidden list because a proxy that logs them undoes the point of not sending them to the browser — the same reasoning that forbids redirecting to one (FR-107). Note `publicId` in a *server* log is fine; FR-056 governs browser-reachable responses, not server-side diagnostics. [`.env.example`](../../.env.example) gains all six variables in the same explanatory-comment style the existing entries use.

---

## 12. Resolved: what gets deleted, kept, and rewritten

Enumerated so the cutover is a checklist rather than a judgement call during implementation (FR-090, FR-091, SC-017). **Amended by the revision** — three former deletions are now retentions.

### Deleted

| Removed | Location |
|---|---|
| `ListingPhoto.data`, `.mimeType`, `.sizeBytes` | `prisma/schema.prisma` |
| `MAX_PHOTO_BYTES`, `ALLOWED_PHOTO_MIME_TYPES` | `listingService.ts` (moved into signed upload params, decision 5) |
| `addListingPhoto()`'s `data`/`mimeType` input and its `invalid_photo` reason | `listingService.ts` |
| The multipart `POST` handler | `app/api/.../photos/route.ts` (replaced by a JSON association handler) |
| The byte `GET` handler at the old path | `app/api/.../photos/[photoId]/route.ts` (superseded by the new community-scoped delivery route) |
| `uploadPhotos()` and the raw `<input type="file">` | `ListingForm.tsx` |
| Byte-based photo fixtures | `tests/contract/test_listings.ts` |

### Kept (changed from the previous plan)

| Kept | Why |
|---|---|
| `getListingPhoto()` in `listingService.ts` | **Retained, with a new body.** Its authorization logic — `requireCommunityMembership(..., { allowSuspended: true })` then verify the photo's listing matches the community — is exactly what the proxy needs. Only the byte source changes: a PostgreSQL column becomes an authenticated Cloudinary fetch. Its successful **internal** result must carry `cloudinaryAssetId`, `cloudinaryPublicId`, `width`, and `height` — the asset id because the delivery `ETag` derives from it (decision 6) and the public id because the fetch resolves by it. Both are server-internal; FR-056 still forbids either reaching a proxy response or a listing read. The previous plan deleted this function; deleting and reinventing the same gate would have been the worse move. |
| Plain `<img>` elements on the three surfaces | FR-063 makes raw `<img>` acceptable. They move behind one shared component and change their `src` to the proxy route; they are not replaced with `next/image`. |
| The single `@next/next/no-img-element` suppression | Now **expected** rather than forbidden, confined to the one shared media component with a comment explaining that delivery is proxied and `next/image` is deliberately not used. |
| `next.config.ts` | **Unmodified.** No `images.remotePatterns` block is needed, because the browser never requests a Cloudinary host. |
| `profileService.ts` | **Unmodified.** Its existing `coverPhotoId` field is exactly what a future surface needs to build a proxy URL, so no re-typing is required. |

`MAX_PHOTOS_PER_LISTING` is **not** deleted — it changes from `6` to `8` (FR-004).
