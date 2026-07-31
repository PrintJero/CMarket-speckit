# Feature Specification: Purchase Flow with Stock and Dual Transaction History

**Feature Branch**: `013-purchase-flow-stock`

**Created**: 2026-07-30

**Status**: Draft

**Input**: User description: "Purchase Flow with Stock and Dual Transaction History: This feature replaces the earlier abstract \"transaction logging\" draft (010) with the concrete purchase flow the product actually needs. CMarket is a marketplace for sellers with inventory (not one-off used items). Listings therefore carry a stock quantity, and buyers purchase quantities from that stock through a two-sided proposal-and-acceptance flow that produces a traceable record for both parties. Buyer taps Buy, a proposal opens pre-filled with quantity and total, buyer may adjust both; system validates same-community membership and quantity against stock, creates the proposal PENDING; seller sees buyer name, quantity, total and can Accept (re-validates stock, decrements it, writes buyer PURCHASE HISTORY and seller SALES HISTORY, marks ACCEPTED) or Reject (marks REJECTED, touches nothing); buyer can cancel a PENDING proposal (CANCELLED). No payment-method step; payment is off-platform and CMarket's non-intermediary role must be disclosed. No message-thread prerequisite to buy. Critical flow per Principle VIII: cross-community rejection, stock validation at creation and acceptance, state-machine integrity, ACCEPTED-record immutability, and non-exposure of contact data must have tests written first, failing first, blocking merge in CI."

## Relationship to Feature 010

**010-transaction-logging is implemented and in production use; this is not a green-field feature.** This feature does not introduce a second, parallel transaction concept. It **evolves the existing `Transaction` entity from 010-transaction-logging in place** — there is exactly one `Transaction` entity in the system both before and after this feature ships. No second entity, table, or renamed duplicate (e.g. a "Transaction2") is introduced; that would defeat the entire point of a single, traceable transaction concept.

**What carries over unchanged:** the entity's role as the platform's single traceable, immutable record of a completed transaction (Constitution Principle IV); its persistence independent of the listing it references (FR-028); its `payment path` attribute (`off-platform` for this feature, reserved for a future `in-app` value, FR-024).

**What this feature adds to the existing entity:** a `quantity`, a self-reported `total`, a link to the listing's stock it draws down, and the new proposal/acceptance state machine (`PENDING` → `ACCEPTED` | `REJECTED` | `CANCELLED`) — none of which 010 had, since 010 had no concept of quantity or inventory.

**What this feature retires from the entity's prior behavior:** 010's two-sided **confirmation** model (`UNCONFIRMED` → `CONFIRMED`, the counterpart explicitly confirming something that already happened off-platform) and its **message-thread prerequisite** (a log could only be created between parties with an existing 008 message thread on that listing). Both are replaced outright by this feature's proposal-and-acceptance model, gated on live community membership and stock instead (see Clarifications and FR-027).

Evolving the schema in place — rather than standing up a second table — is the only model consistent with there being one `Transaction` concept. Implementation-level migration mechanics (how the schema change and the flow cutover are applied) are addressed in this feature's plan, not here.

## Dependency on Feature 012 (Profiles & Reputation)

**012-profiles-reputation is implemented and already reads from the same `Transaction` entity this feature evolves.** A profile's confirmed-transaction count and a member's eligibility to leave a review are both derived today from `Transaction` rows where `confirmationState` is `CONFIRMED` (012 FR-009 and related). Because this feature changes the very entity 012 depends on, reputation MUST NOT silently break, freeze, or go stale as a side effect.

- Verified reputation MUST continue to be derived from this feature's `Transaction` records after this feature ships. The `ACCEPTED` state is this entity's replacement for 010's `CONFIRMED` state in that role — it is what MUST count as a completed, verifiable transaction for reputation purposes going forward.
- This feature MUST NOT create a separate transaction store, table, or entity that 012 does not read from. Reputation reads (012) and purchase writes (this feature) MUST target the same entity — a parallel, unread store would freeze every profile's reputation numbers while real purchases silently flow into a table 012 never queries.
- This feature's plan MUST verify 012's current read path (its queries and field references against the `Transaction` entity, e.g. `confirmationState`, participant fields) against the entity's evolved shape and state machine, and MUST confirm no reputation regression before implementation is considered complete.

## Clarifications

### Session 2026-07-30

- Q: The spec didn't address listing status (`ACTIVE`/`PAUSED`, from 005) — should a `PAUSED` listing restrict the purchase flow? → A: Block creation only. A buyer cannot submit a new proposal against a `PAUSED` listing. A proposal that was already `PENDING` when the seller paused the listing can still be accepted normally — pausing does not retroactively invalidate a deal already in flight, mirroring 005's existing "PAUSED hides from active discovery" semantics rather than introducing a new kill-switch behavior.
- Q: FR-001 didn't state a valid range for stock quantity — should it be constrained? → A: Non-negative integers only. Stock must be a whole number ≥ 0; the system rejects any attempt to set or edit it to a negative or non-integer value. `0` is a valid, non-error state — the listing stays `ACTIVE` and browsable, it simply cannot accept any positive-quantity proposal until restocked.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Buyer proposes a purchase (Priority: P1)

A buyer browsing a listing wants to buy some quantity of it. They tap "Buy," see a proposal pre-filled with quantity 1 and the total at the listing's price, optionally increase the quantity or edit the total (e.g., a price was negotiated in chat), and submit it. The seller receives it as a pending proposal.

**Why this priority**: Without this, nothing else in the feature has anything to act on — this is the entry point of the entire flow.

**Independent Test**: Can be fully tested by having a buyer who is a co-member of the listing's community tap "Buy," adjust quantity/total, and submit; then asserting a proposal now exists in the `PENDING` state naming the buyer, the seller, the listing, the community, the requested quantity, and the total, and that the listing's stock is unchanged.

**Acceptance Scenarios**:

1. **Given** a listing with stock 10 in community C owned by seller S, **When** a co-member buyer B taps "Buy" and submits the default proposal (quantity 1, total = price × 1), **Then** a new proposal is created in the `PENDING` state naming B, S, the listing, community C, quantity 1, and that total, and the listing's stock remains 10.
2. **Given** the same listing, **When** buyer B increases the quantity to 3 before submitting, **Then** the pre-filled total recalculates to price × 3, and B may still edit that total to a different self-reported value before submitting.
3. **Given** the same listing with stock 10, **When** buyer B requests quantity 11, **Then** the proposal is rejected at submission and no proposal is created.
4. **Given** the proposal screen, **When** it is shown to the buyer, **Then** no payment-method selection step is presented anywhere in the flow.
5. **Given** a listing whose status is `PAUSED`, **When** a co-member buyer attempts to submit a purchase proposal against it, **Then** the attempt is rejected and no proposal is created.

---

### User Story 2 - Seller resolves a pending proposal (Priority: P1)

The seller reviews a pending proposal — buyer's name, quantity, and total — and either accepts it (closing the deal and recording it) or rejects it (declining, with no side effects).

**Why this priority**: This is where the transaction actually becomes real (or doesn't). Accepting is the single action that produces the durable, traceable record both parties rely on; without it the feature has no outcome.

**Independent Test**: Can be fully tested two ways — (a) have the seller accept a pending proposal and assert the listing's stock decreased by exactly the confirmed quantity, a record now appears in the buyer's purchase history and the seller's sales history, and the proposal is `ACCEPTED`; (b) have the seller reject a pending proposal and assert the listing's stock is unchanged, no history record exists, and the proposal is `REJECTED`.

**Acceptance Scenarios**:

1. **Given** a `PENDING` proposal for quantity 3 against a listing with current stock 10, **When** the seller accepts it, **Then** the listing's stock becomes 7, a record naming the buyer, seller, listing, community, quantity 3, the total, payment path "off-platform," and a timestamp appears in the buyer's purchase history and the seller's sales history, and the proposal becomes `ACCEPTED`.
2. **Given** the same `PENDING` proposal, **When** the seller rejects it instead, **Then** the listing's stock is unchanged, no history record is created for either party, and the proposal becomes `REJECTED`.
3. **Given** a listing with current stock 2, and two independent `PENDING` proposals each requesting quantity 2 from different buyers, **When** the seller accepts the first, **Then** stock becomes 0; **When** the seller then attempts to accept the second, **Then** it is rejected because it now exceeds the current stock, and the seller must reject it instead.
4. **Given** an `ACCEPTED` proposal, **When** anyone attempts to change its buyer, seller, listing, community, quantity, total, payment path, or timestamp, **Then** the attempt is rejected — an accepted record is immutable.
5. **Given** a proposal that is already `ACCEPTED`, `REJECTED`, or `CANCELLED`, **When** the seller attempts to accept or reject it again, **Then** the attempt is rejected — a resolved proposal cannot be resolved twice.
6. **Given** a `PENDING` proposal whose listing the seller paused after the proposal was submitted, **When** the seller accepts it, **Then** the acceptance proceeds normally (stock decrements, histories are written, the proposal becomes `ACCEPTED`) — pausing a listing does not retroactively invalidate a proposal already in flight.

---

### User Story 3 - Cross-community and stock-integrity rejections (Priority: P1)

A proposal can never be created or accepted across a community boundary, and can never result in stock going negative, regardless of how many proposals exist concurrently.

**Why this priority**: This is the same community boundary that governs every other part of CMarket (Constitution Principle II), combined with the basic data-integrity guarantee (stock can't go negative) that the whole seller-inventory model depends on. Both are named, required, blocking tests under Principle VIII.

**Independent Test**: Can be fully tested by (a) having two accounts that are not co-members of the listing's community attempt to create or accept a proposal and asserting rejection; (b) having a proposal's quantity exceed current stock at creation time and asserting rejection; (c) having stock drop below a pending proposal's quantity before the seller acts on it and asserting the acceptance is rejected at that later instant.

**Acceptance Scenarios**:

1. **Given** a buyer who is not a member of the listing's community, **When** they attempt to submit a purchase proposal against that listing, **Then** the attempt is rejected and no proposal is created.
2. **Given** a proposal created while both parties were co-members, **When** either party's membership in that community lapses before the seller resolves it, **Then** the seller's attempt to accept it is rejected — current co-membership is re-verified at acceptance time, not assumed from when the proposal was created.
3. **Given** a listing with stock 5, **When** a buyer requests quantity 6, **Then** the proposal is rejected at creation and no proposal exists.
4. **Given** a `PENDING` proposal for quantity 4 against a listing whose stock the seller has since edited down to 3, **When** the seller attempts to accept it, **Then** the acceptance is rejected because it exceeds the current stock — the seller must reject it or ask the buyer to submit a smaller proposal.
5. **Given** a buyer viewing their own listing, **When** they attempt to submit a purchase proposal against it, **Then** the attempt is rejected — a buyer and seller on the same proposal must be distinct accounts.

---

### User Story 4 - Buyer tracks and cancels a pending proposal (Priority: P2)

The buyer can see the current state of every proposal they've made at any time, and can cancel one that is still pending if the seller hasn't responded.

**Why this priority**: Without this, a buyer has no visibility into their own request and no way to withdraw it, leaving them stuck waiting indefinitely on a seller who may never respond. It matters for usability but the core transaction mechanics (Stories 1–3) are meaningful without it.

**Independent Test**: Can be fully tested by having a buyer view a list of their proposals and see each one's current state, then cancel a `PENDING` one and assert it becomes `CANCELLED` and is no longer actionable by the seller.

**Acceptance Scenarios**:

1. **Given** a buyer with proposals in various states, **When** they view their proposals, **Then** each one clearly shows whether it is `PENDING`, `ACCEPTED`, `REJECTED`, or `CANCELLED`.
2. **Given** a `PENDING` proposal, **When** the buyer cancels it, **Then** it becomes `CANCELLED`, the listing's stock is unchanged, and the seller can no longer accept or reject it.
3. **Given** a proposal that is `ACCEPTED`, `REJECTED`, or already `CANCELLED`, **When** the buyer attempts to cancel it, **Then** the attempt is rejected — only a `PENDING` proposal can be cancelled.
4. **Given** a proposal the seller has already accepted, **When** the buyer views it, **Then** they see it as `ACCEPTED`, never as still `PENDING`.

---

### User Story 5 - Both parties view their own transaction history without contact exposure (Priority: P2)

The buyer can review everything they've purchased; the seller can review everything they've sold. Neither view exposes the other party's contact details.

**Why this priority**: This is the traceability payoff the whole feature exists to produce (Constitution Principle IV) and the point where a contact-data leak would be easiest to introduce by accident, since names are shown. It ranks below the core proposal mechanics because the underlying records already exist once Stories 1–2 work; this is "make them visible correctly."

**Independent Test**: Can be fully tested by having an accepted transaction appear in the buyer's purchase history and the seller's sales history, and asserting neither view — nor any other step of the flow — renders either party's phone number, email address, or exact address.

**Acceptance Scenarios**:

1. **Given** an `ACCEPTED` transaction between buyer B and seller S, **When** B views their purchase history, **Then** the record appears there identifying S, the listing, quantity, total, payment path, timestamp, and state.
2. **Given** the same transaction, **When** S views their sales history, **Then** the record appears there identifying B, the listing, quantity, total, payment path, timestamp, and state.
3. **Given** any screen in the proposal flow or either history, **When** it is rendered, **Then** it displays the counterpart's name but never their phone number, email address, or exact address.
4. **Given** buyer B's purchase history, **When** any account other than B attempts to view it, **Then** the attempt is rejected; the same holds for seller S's sales history and any account other than S.

---

### User Story 6 - The non-intermediary disclosure is always shown (Priority: P3)

Before submitting a purchase proposal, the buyer sees a clear statement that CMarket does not process, hold, or guarantee the payment.

**Why this priority**: This is a required disclosure (Constitution Principle IV) protecting both the platform and its members from misunderstanding what CMarket does. It matters from first release but the transaction mechanics remain meaningful (if non-compliant) without it, so it ranks last.

**Independent Test**: Can be fully tested by opening the "Buy" proposal screen and asserting the non-intermediary disclosure is visibly present before the proposal can be submitted.

**Acceptance Scenarios**:

1. **Given** a buyer about to submit a purchase proposal, **When** the proposal screen is shown, **Then** it explicitly states that CMarket does not process, hold, or guarantee the payment, and that payment happens off-platform between the parties.

---

### Edge Cases

- What happens when a buyer requests a quantity of 0 or a negative number? Rejected — quantity must be a positive integer.
- What happens when a buyer edits the total to 0 or a negative number? Rejected — total must be a positive value; it is self-reported but not meaningless.
- What happens when the seller edits the listing's stock or price while a proposal is `PENDING`? The proposal's own quantity and total are unaffected (they were fixed at submission); only stock is re-checked live at acceptance, per Story 3.
- What happens when a listing is deleted while it has `PENDING` proposals against it? Those proposals are automatically transitioned to `CANCELLED` (there is nothing left to fulfill); any already-`ACCEPTED` transaction referencing that listing is retained unchanged — deleting a listing never deletes or alters a historical transaction record that references it (FR-028).
- What happens when the same buyer submits multiple simultaneous `PENDING` proposals against the same listing? Allowed — each is independent and the seller resolves them one at a time, per Story 2's serialization.
- What happens if a proposal's total doesn't match listing price × quantity because the buyer edited it? Allowed by design — the total is self-reported to accommodate a price negotiated off-platform; the system does not validate it against the listing price.
- What happens when a seller with no remaining stock is viewed by a buyer? The buyer can still open the listing, but a "Buy" attempt requesting any positive quantity is rejected since it exceeds the currently shown stock of 0.
- What happens when a buyer attempts to submit a proposal against a `PAUSED` listing? Rejected at submission (FR-009); a `PAUSED` listing already doesn't appear in discovery (005/007), and this closes the remaining gap of a buyer reaching it directly (e.g., a bookmarked or previously-open link).
- What happens when a listing is paused after a proposal against it is already `PENDING`? The pending proposal is unaffected — the seller can still accept or reject it normally; pausing only blocks *new* proposals from being submitted (FR-009, FR-014).
- What happens when a seller attempts to set or edit a listing's stock to a negative number, or a non-whole number? Rejected — stock MUST be a non-negative integer (FR-001); the field remains at its last valid value.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every listing MUST carry a seller-declared stock quantity, represented as a non-negative integer (zero permitted), set by the seller at listing creation and editable afterward like any other listing field; the system MUST reject any attempt to set or edit stock to a negative or non-integer value.
- **FR-002**: The system MUST present stock to buyers as a seller-reported figure (e.g., "seller indicates N available"), not as a system-verified guarantee.
- **FR-003**: The system MUST let a co-member buyer open a purchase proposal against a listing, pre-filled with quantity 1 and a total equal to the listing's price times quantity.
- **FR-004**: The buyer MUST be able to increase the proposal's quantity before submission, with the total recalculating accordingly, and MUST be able to independently edit the total to a different self-reported value.
- **FR-005**: The purchase proposal flow MUST NOT include any payment-method selection step.
- **FR-006**: The purchase proposal screen MUST explicitly state, before submission, that CMarket does not process, hold, or guarantee the payment and that payment occurs off-platform between the parties.
- **FR-007**: At submission, the system MUST verify that the buyer and the listing's seller currently hold membership in the same community as the listing; otherwise it MUST reject the proposal and create nothing.
- **FR-008**: At submission, the system MUST verify that the requested quantity does not exceed the listing's currently shown stock; otherwise it MUST reject the proposal and create nothing.
- **FR-009**: At submission, the system MUST verify that the listing's status is `ACTIVE`; a submission against a `PAUSED` listing MUST be rejected and no proposal created. This check applies only at submission — a proposal already `PENDING` when the listing is subsequently paused is unaffected and remains normally acceptable (see FR-014).
- **FR-010**: A submission naming the same account as both buyer and seller MUST be rejected.
- **FR-011**: A rejected or invalid submission MUST NOT create a proposal and MUST NOT alter the listing's stock.
- **FR-012**: A successfully created proposal MUST start in the `PENDING` state and MUST NOT decrement the listing's stock.
- **FR-013**: The seller MUST be able to view a `PENDING` proposal's buyer name, quantity, and total, and take exactly one of two actions: accept or reject.
- **FR-014**: On acceptance, the system MUST re-verify both parties' current community co-membership and MUST re-verify that the proposal's quantity does not exceed the listing's current stock at that instant; if either check fails, the acceptance MUST be rejected and the proposal MUST remain unresolved (not silently marked as anything). The listing's `ACTIVE`/`PAUSED` status MUST NOT be re-checked at acceptance — only at submission (FR-009).
- **FR-015**: On successful acceptance, the system MUST, as a single outcome: decrement the listing's stock by the proposal's quantity, create a transaction record visible in the buyer's purchase history and the seller's sales history, and mark the proposal `ACCEPTED`.
- **FR-016**: On rejection, the system MUST mark the proposal `REJECTED` and MUST NOT alter the listing's stock or create any history record.
- **FR-017**: A proposal MUST only be resolved (accepted or rejected) exactly once; an attempt to resolve a proposal that is not currently `PENDING` MUST be rejected.
- **FR-018**: While a proposal is `PENDING`, the buyer MUST be able to cancel it, transitioning it to `CANCELLED`, with no effect on the listing's stock and no history record created.
- **FR-019**: An attempt to cancel a proposal that is not currently `PENDING` MUST be rejected.
- **FR-020**: The buyer MUST be able to see the current state (`PENDING`, `ACCEPTED`, `REJECTED`, or `CANCELLED`) of every proposal they have created, at any time.
- **FR-021**: A proposal's state MUST transition only as follows: `PENDING` → `ACCEPTED` (seller accepts), `PENDING` → `REJECTED` (seller rejects), or `PENDING` → `CANCELLED` (buyer cancels); no other transition is permitted, and none of the three terminal states may transition further.
- **FR-022**: An `ACCEPTED` transaction record's core facts — buyer, seller, listing, community, quantity, total, payment path, and timestamp — MUST NOT be editable by either party, or by anyone, after acceptance.
- **FR-023**: Every transaction record MUST capture, at minimum: the buyer, the seller, the listing, the community, the quantity, the total, a payment path, a timestamp, and the final state.
- **FR-024**: Every transaction record's payment path MUST be recorded as "off-platform" for every transaction created through this feature's flow; this attribute is carried over unchanged from the entity's existing (010) shape, and MUST continue to allow a future in-app payment path to populate the same fields with payment path = "in-app" without redesign.
- **FR-025**: A buyer's purchase history MUST be visible only to that buyer, and a seller's sales history MUST be visible only to that seller; no other account may view either.
- **FR-026**: Neither the proposal flow, the acceptance/rejection flow, nor either history view MUST expose either party's phone number, email address, or exact address; a proposal or an accepted transaction is not itself agreement to share contact data (Constitution Principle VI).
- **FR-027**: Creating or accepting a purchase proposal MUST NOT require an existing message thread between the buyer and seller on that listing.
- **FR-028**: Deleting a listing that has `PENDING` proposals against it MUST transition those proposals to `CANCELLED` and MUST NOT delete or alter any `ACCEPTED` transaction already referencing that listing.
- **FR-029**: 012-profiles-reputation's confirmed-transaction count and review-eligibility logic MUST continue to be derivable from this entity after this feature ships; `ACCEPTED` MUST serve as the completed/verifiable state for reputation purposes, replacing 010's `CONFIRMED` state in that role.
- **FR-030**: This feature MUST NOT introduce a second transaction store, table, or entity separate from the one 012-profiles-reputation reads from; all purchase-flow writes (this feature) and all reputation reads (012) MUST target the same `Transaction` entity.

### Key Entities

- **Listing** *(existing, from 005-product-listings — extended by this feature)*: Gains a seller-declared stock quantity attribute, set at creation and editable afterward. All other existing attributes (title, description, price, status, owner, community) are unchanged.
- **Transaction** *(existing, from 010-transaction-logging — evolved by this feature, not replaced)*: The single record spanning the full proposal-to-resolution lifecycle; this is the same entity 010 introduced and 012-profiles-reputation already reads from, not a new or parallel one. References exactly one buyer account, one seller account, one listing, one community, a quantity, a self-reported total, a payment path (`off-platform` for this feature; reserved for a future `in-app` value), a creation timestamp, and a state (`PENDING`, `ACCEPTED`, `REJECTED`, or `CANCELLED` — replacing 010's `UNCONFIRMED`/`CONFIRMED` state). Immutable in its core facts once `ACCEPTED`. The same record is what the buyer sees in their purchase history and the seller sees in their sales history once it reaches `ACCEPTED` — these are two owner-scoped views of one underlying record, not two separately written copies — and it is what 012 reads to derive confirmed-transaction counts and review eligibility (FR-029, FR-030).
- **Account** *(existing, from 002-accounts-authentication — referenced, not modified)*: The identity acting as buyer or seller.
- **Community** *(existing, from 003-community-creation — referenced, not modified)*: The tenancy boundary a proposal and its resulting transaction must stay within.
- **Membership** *(existing, from 003/004 — referenced, not modified)*: Checked live at proposal creation and again at acceptance to verify current co-membership.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of attempts to create or accept a proposal between two accounts that do not currently share a community membership are rejected, verified by automated tests.
- **SC-002**: 100% of attempts to create a proposal, or accept one, for a quantity exceeding the listing's current stock at that instant are rejected, verified by automated tests.
- **SC-003**: 100% of `REJECTED` or `CANCELLED` proposals result in zero change to the listing's stock and zero history records created, verified by automated tests.
- **SC-004**: 100% of attempts to modify any core field of an `ACCEPTED` transaction are rejected, verified by automated tests.
- **SC-005**: 0% of purchase-flow screens or history views render either party's email address, phone number, or exact address, verified by automated tests.
- **SC-006**: A buyer can propose a purchase and have it accepted by the seller, end to end, with the resulting record visible in both parties' histories, without help from a community administrator or platform support.
- **SC-007**: 100% of purchase-proposal screens display the non-intermediary disclosure prior to submission, verified by automated tests.
- **SC-008**: A buyer can determine the current state of any proposal they created at any time without contacting the seller directly.
- **SC-009**: 100% of attempts to submit a purchase proposal against a `PAUSED` listing are rejected, verified by automated tests, while proposals already `PENDING` before the pause remain normally acceptable.
- **SC-010**: 012-profiles-reputation's confirmed-transaction count and review-eligibility checks produce identical results before and after this feature ships for every pre-existing `ACCEPTED`-equivalent transaction, verified by automated tests — no reputation regression.

## Assumptions

- This feature evolves 010-transaction-logging's existing `Transaction` entity in place; there is no parallel or independent `Transaction` entity. Retiring 010's confirmation flow and message-thread prerequisite, and reconciling 012-profiles-reputation's read path against the evolved entity, are addressed in this feature's plan (see "Relationship to Feature 010" and "Dependency on Feature 012" above).
- The system is pre-launch: there is no production transaction data to preserve. Any existing `Transaction` rows are test/development data, so retiring 010's confirmation flow and evolving the schema in place is a direct migration with no real user data to rescue or backfill.
- Existing listings created before this feature shipped have no stock value. How they are migrated is a real product decision the plan MUST resolve, not a silent default: migrated listings MUST NOT be assigned an invented positive stock quantity that falsely claims availability the seller never declared. The plan MUST choose either (a) a state that requires the seller to declare stock before the listing becomes purchasable, or (b) a clearly-shown "stock not specified" state distinct from a declared `0` — not a silent default to `0` (which would misrepresent every pre-existing listing as out-of-stock) and not an invented positive number (which would misrepresent availability).
- A single `Transaction` record serves as both the buyer's purchase-history entry and the seller's sales-history entry once `ACCEPTED`; "dual history" refers to two owner-scoped views, not duplicated storage.
- "Buy" is available directly from a listing and does not require a pre-existing message thread between buyer and seller (per the feature's design decision); the proposal itself, and its later acceptance, constitute the parties' mutual agreement to transact.
- Multiple simultaneous `PENDING` proposals may exist against the same listing, including from the same buyer; the seller resolves them one at a time, and later ones may be rejected solely because stock was exhausted by an earlier acceptance.
- No payment-method selection, seller counter-offer, stock reservation on `PENDING` proposals, or notifications (email/in-app alert) are in scope for this feature; a party discovers a proposal's state by visiting it directly.
- Quantity is a positive integer and total is a positive number; the system does not validate the total against listing price × quantity, since it may reflect an off-platform negotiation.
