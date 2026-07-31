# Research: Purchase Flow with Stock and Dual Transaction History

## #1 Evolve the existing `Transaction` model in place; no second entity

**Decision**: This feature modifies the existing `model Transaction` in `prisma/schema.prisma` (introduced by 010-transaction-logging, migration `20260729010738_add_transaction`) directly: rename `recorderId`/`counterpartId` → `buyerId`/`sellerId`, add `quantity` (Int) and `totalCents` (Int), replace `confirmationState`/`confirmedAt` with `state`/`resolvedAt`, and replace the `TransactionConfirmationState` enum (`UNCONFIRMED`, `CONFIRMED`) with a new `TransactionState` enum (`PENDING`, `ACCEPTED`, `REJECTED`, `CANCELLED`). One Prisma migration; no second model, no `Transaction2`.

**Rationale**: spec.md's "Relationship to Feature 010" section requires exactly one `Transaction` entity before and after this feature, since 012-profiles-reputation already reads from it (FR-029, FR-030). The system is pre-launch (spec.md Assumptions) — there is no production data locking in the old enum values or column names, so a destructive-and-recreate migration (drop `confirmationState`/`TransactionConfirmationState`, add `state`/`TransactionState`) is safe and simpler than an additive, dual-write migration a live system would require.

**Alternatives considered**: Adding `TransactionState` alongside the retired `TransactionConfirmationState` and leaving old columns in place unused — rejected as dead schema with no consumer, against Principle VII, and confusing for the very next reader trying to determine which enum is authoritative. A second `PurchaseProposal` table with a one-way sync into `Transaction` for 012 to keep reading — rejected outright by FR-030: it is exactly the "separate transaction store 012 does not read from" the spec prohibits.

## #2 Field rename: `recorderId`/`counterpartId` → `buyerId`/`sellerId`

**Decision**: The two participant columns are renamed to `buyerId` and `sellerId`, with back-relations on `Account` renamed from `TransactionsRecorded`/`TransactionsAsCounterpart` to `TransactionsAsBuyer`/`TransactionsAsSeller`.

**Rationale**: 010's "recorder"/"counterpart" naming reflected its confirmation model (either party could be the one who *recorded* the claim). This feature's model has a structural asymmetry — one party is always the buyer (proposer), the other always the seller (the listing's owner) — so the old names would be actively misleading (e.g., a "recorder" is no longer a meaningful role once there's no confirmation to record). Every consumer of these columns (`transactionService.ts`, `reviewService.ts`, `profileService.ts`) is being touched anyway by #1's state-machine change, so the rename carries no extra migration cost.

**Alternatives considered**: Keeping `recorderId`/`counterpartId` and just reinterpreting `recorderId` as "whoever proposed" — rejected because "recorder" has no meaning once there is no recording action left (creation is now `propose`, not `record`), and it would leave 012's code reading a column name that no longer describes what it holds.

## #3 Buyer/seller derived from `listingId` directly; no thread lookup

**Decision**: `proposePurchase({ communityId, listingId, buyerAccountId, quantity, totalCents })` looks up the `Listing` directly by `listingId`, sets `sellerId = listing.ownerId`, and requires `listing.communityId === communityId`. There is no `MessageThread` lookup anywhere in the creation path.

**Rationale**: FR-027 explicitly retires 010's thread-derived eligibility (010 research.md #2) — "Buy" is available directly from a listing with no prior message thread. The listing itself is now the sole source of the seller identity and the community, exactly as `createListing`/`updateListing` already treat `Listing.ownerId`/`Listing.communityId` as authoritative.

**Alternatives considered**: Keeping thread-derivation as an optional path alongside direct listing-based creation (for buyers who did message first) — rejected as speculative dual-path complexity (Principle VII) the spec never asks for; FR-027 is an unconditional MUST NOT, not a "may skip if."

## #4 Creation gates: community (ACTIVE), stock, listing status (ACTIVE), self-purchase — in that order

**Decision**: `proposePurchase()` checks, in order: (a) buyer's membership in `communityId`, requiring `ACTIVE` (not `SUSPENDED`/`ARCHIVED`) — a new proposal is growth activity, mirroring 010 research.md #4 and 008's new-thread gate; (b) the listing exists, belongs to `communityId`, and `kind === "FOR_SALE"` (#7 below); (c) `listing.status === "ACTIVE"` (FR-009) — a `PAUSED` listing rejects new proposals; (d) `listing.stockQuantity` is not `null` and `quantity <= listing.stockQuantity` (FR-008, FR-001) — `null` (undeclared stock) and an excessive quantity are both rejected, with a distinct reason each so the client can render "seller hasn't set stock yet" vs. "not enough left"; (e) `buyerAccountId !== listing.ownerId` (FR-010); (f) the seller's own current membership in `communityId` (FR-007's "both parties" requirement, mirroring 010 research.md #3's symmetric check). No proposal is persisted if any gate fails.

**Rationale**: This ordering surfaces the most common rejection (not a member yet, or the listing simply isn't buyable right now) before the more specific stock/self-purchase checks, mirroring `createListing()`'s and `recordTransaction()`'s existing gate-ordering discipline in this codebase.

**Alternatives considered**: Checking stock before listing status — rejected; a `PAUSED` listing should read as "not available to buy right now" (FR-009) regardless of what its stock happens to be, so status is the more fundamental gate.

## #5 Acceptance gates re-verify membership and stock, atomically; status is not re-checked

**Decision**: `acceptProposal()` re-verifies (a) both parties' current membership (community `ACTIVE` or `SUSPENDED` tolerated — see #6) and (b) `quantity <= listing.stockQuantity` at that instant, then performs the stock decrement and state transition inside a single `prisma.$transaction`, using guarded conditional updates:

```text
tx.transaction.updateMany({ where: { id, state: "PENDING" }, data: { state: "ACCEPTED", resolvedAt: now } })
tx.listing.updateMany({ where: { id: listingId, stockQuantity: { gte: quantity } }, data: { stockQuantity: { decrement: quantity } } })
```

Both updates' affected-row counts are checked; if either is `0`, the whole transaction is rolled back and the proposal remains `PENDING` (FR-014's "remain unresolved, not silently marked as anything"). `listing.status` (`ACTIVE`/`PAUSED`) is deliberately **not** re-checked here (FR-009, FR-014 — a pause after submission does not retroactively block acceptance).

**Rationale**: FR-014 requires the re-validated quantity-vs-stock check and the decrement-plus-state-change to happen as one indivisible outcome. The guarded `updateMany` (`WHERE state = 'PENDING'`) mirrors 010's own `confirmTransaction()` idempotency pattern (data-model.md's "Atomicity" section there) exactly; the guarded stock decrement (`WHERE stockQuantity >= quantity`) applies the identical technique to prevent stock from ever going negative. Wrapping both in one `$transaction` turns the spec's narrative assumption ("the seller is the sole serialization point, so there is no concurrency race") into an actual database guarantee, at no additional complexity cost, using a pattern (`prisma.$transaction`) already used nine times elsewhere in this codebase (`communityLifecycleService.ts`, `messageService.ts`, `masterAdministrationService.ts`, `invitationService.ts`) — so correctness does not depend on the UI only ever sending one accept request at a time.

**Alternatives considered**: A single read-then-write (read stock, check in application code, then write) — rejected as a classic TOCTOU race under real concurrent requests (e.g., a double-tap or two browser tabs), which the guarded-`updateMany`-in-a-transaction approach eliminates for the same implementation cost.

## #6 Acceptance/rejection/cancellation tolerate a `SUSPENDED` community; creation does not

**Decision**: `proposePurchase()` requires `ACTIVE` (research.md #4). `acceptProposal()`, `rejectProposal()`, and `cancelProposal()` all use `requireCommunityMembership(..., { allowSuspended: true })`, tolerating `SUSPENDED` (but never `ARCHIVED`, which `requireCommunityMembership` always excludes).

**Rationale**: Directly extends 010 research.md #4's "creation requires ACTIVE; resolving something already underway tolerates SUSPENDED" precedent to a third action (acceptance) and a fourth (rejection/cancellation) the 010 model didn't have. A `PENDING` proposal is exactly the kind of "already-underway activity" 009-platform-administration's suspension model preserves.

**Alternatives considered**: Requiring `ACTIVE` for every action — rejected as inconsistent with the established precedent and needlessly punitive to a buyer/seller pair mid-negotiation when their community is temporarily suspended for unrelated administrative reasons.

## #7 `Buy` applies only to `kind = FOR_SALE` listings

**Decision**: `proposePurchase()` rejects (`reason: "not_for_sale"`) any attempt against a listing where `kind !== "FOR_SALE"`. `stockQuantity` is only meaningful, and only editable, on `FOR_SALE` listings; `WANTED` posts do not gain a stock field.

**Rationale**: 011-wanted-posts already establishes `FULFILLED` as a status reachable only for `kind = WANTED` and explicitly scopes itself to "no change to `FOR_SALE` behavior beyond the shared kind column" (011 spec.md, Input). A "wanted" post is a request, not inventory — there is nothing to decrement stock from. Excluding `WANTED` from the purchase flow is the direct, symmetric counterpart of 011 excluding `FOR_SALE` from `FULFILLED`, not a new concept.

**Alternatives considered**: Allowing a `WANTED` post to be "bought" (interpreted as the wanted-post author agreeing to buy from whoever proposes) — rejected as a materially different transaction shape (roles reversed) that spec.md never describes and that would conflate two independent features' scopes.

## #8 Existing listings migrate `stockQuantity` to `null`, not `0` or an invented positive number

**Decision**: `stockQuantity` is added as `Int?` (nullable), defaulting to `null` for every pre-existing row via the migration's default. `null` renders as "seller hasn't specified stock yet" and blocks any `Buy` attempt (research.md #4d) until the seller sets a value via `updateListing()`.

**Rationale**: Directly implements spec.md's Assumptions section: neither a silent `0` (which would misrepresent every pre-existing `FOR_SALE` listing as sold out) nor an invented positive number (which would fabricate availability no seller declared) is acceptable. `null` is a third, honest state distinct from a seller-declared `0`.

**Alternatives considered**: Defaulting to `0` and relying on sellers to notice and update it — rejected; SC-002/FR-008 would then reject every buyer on every pre-existing listing silently, indistinguishable from a real stock-out, which is a materially worse first-run experience than a distinct "not specified" state that clearly explains itself in the UI.

## #9 Deleting a listing cancels its `PENDING` proposals in the same transaction

**Decision**: `deleteListing()` gains a step, wrapped in `prisma.$transaction`, that first runs `tx.transaction.updateMany({ where: { listingId, state: "PENDING" }, data: { state: "CANCELLED", resolvedAt: now } })`, then `tx.listing.delete(...)`.

**Rationale**: FR-028 requires this transition; because `Transaction.listingId` remains a plain, unconstrained string column with no FK (research.md #10 — the 010 precedent this feature deliberately keeps), deleting the `Listing` row triggers no cascade or restriction on its own, so the cancellation must be performed explicitly. Doing it in the same `$transaction` as the delete avoids a window where the listing is gone but a proposal is still `PENDING` against a nonexistent listing.

**Alternatives considered**: Restricting deletion when `PENDING` proposals exist (forcing the seller to resolve them first) — rejected; it would take away the owner's existing unconditional delete right (005 FR-008), which this feature's spec never asks to restrict, and 010 research.md #1 already established that a required FK with `onDelete: Restrict` is exactly the wrong tool here for the analogous listing/transaction relationship.

## #10 `Transaction.listingId` keeps the no-FK, snapshot pattern from 010

**Decision**: `listingId` (plain string, no relation) and `listingTitle` (creation-time snapshot) are unchanged from 010's shape (010 research.md #1).

**Rationale**: The same reasoning still holds: an `ACCEPTED` transaction must survive its listing's deletion unaltered (FR-028), which a live FK would either block (via the owner's delete right, 005 FR-008) or require `SetNull` for no benefit over a snapshot. `PENDING` proposals' live stock/status checks (research.md #4, #5) still work because they look the listing up by its raw id while it still exists; #9 handles the case where it no longer does.

**Alternatives considered**: None beyond what 010 research.md #1 already evaluated — this decision is inherited unchanged, not re-litigated.

## #11 012-profiles-reputation's read path: same shape, renamed fields and state

**Decision**: `profileService.ts`'s `getProfile()` (its `prisma.transaction.count(...)` call) and `reviewService.ts`'s `createReview()` are updated to query `state: "ACCEPTED"` and `buyerId`/`sellerId` instead of `confirmationState: "CONFIRMED"` and `recorderId`/`counterpartId`. No other change to either function's logic, gate order, or response shape. `reviewService.ts`'s reviewed-account derivation ("whichever of the pair the reviewer is not") is unchanged, just applied to `buyerId`/`sellerId` instead of `recorderId`/`counterpartId`.

**Rationale**: FR-029/FR-030/SC-010 require zero reputation regression. Because #1–#2 keep this a single entity with a like-for-like field/value rename (not a structural change to what a "completed transaction" means for reputation purposes), the update to 012's two read sites is mechanical — same query shape, same semantics, new names. This is the concrete verification FR-029/SC-010 ask the plan to confirm: `grep -n "confirmationState\|recorderId\|counterpartId" src/server/services/profileService.ts src/server/services/reviewService.ts` MUST return no matches once this feature ships, and both services' existing contract tests (`tests/contract/test_profiles.ts`, `tests/contract/test_reviews.ts`) MUST still pass unmodified in their assertions (only their fixture setup, which currently creates `CONFIRMED` transactions via 010's old shape, needs updating to create `ACCEPTED` ones via this feature's new `proposePurchase`/`acceptProposal`).

**Alternatives considered**: Leaving `profileService.ts`/`reviewService.ts` untouched and adding a compatibility view/trigger that keeps `confirmationState`/`recorderId`/`counterpartId` populated as aliases — rejected as exactly the kind of schema-level indirection Principle VII prohibits when a direct two-call code update is just as cheap and far more legible.
