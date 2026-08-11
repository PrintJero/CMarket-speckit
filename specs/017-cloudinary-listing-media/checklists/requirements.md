# Specification Quality Checklist: Cloudinary Listing Media Integration

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-06
**Last revised**: 2026-08-06 — re-validated after the delivery architecture changed to authenticated CMarket proxy routes
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Validation Findings

### Accepted deviations (named provider is the feature)

Two items pass with a documented exception rather than a literal pass:

- **"No implementation details"** and **"Success criteria are technology-agnostic"**: this feature's request *is* a named-vendor migration — Cloudinary as the storage provider is the user's explicit, non-negotiable constraint, not an incidental technical choice. Removing the name would make the specification unable to state what the feature is. Named technologies are permitted where they are the requirement itself (Cloudinary, Prisma migration, `CLOUDINARY_API_SECRET`) and avoided everywhere else — no route internals, component names, library choices, or field types are prescribed beyond the route *shape* the revision instruction specified verbatim. The database field list is explicitly labelled adjustable during planning.
- The revision **reduced** this exception's surface: `next/image`, `remotePatterns`, image loaders, and `srcset` are no longer mentioned as requirements anywhere, so one whole framework-specific vocabulary left the spec.

### Architecture revision (2026-08-06)

Delivery changed from public Cloudinary URLs rendered through Next.js Image to **authenticated CMarket proxy routes**. Consequences for this checklist:

- **The Principle II deviation is gone, and with it the maintainer sign-off** this checklist previously listed as the one open item. The proxy re-validates session and current membership on every image request, preserving today's guarantee rather than relaxing it. [plan.md](../plan.md)'s Complexity Tracking table is now empty and marked not-applicable.
- **New requirement clusters**: authenticated image delivery (FR-049–FR-062) and image presentation (FR-063–FR-070) replace the former "Next.js Image delivery" and "Image access model" sections.
- **New success criteria**: SC-007 (no Cloudinary delivery data reaches the browser), SC-008 (URL alone grants nothing), SC-009 (private, revalidated caching only), SC-010 (predefined variants only), SC-015 (lazy loading and reserved space).

### Amendment (2026-08-06) — two corrections

**1. Upload exposure distinguished from delivery exposure.** The previous revision asserted that no Cloudinary hostname, URL, or public ID ever reaches the browser. That was **internally contradictory**: the same document specified direct browser-to-Cloudinary uploads, which cannot work unless the browser receives an upload endpoint, API key, timestamp, signature, and the server-generated public ID. The prohibition is now scoped to what it was always meant to protect — **listing reads and image delivery** — while FR-108 states the upload flow's permitted, temporary exposure explicitly. `CLOUDINARY_API_SECRET` is excluded with no exception. FR-107 additionally forbids redirecting to Cloudinary, closing the loophole where a `302` would satisfy "no URL in the body" while handing the browser a durable read capability via its history and referrers.

This was a genuine defect in the prior specification, not a preference change: an implementer following it literally would have had to break uploads.

**2. Membership revalidation before cached reuse.** `Cache-Control: private, max-age=300` is replaced by `private, no-cache` with `ETag` retained, and FR-109 requires authorization to complete before either `200` or `304`. The prior TTL left two ordinary sequences unguarded — a member who left a community kept seeing its images for up to five minutes, and a second account signing in on the same browser reused the first account's authorized bytes — because in both cases the browser answered from cache with no request reaching CMarket. `no-cache` is not `no-store`: bytes are still stored and a reuse costs one cheap `304`, so the price is one conditional request per reuse in exchange for immediate revocation.

**Consequences across artifacts**: every "residual private-cache exposure" caveat is **removed rather than reworded** — the exposure no longer exists. `LISTING_IMAGE_CACHE_SECONDS` becomes `LISTING_IMAGE_CACHE_MODE` (`no-cache` | `no-store`), a mode toggle with no TTL option. The bundle-leak test now asserts on the *delivery* host `res.cloudinary.com` rather than the bare word "cloudinary", and additionally pins the *presence* of legitimate upload metadata, so a future tightening of the leak check cannot silently break uploads.

**FR-107–FR-109 were appended, not inserted**, so all pre-existing requirement numbers and the 84 cross-references to them stay stable. This follows the convention `prisma/schema.prisma` already uses for the 2026-07-17 cover-photo amendment. Numbering runs FR-001–FR-109 with no gaps or duplicates.

### Implementation corrections (2026-08-06, third pass)

Six corrections to `tasks.md` and the design artifacts. **No requirement text, success criterion, entity, or principle assessment changed** — these are all implementation-level, which is why the checklist above is unaffected. Three of the six were genuine defects in the previous revision rather than refinements:

- **Retry authorization did not exist** (defect). T042/T046 asserted a file "re-authorizes" against its pending row, but `authorizeUpload()` was specified to always mint a new public ID and always write a new pending row. A retried file would therefore have acquired two identities and two cap counts, so retrying the eighth photo would have failed with `photo_limit_reached`, and the first upload's asset would have been orphaned. `authorizeUpload()` now has explicit initial and retry modes ([research.md #7](../research.md)).
- **The delivery `ETag` referenced a field the service did not return** (defect). The header was specified as `{cloudinaryAssetId}-{variant}` while T031 had `getListingPhoto()` returning only `cloudinaryPublicId` and dimensions. T031 now returns both identifiers, and the validator is **weak** (`W/"…"`) because `f_auto` negotiates format — a strong validator would falsely assert byte-equality.
- **T075 asserted a call that never happens** (defect). It claimed removal succeeds "with `destroyAsset` failing", but removal only enqueues a cleanup row and never contacts Cloudinary, so the test would have passed vacuously while proving nothing. It is now split: removal succeeds with **zero** `destroyAsset` calls, and a separate drain with `destroyAsset` failing leaves the row with `attempts`/`lastError`/`nextAttemptAt` advanced.
- **Signature algorithms were conflated.** Upload and delivery signing now have separate specifications and separate fixture suites, with an assertion that they produce different output for the same input. Upload excludes `file`, `cloud_name`, `resource_type`, and `api_key` from the string-to-sign; `resource_type=image` belongs to the endpoint URL.
- **The `folder` parameter is removed entirely.** Sending it alongside a path-bearing `public_id` would make asset paths depend on the account's fixed-folder vs. dynamic-folder mode. Provenance now rests on public-ID prefix, `context`, `resource_type`, `type`, and the pending row.
- **Credential handling is split three ways.** `.env.example` carries names only; `.env` is maintainer-written and uncommitted; `.env.test` carries deterministic dummies, safe because every Cloudinary call is stubbed. No agent task writes a real secret.

Task count and numbering are unchanged at T001–T098 — every correction was absorbed into existing tasks rather than appended, so no task ID moved.
- **All FRs renumbered** to stay sequential; every cross-reference in research.md, plan.md, data-model.md, contracts, and quickstart.md was updated to match.
- **One requirement inverted**: the previous spec forbade any `@next/next/no-img-element` suppression. Raw `<img>` is now explicitly acceptable, so exactly one documented suppression in the single shared media component is expected. The corresponding lint assertion was removed from the test strategy.

### Corrections applied during validation

Grounded against the repository rather than accepted from the input as written:

1. Added a **Current State** section recording the baseline being replaced — in-database photo bytes, a membership-gated byte endpoint, a six-photo ceiling, listing-held cover reference, plain `<img>` rendering, the three surfaces that actually render listing media, and the absence of any variant concept.
2. Corrected the assumption that Account, My listings, public profiles, and transaction context currently display listing media — they do not. Recorded as FR-072, replacement-only.
3. Made the six-to-eight ceiling change explicit (FR-004) instead of silently stating "eight".
4. Added requirements the input implied but did not state: server-side format/size enforcement so a bypassed client cannot store a disallowed asset (FR-033); one-asset-to-one-listing (FR-047); contiguous display order (FR-020); indistinguishable refusals so a wrong-community photo cannot be confirmed to exist (FR-054); no Cloudinary delivery data in listing reads or delivery responses (FR-056); no Cloudinary value baked into the client bundle (FR-099); environment isolation for deletes (FR-103); fail-loud misconfiguration (FR-106); cleanup never blocking the listing operation (FR-085); signed delivery URLs excluded from logs (FR-104); no redirect to Cloudinary (FR-107); authorization before `304` (FR-109).
5. Added MASTER exclusion (FR-032, US5 scenario 8, SC-011) — Principle IX forbids a MASTER acting as a marketplace participant, which upload authorization would otherwise permit.
6. Added touch-reachable reordering (FR-010, US2 scenario 7, SC-014) — Principle V forbids a desktop-only core interaction, and drag-only reorder would be exactly that.
7. Added FR-096 so legacy-dependent tests and fixtures are migrated rather than kept alive by preserving a legacy code path.
8. Added edge cases specific to proxied delivery: membership lost while a page still holds image URLs, a photo deleted while a browser holds it cached, an unknown variant name, a well-formed but nonexistent photo id.
9. Added Dependencies (now including outbound Cloudinary access at *read* time) and Constitution Alignment sections.
10. Recorded the proxy's bandwidth cost as an explicit assumption rather than leaving it implicit — the application server is back on the byte path, accepted deliberately to preserve membership gating.

## Notes

- All checklist items pass. No open blockers.
- The residual private-cache window the previous revision accepted is **gone**, not tuned — `private, no-cache` plus authorization-before-`304` means revocation lands on the next image request. The remaining cost is one conditional request per cached reuse, which is the intended trade.
- Two orderings in this feature are traps where the obvious implementation is wrong, and both are worth calling out in task descriptions rather than leaving to reviewer vigilance: **authorization must precede any `304`** (FR-109), and **cleanup rows must be enqueued before `listing.delete()`** fires the cascade. Each has a dedicated contract test.
- Ready for `/speckit-tasks`.
