# Data Model: Purchase Flow with Stock and Dual Transaction History

One existing entity gains a field (`Listing.stockQuantity`). One existing entity is evolved in place, not replaced (`Transaction` — research.md #1). No new entity is introduced. `Account`, `Community`, `Membership` are referenced, not modified.

## Listing *(existing, from 005-product-listings — extended)*

| Field | Type | Notes |
| --- | --- | --- |
| `stockQuantity` | `Int?`, nullable | **New.** `null` = seller has not declared stock (research.md #8) — blocks every `Buy` attempt with a distinct reason. When set, MUST be a non-negative integer (`0` permitted, meaning declared-out-of-stock; validated in application code via a new `isValidStockQuantity()`, mirroring `isValidPriceCents()`). Meaningful only for `kind = "FOR_SALE"` (research.md #7); always `null` and ignored for `kind = "WANTED"`. Editable via `updateListing()` like `priceCents`/`title`/`description`, subject to the same ownership + `community_not_active` gates already enforced there. |

Every other existing `Listing` attribute, relationship, and access rule is unchanged.

## Transaction *(existing, from 010-transaction-logging — evolved, not replaced; research.md #1)*

The single record spanning the full propose-to-resolution lifecycle; the same entity 012-profiles-reputation already reads from (spec.md, "Dependency on Feature 012").

| Field | Type | Notes |
| --- | --- | --- |
| `id` | identifier | Primary key. Unchanged. |
| `communityId` | identifier (FK → `Community`) | Unchanged — first-class, denormalized tenancy column (010 research.md #1). |
| `buyerId` | identifier (FK → `Account`) | **Renamed** from `recorderId` (research.md #2). The proposing account; always the buyer, never the listing's owner (FR-010). |
| `sellerId` | identifier (FK → `Account`) | **Renamed** from `counterpartId` (research.md #2). Derived as `listing.ownerId` at creation (research.md #3) — never client-supplied. |
| `listingId` | string, **no relation, no FK constraint** | Unchanged shape (010 research.md #1; research.md #10 here). Snapshot pattern so an `ACCEPTED` row survives listing deletion unaltered (FR-028). |
| `listingTitle` | string | Unchanged — creation-time snapshot. |
| `quantity` | `Int` | **New** (FR-001/FR-008/FR-014, spec Key Entities). Positive integer, fixed at creation; never changed by acceptance/rejection/cancellation. |
| `totalCents` | `Int` | **New.** Self-reported; positive integer; independently editable by the buyer before submission (FR-004), not validated against `listing.priceCents × quantity` (spec Assumptions). Named `totalCents` to match `Listing.priceCents`'s existing cents-integer convention. |
| `paymentPath` | enum `TransactionPaymentPath` | Unchanged (FR-024) — `OFF_PLATFORM` for every row this feature creates; reserved for a future `IN_APP` value (010 research.md #5, unchanged). |
| `state` | enum `TransactionState` | **Replaces** `confirmationState` (`TransactionConfirmationState`). `PENDING` at creation (FR-012); transitions per FR-021's state machine. |
| `createdAt` | timestamp | Unchanged — one of the immutable core facts once `ACCEPTED` (FR-022). |
| `resolvedAt` | timestamp, nullable | **Replaces** `confirmedAt`. Set exactly once, whenever `state` leaves `PENDING` (to `ACCEPTED`, `REJECTED`, or `CANCELLED`) — generalizes `confirmedAt`'s "set once, on the one state change that used to exist" role to all three terminal transitions. Null while `PENDING`. |
| `operationalEpoch` | integer | Unchanged (010 research.md #6) — stamped at creation, never used to filter a `Transaction` out of any view. |

```prisma
enum TransactionState {
  PENDING
  ACCEPTED
  REJECTED
  CANCELLED
}

model Transaction {
  id            String                 @id @default(cuid())
  communityId   String
  buyerId       String
  sellerId      String
  listingId     String
  listingTitle  String
  quantity      Int
  totalCents    Int
  paymentPath   TransactionPaymentPath @default(OFF_PLATFORM)
  state         TransactionState       @default(PENDING)
  createdAt     DateTime               @default(now())
  resolvedAt    DateTime?
  operationalEpoch Int                 @default(1)

  community Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  buyer     Account   @relation("TransactionsAsBuyer", fields: [buyerId], references: [id], onDelete: Cascade)
  seller    Account   @relation("TransactionsAsSeller", fields: [sellerId], references: [id], onDelete: Cascade)
  reviews   Review[]

  @@index([communityId])
  @@index([buyerId])
  @@index([sellerId])
  @@map("transactions")
}
```

`TransactionConfirmationState` is dropped (no code or row references it after this feature ships — pre-launch, no data to preserve, research.md #1). `Review.transaction` keeps its existing `Transaction` relation unchanged; `Review` gains no new field.

**Constraints**: same three indexes as before, renamed to match the new column names (`buyerId`, `sellerId`).

### Creation gates (`proposePurchase({ communityId, listingId, buyerAccountId, quantity, totalCents })` — checked in this order, no row persisted if any fails)

1. `quantity` MUST be a positive integer and `totalCents` MUST be a positive integer — otherwise `invalid_input` (Edge Cases).
2. `buyerAccountId` MUST currently hold `ACTIVE`-community membership in `communityId` (research.md #4a) — otherwise `not_a_member`.
3. `listingId` MUST resolve to an existing `Listing` with `communityId` matching and `kind === "FOR_SALE"` (research.md #7) — otherwise `not_found` (a `WANTED` post reads as not-found for this action, mirroring 011's "reachable only for" pattern rather than a distinct error).
4. `listing.status` MUST be `"ACTIVE"` (FR-009) — otherwise `listing_not_active`.
5. `listing.stockQuantity` MUST NOT be `null` (research.md #8) — otherwise `stock_not_specified`.
6. `quantity` MUST NOT exceed `listing.stockQuantity` (FR-008) — otherwise `exceeds_stock`.
7. `buyerAccountId` MUST NOT equal `listing.ownerId` (FR-010) — otherwise `self_purchase`.
8. `listing.ownerId` (the derived seller) MUST currently hold membership in `communityId` (FR-007, research.md #4f) — otherwise `seller_not_a_member`.

### Acceptance gates (`acceptProposal({ communityId, transactionId, callerAccountId })` — all MUST hold; no state change if any fails)

1. `transactionId` MUST exist with `communityId` matching — otherwise `not_found`.
2. `callerAccountId` MUST equal the transaction's `sellerId` — otherwise `not_a_seller`.
3. The transaction's `state` MUST currently be `PENDING` — otherwise `not_pending` (FR-017; covers double-accept and accept-after-reject/cancel).
4. Both `buyerId` and `sellerId` MUST currently hold membership in `communityId`, `SUSPENDED` tolerated (research.md #6) — otherwise `not_a_member`.
5. The referenced `Listing` MUST still exist (research.md #9 guarantees no `PENDING` row survives its listing's deletion) with `stockQuantity >= quantity` at this instant (FR-014) — otherwise `exceeds_stock`.
6. Gates 3 and 5 are enforced atomically via the guarded `$transaction` in research.md #5 — a race between two accept attempts (or an accept racing a stock edit) can never double-decrement or drive stock negative.

On success: `state → ACCEPTED`, `resolvedAt = now`, `listing.stockQuantity -= quantity`, in one `$transaction` (research.md #5).

### Rejection gates (`rejectProposal({ communityId, transactionId, callerAccountId })`)

1–4. Same as acceptance gates 1–4.
5. `state → REJECTED`, `resolvedAt = now` via a single guarded `updateMany` (`WHERE state = 'PENDING'`) — no stock change, no history record (FR-016).

### Cancellation gates (`cancelProposal({ communityId, transactionId, callerAccountId })`)

1. `transactionId` MUST exist with `communityId` matching — otherwise `not_found`.
2. `callerAccountId` MUST equal the transaction's `buyerId` — otherwise `not_a_buyer`.
3. The transaction's `state` MUST currently be `PENDING` — otherwise `not_pending` (FR-019).
4. `callerAccountId` MUST currently hold membership in `communityId`, `SUSPENDED` tolerated (research.md #6) — otherwise `not_a_member`.
5. `state → CANCELLED`, `resolvedAt = now` via a guarded `updateMany`.

### Listing-deletion interaction (`deleteListing()`, extended — research.md #9)

Within the same `$transaction` as the existing delete: `updateMany({ where: { listingId, state: "PENDING" }, data: { state: "CANCELLED", resolvedAt: now } })` runs first, then the `Listing` row is deleted. Any `ACCEPTED`/`REJECTED`/`CANCELLED` row referencing that `listingId` is untouched either way (FR-028) — they were never filtered by this `updateMany`'s `state: "PENDING"` clause, and there is no FK to cascade against them.

## Access rules (not stored — evaluated per request)

| Actor | View a transaction? | Create (propose)? | Accept/Reject? | Cancel? |
| --- | --- | --- | --- | --- |
| The transaction's `buyerId` | Yes, iff currently a member of `communityId` | N/A (already created it) | No | Yes, iff `PENDING` and currently a member (`SUSPENDED` tolerated) |
| The transaction's `sellerId` | Yes, iff currently a member of `communityId` | No — cannot buy their own listing (FR-010) | Yes, iff `PENDING`, stock sufficient, both currently members (`SUSPENDED` tolerated) | No |
| A co-member with no relation to this transaction | No | Yes, against any other member's `FOR_SALE`, `ACTIVE`-status listing with declared stock covering the requested quantity | No | No |
| Any other account, including a community administrator | No | No | No | No |

Membership, stock, and listing status are all checked live at the moment of each request — never cached from an earlier step (research.md #4, #5, #6).

## Purchase history / sales history (read views, not stored separately)

Both are the same `listTransactions()`-style query filtered to `state = "ACCEPTED"`, with `role` computed per row (`"buyer"` if `callerAccountId === buyerId`, else `"seller"`) — one query, two labels, matching spec.md's "two owner-scoped views of one underlying record" (Key Entities). A caller's full proposal list (FR-020, any state) is the same query without the `state` filter.

## Prisma migration shape

This is the schema's final end state: add `Listing.stockQuantity Int?`; add enum `TransactionState`; add `Transaction.quantity Int`, `Transaction.totalCents Int`, `Transaction.state TransactionState @default(PENDING)`, `Transaction.resolvedAt DateTime?`; rename `recorderId → buyerId`, `counterpartId → sellerId` (and their back-relations); drop `confirmationState`, `confirmedAt`, and enum `TransactionConfirmationState`. Since this is pre-launch (spec.md Assumptions), any existing `transactions` rows in a dev/test database are dropped and recreated rather than backfilled — there is no production data requiring a value for the new required `quantity`/`totalCents` columns.

**Sequencing**: tasks.md reaches this end state via two physical migrations (an additive **expand** step, then a destructive **contract** step once 010's `recordTransaction()`/`confirmTransaction()` have no remaining callers — tasks.md T001 and T019), not one migration, so that 010's functions keep compiling and 012-profiles-reputation's fixtures can be rebuilt on this feature's own flow before the old columns/enum disappear. Data-wise this is equivalent to a single migration; it is purely a task-ordering device to satisfy Constitution Principle VIII's test-first discipline per new function.

## Atomicity

Creating a proposal is a single-row insert (like 010's `recordTransaction()`). Accepting one is the guarded two-statement `$transaction` in research.md #5. Rejecting or cancelling one is a single guarded `updateMany` (like 010's `confirmTransaction()`). Deleting a listing with pending proposals is a two-statement `$transaction` (research.md #9). No step in any of these requires a table lock beyond what the guarded `WHERE` clauses and Postgres's default read-committed row-level locking on `UPDATE` already provide.
