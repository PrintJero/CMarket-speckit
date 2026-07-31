# Phase 1 Data Model: Navigation Shell and Community Selector

Per spec.md's Key Entities section, this feature changes no existing entity's business meaning. The one schema change is additive infrastructure for the session-scoped "active community" concept the Clarifications session resolved — not a new marketplace entity.

## Session (extended — 002-accounts-authentication)

| Field | Type | Notes |
|---|---|---|
| `activeCommunityId` | `String?` | **New.** Nullable FK to `Community.id`, `onDelete: SetNull`. Null means "no remembered active community" — the default for every freshly created session (FR-001, Assumptions). |
| *(all existing fields)* | — | Unchanged: `id`, `accountId`, `sessionToken`, `createdAt`, `expiresAt`. |

**Prisma sketch**:

```prisma
model Session {
  id                String    @id @default(cuid())
  accountId         String
  sessionToken      String    @unique
  createdAt         DateTime  @default(now())
  expiresAt         DateTime
  activeCommunityId String?

  account         Account    @relation(fields: [accountId], references: [id], onDelete: Cascade)
  activeCommunity Community? @relation(fields: [activeCommunityId], references: [id], onDelete: SetNull)

  @@index([accountId])
  @@map("sessions")
}
```

**Lifecycle**:
- Created as `null` whenever a new `Session` row is created (sign-in) — matches FR-001/Assumptions: a new session always starts with no remembered active community.
- Set to a specific `Community.id` only after that id has passed `requireCommunityMembership()` for the session's own `accountId` (FR-002, FR-014) — never written from an unvalidated client value.
- Read only through `getCurrentAccount()`, which re-validates it against current membership on every call (FR-001b) before exposing it — an invalid value is surfaced to callers as `null`, not as a stale community id. The underlying column is not proactively cleared when it goes stale (no cleanup job); the next explicit selection simply overwrites it. This is a deliberate simplicity choice (Principle VII) — the value is never trusted without re-verification, so a lingering stale id in the database has no observable effect.
- Cleared implicitly when the `Session` row itself is deleted (sign-out, expiry) or when the referenced `Community` is deleted (`SetNull`) — no manual cleanup code needed for either case.

## Account / Membership / Community (existing — unchanged)

Referenced, not modified, exactly as spec.md's Key Entities section states:
- `Membership` rows (with their `role` and `operationalEpoch`) are what the selection screen and sidebar switcher enumerate, and what the single "Admin" entry point gates on for the active community.
- `Community.name` is what the sidebar and selection screen display.

## Listing (existing — unchanged)

Referenced, not modified. The main view's feed is `listListings(communityId, ...)`'s existing result shape (`id`, `title`, `priceCents`, `kind`, `ownerId`, `ownerDisplayName`, `coverPhotoId`, `stockQuantity`). This feature adds no field to `Listing`.

## New read shapes (not new entities — service return types)

- **`getReputationSummaries(accountIds: string[])`** (reviewService.ts) → `Map<accountId, { averageRating: number | null; reviewCount: number }>`, one row per input id with no reviews defaulting to `{ averageRating: null, reviewCount: 0 }` — same shape `getReputationSummary()` already returns per-account, batched.
- **Current-membership badge lookup** (inline in the new main-view page, mirroring `profileService.ts`'s established per-file convention) → `Set<accountId>` of owners in the current feed page who are *currently* (epoch-matched) members of the active community.
