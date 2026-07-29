# Data Model: Transaction Logging

One new entity. No existing entity gains a new field (`Listing`, `MessageThread`, `Account`, `Community`, `Membership` are referenced, not modified — spec.md Key Entities).

## Transaction *(new)*

A permanent, traceable record that a transaction occurred between two co-members against a specific listing (FR-001, FR-008). This is the "source of truth" Constitution Principle IV names.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | identifier | Primary key |
| `communityId` | identifier (FK → `Community`) | First-class, denormalized column (research.md #1) — never inferred by joining through a deletable `Listing`. The tenancy boundary checked by every access rule below. |
| `recorderId` | identifier (FK → `Account`) | The account that created this log. Real relation — `Account` rows are never hard-deleted (009-platform-administration: soft-delete via `deletedAt`). |
| `counterpartId` | identifier (FK → `Account`) | The other party, derived from the source thread at creation (research.md #2) — never client-supplied. |
| `listingId` | string, **no relation, no FK constraint** | The listing this log is about, snapshotted (research.md #1) so deleting the listing (FR-017) cannot cascade or be blocked. May no longer resolve to a live `Listing` row. |
| `listingTitle` | string | Snapshot of the listing's title at creation time, so the log remains meaningful even after `listingId` no longer resolves. Immutable once written (FR-007). |
| `paymentPath` | enum `TransactionPaymentPath` | `OFF_PLATFORM` for every log this feature creates (FR-009, research.md #5). |
| `confirmationState` | enum `TransactionConfirmationState` | `UNCONFIRMED` at creation (FR-004); becomes `CONFIRMED` only via `confirmTransaction()` (FR-005). |
| `createdAt` | timestamp | Log creation time — one of the immutable core facts (FR-007). |
| `confirmedAt` | timestamp, nullable | Set exactly once, when `confirmationState` transitions to `CONFIRMED`. Null while `UNCONFIRMED`. |
| `operationalEpoch` | integer | Stamped from the community's current `operationalEpoch` at creation (009-platform-administration convention). Historical marker only — **never** used to filter a `Transaction` out of any view (research.md #6, a deliberate divergence from `Listing`/`MessageThread`/`Membership`/`Invitation`). |

**Constraints**:

- `@@index([communityId])` — supports the per-community list view.
- `@@index([recorderId])`, `@@index([counterpartId])` — supports "logs I'm a party to" lookups from either side.

**Lifecycle**: Created `UNCONFIRMED` by `recordTransaction()`. Transitions exactly once, to `CONFIRMED`, via `confirmTransaction()` — there is no other state and no path back to `UNCONFIRMED`. Never deleted or altered by any user action; retained permanently regardless of later listing deletion (FR-017), thread deletion, or community suspension/restoration (research.md #6).

**Creation gates** (`recordTransaction(threadId, recorderAccountId)` — all MUST hold, checked in this order, no row persisted if any fails):

1. `threadId` MUST resolve to an existing `MessageThread` whose `operationalEpoch` matches its listing's community's *current* `operationalEpoch` (mirrors `sendThreadMessage()`'s own check) — otherwise `not_found`.
2. `recorderAccountId` MUST be either that thread's `buyerId` or that thread's listing's `ownerId` — otherwise `not_a_participant`. The counterpart is the other one of that pair (research.md #2).
3. The community (the thread's listing's `communityId`) MUST be `ACTIVE` (research.md #4) — otherwise `community_not_active`.
4. Both `recorderAccountId` and the derived `counterpartId` MUST currently hold membership in that community (FR-002) — `recorderAccountId` failing this yields `not_a_member`; the derived `counterpartId` failing it yields the distinct `counterpart_not_a_member` (the two map to different HTTP statuses — see contracts/transactions-api.md).
5. `recorderAccountId` MUST NOT equal the derived `counterpartId` (FR-013) — structurally impossible given step 2's derivation (the counterpart is defined as "whichever of the pair is not the recorder"), so this is a consequence of the derivation, not a separate runtime branch.

**Confirmation gates** (`confirmTransaction(transactionId, callerAccountId)` — all MUST hold, no state change if any fails):

1. `transactionId` MUST exist — otherwise `not_found`.
2. `callerAccountId` MUST equal that transaction's `counterpartId` — otherwise `not_a_counterpart` (FR-005; the recorder cannot confirm their own log, and no third party can confirm on the counterpart's behalf).
3. `callerAccountId` (and, transitively, the already-verified `recorderId`) MUST currently hold membership in the transaction's `communityId`, tolerating a `SUSPENDED` community (FR-003, research.md #4) — otherwise `not_a_member`.
4. The transaction's `confirmationState` MUST currently be `UNCONFIRMED` — confirming an already-`CONFIRMED` transaction is a no-op that returns the existing state rather than erroring (mirrors 005's own idempotent pause/reactivate precedent), never a second `confirmedAt` write.

## Access rules (not stored — evaluated per request)

| Actor | Can view a log? | Can create one on a given thread? | Can confirm it? |
| --- | --- | --- | --- |
| The log's `recorderId` | Yes, iff currently a member of `communityId` | N/A (already created it) | No — cannot confirm their own log |
| The log's `counterpartId` | Yes, iff currently a member of `communityId` | N/A (would become the *counterpart* of a new log, not its recorder, if they act on the same thread) | Yes, iff currently a member of `communityId` (SUSPENDED tolerated) — the only account that can |
| Either thread participant, before any log exists on that thread | N/A | Yes, iff a current member of an `ACTIVE` community (both sides) and the thread is current-epoch | N/A |
| Any other account, including a community administrator | No | No | No |

Membership is checked per-actor (and, at creation, per-pair — research.md #3) at the moment of the request, never cached from thread- or log-creation time.

## Prisma schema changes

One new model, two new enums, plus back-relations on the existing `Account` and `Community` models. No change to any existing column.

```prisma
/// 010-transaction-logging, research.md #5: single value today; a future
/// in-app-payment feature adds IN_APP as a purely additive migration.
enum TransactionPaymentPath {
  OFF_PLATFORM
}

/// 010-transaction-logging, FR-004/FR-005: closed set, never a bare boolean —
/// mirrors ListingStatus's own rationale (005-product-listings).
enum TransactionConfirmationState {
  UNCONFIRMED
  CONFIRMED
}

/// A permanent, traceable record that a transaction occurred between two
/// co-members against a specific listing (010-transaction-logging,
/// Constitution Principle IV). No relation to Listing or MessageThread —
/// see research.md #1; listingId/listingTitle are an unconstrained snapshot
/// so the log survives listing deletion unaltered (FR-017).
model Transaction {
  id                String                       @id @default(cuid())
  communityId       String
  recorderId        String
  counterpartId     String
  listingId         String
  listingTitle      String
  paymentPath       TransactionPaymentPath        @default(OFF_PLATFORM)
  confirmationState TransactionConfirmationState  @default(UNCONFIRMED)
  createdAt         DateTime                      @default(now())
  confirmedAt        DateTime?
  /// research.md #6: stamped for consistency with every other per-community
  /// row; deliberately never used to filter this model out of any view.
  operationalEpoch   Int                           @default(1)

  community  Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  recorder   Account   @relation("TransactionsRecorded", fields: [recorderId], references: [id], onDelete: Cascade)
  counterpart Account  @relation("TransactionsAsCounterpart", fields: [counterpartId], references: [id], onDelete: Cascade)

  @@index([communityId])
  @@index([recorderId])
  @@index([counterpartId])
  @@map("transactions")
}
```

*Note*: `onDelete: Cascade` on `communityId`/`recorderId`/`counterpartId` is Prisma's required-relation default and is never actually exercised in practice — `Community` rows are archived, never deleted, and `Account` rows are soft-deleted (`deletedAt`), never hard-deleted (research.md #1, Technical Context). It is declared only because Prisma requires an explicit `onDelete` action on a required relation; it does not represent an expected code path.

## Atomicity

Creating a `Transaction` is a single-row insert — no `$transaction` needed; there is nothing else to keep in sync (unlike 008's thread-plus-first-message pair). Confirming a `Transaction` is a single-row update (`confirmationState` + `confirmedAt`), guarded by a `WHERE confirmationState = 'UNCONFIRMED'` clause so the idempotent no-op case (gate 4 above) and a genuine first confirmation are distinguished by the update's own affected-row count rather than a separate read-then-write race.
