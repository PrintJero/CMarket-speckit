# Feature Specification: Transaction Logging

**Feature Branch**: `010-transaction-logging`

**Created**: 2026-07-28

**Status**: Draft

**Input**: User description: "Transaction Logging: Two members of the same community can create a permanent, traceable record that a transaction occurred between them against a specific listing. Today CMarket lets members find each other and message, but nothing records that a deal happened — so there is no history, no accountability, and nothing for reputation to be built on later. This closes that gap for the off-platform payment path (Constitution Principle IV path a), which is the system default. In-app payment (path b) is explicitly out of scope for this feature, but the log's shape must be forward-compatible so a future in-app payment can auto-generate a log without redesign. Confirmation model: two-sided — a log starts 'unconfirmed' and becomes 'confirmed' only when the counterpart explicitly agrees; a confirmed log is immutable; an unconfirmed log that is never confirmed simply stays that way forever (CMarket does not mediate). Prerequisite: a transaction can only be logged between two accounts who already have an existing message thread (008-listing-messaging) on that specific listing. Cross-community and non-member attempts MUST be rejected, verified live at logging and at confirming. Required fields: recording account, counterpart account, listing, community, timestamp, payment path (off-platform for this feature), and confirmation state — no amount field of any kind. Listing status is untouched by logging — no SOLD state, no auto-pause. The logging and confirmation UI MUST disclose that CMarket is not a financial intermediary. Neither flow may expose contact data. Out of scope: in-app payment execution, reputation/badges/ranking, dispute mediation, and any handling of money or card data. Critical flow per Principle VIII: cross-community rejection, the confirmation state machine, confirmed-log immutability, and non-exposure of contact data MUST have tests written first, failing first, blocking merge in CI."

## Clarifications

### Session 2026-07-28

- Q: Should a transaction log require the counterpart's confirmation before it counts as real (two-sided), or is a single party's record enough (one-sided)? → A: Two-sided. A log starts `unconfirmed` and becomes `confirmed` only when the counterpart explicitly agrees. This is load-bearing for the future reputation feature (spec 010's own risk note): a one-sided, unconfirmed log is trivially inflatable.
- Q: Should logging a transaction require an existing message thread (008-listing-messaging) between the two parties on that listing? → A: Yes. A log may only be created between the two accounts that are, respectively, that listing's owner and a buyer who has an existing thread with that owner on that listing (008's one-thread-per-(listing,buyer) guarantee). This reuses 008's existing proof of prior explicit interaction (Constitution Principle VI) instead of inventing a new one. Community co-membership for both parties is still re-verified live at the moment of logging and at the moment of confirming — independent of whether it held when the thread was created, mirroring 008's membership-loss revocation behavior (008 FR-009).
- Q: Does recording a transaction change the listing's status (e.g., introduce a SOLD state or auto-pause it)? → A: No. This feature does not modify `ListingStatus` (005-product-listings) in any way. No `SOLD` state is introduced and no auto-pause occurs; the owner pauses or deletes the listing manually, exactly as they do today.
- Q: Should the logging flow allow an optional self-reported amount, or omit amount entirely? → A: Omit entirely for this feature. No amount field of any kind is captured — not required, not optional. This can be added later without changing the log's existing shape (FR-011's forward-compatibility goal), consistent with Constitution Principle VII (no speculative scope).
- Q: How does a party contest a log they say is false or wrongly attributes them as counterpart? → A: There is no dispute, edit, or appeal flow. Declining to confirm is the entire mechanism: an unconfirmed log that the counterpart never confirms — for any reason, including believing it to be false — simply remains `unconfirmed` forever and is never treated as a real transaction. CMarket does not mediate (Constitution Principle IV).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A member records an off-platform sale (Priority: P1)

Two members of the same community have been messaging about a listing. After completing a deal outside the app, either one of them opens that listing's thread and records that a transaction happened, naming the other person as the counterpart. This creates a permanent, traceable log — the first time CMarket has any record that a deal occurred at all.

**Why this priority**: Without this, nothing else in the feature has anything to act on. This is the entire point: today a deal happens and CMarket has zero record of it, leaving no history, no accountability, and nothing for future reputation to be built on.

**Independent Test**: Can be fully tested by having two co-members with an existing message thread on a listing (one as owner, one as buyer) have either party record a transaction naming the other as counterpart, then asserting a log now exists identifying both parties, the listing, the community, the timestamp, and the payment path, in an `unconfirmed` state.

**Acceptance Scenarios**:

1. **Given** two co-members of community C with an existing message thread on listing L (one is L's owner, the other messaged as a buyer), **When** either one records a transaction naming the other as counterpart, **Then** a new log is created identifying both parties, listing L, community C, the current time, and payment path "off-platform," in the `unconfirmed` state.
2. **Given** the same log, **When** either party views it afterward, **Then** both parties can see the same record — it is traceable by both, not just the one who created it.
3. **Given** two co-members with no existing message thread on a listing, **When** either attempts to record a transaction against that listing naming the other as counterpart, **Then** the attempt is rejected and no log is created.
4. **Given** a member attempting to record a transaction naming themselves as the counterpart, **When** they submit it, **Then** the attempt is rejected — a log always requires two distinct parties.

---

### User Story 2 - The counterpart confirms the transaction (Priority: P1)

The person named as counterpart in an unconfirmed log reviews it and, if it matches their own understanding of what happened, confirms it. Confirming locks the record in permanently.

**Why this priority**: An unconfirmed log is just one person's claim. Confirmation is what makes the record trustworthy enough that a future reputation feature — or anyone else — can rely on it. Without this, the feature would ship a system that's trivially gameable.

**Independent Test**: Can be fully tested by having the named counterpart on an unconfirmed log confirm it, then asserting the log's state becomes `confirmed` and that none of its core facts (parties, listing, community, payment path, time) can subsequently be changed by either party.

**Acceptance Scenarios**:

1. **Given** an unconfirmed log naming account B as counterpart, **When** B confirms it, **Then** the log's state becomes `confirmed`.
2. **Given** a confirmed log, **When** either party attempts to change any of its core facts (parties, listing, community, payment path, time), **Then** the attempt is rejected — a confirmed log is immutable.
3. **Given** an unconfirmed log naming account B as counterpart, **When** any account other than B attempts to confirm it, **Then** the attempt is rejected.
4. **Given** an unconfirmed log, **When** the counterpart simply never confirms it — for any reason, including believing it is false — **Then** the log remains `unconfirmed` indefinitely; no dispute, edit, or appeal process exists or is needed.

---

### User Story 3 - Cross-community and non-member attempts are rejected (Priority: P1)

Two accounts that are not both current members of the same community can never end up with a transaction log between them, whether they try to create one or confirm one.

**Why this priority**: This is the same community boundary that governs every other part of CMarket (Constitution Principle II). A transaction log that could exist between non-co-members would be a direct violation of the platform's core isolation guarantee, and this is explicitly called out as a required, blocking test (Constitution Principle VIII).

**Independent Test**: Can be fully tested by having two accounts that are not members of the same community attempt to log a transaction against a listing, and separately by having a co-member's membership lapse between logging and confirming, then asserting both attempts are rejected.

**Acceptance Scenarios**:

1. **Given** two accounts that are not members of the same community, **When** either attempts to log a transaction naming the other as counterpart, **Then** the attempt is rejected and no log is created.
2. **Given** an unconfirmed log between two co-members, **When** one of them loses membership in that community before the counterpart confirms, **Then** the confirmation attempt is rejected — current co-membership is re-verified at confirmation time, not assumed from when the log was created.
3. **Given** an unconfirmed log between two co-members, **When** either party's membership lapses after the log already exists, **Then** the log itself is not deleted or altered — only the confirmation action is blocked while membership is lacking. (A membership lapse *before* the log is created is covered by scenario 1 above, not this one — a log can only be created while both parties are current co-members.)

---

### User Story 4 - The non-intermediary disclosure is always shown (Priority: P2)

Before recording or confirming a transaction, a member sees a clear statement that CMarket is not a financial intermediary and takes no responsibility for the payment itself.

**Why this priority**: This is a required disclosure (Constitution Principle IV) that protects both the platform and its members from misunderstanding what CMarket does and does not do. It matters from the first release of this feature, but the feature is still meaningful (if non-compliant) without it, so it ranks below the core recording/confirming/isolation mechanics.

**Independent Test**: Can be fully tested by opening the logging flow and the confirmation flow independently and asserting the non-intermediary disclosure is visibly present in both, before the action is submitted.

**Acceptance Scenarios**:

1. **Given** a member about to record a transaction, **When** the logging flow is shown, **Then** it explicitly states that CMarket is not a financial intermediary and assumes no responsibility for the payment.
2. **Given** a member about to confirm a transaction, **When** the confirmation flow is shown, **Then** the same disclosure is explicitly stated.

---

### Edge Cases

- What happens when a member tries to log a transaction against a listing where they have a thread, but naming a *different* co-member (not the owner/buyer pair from that thread) as counterpart? Rejected — the eligible counterpart is exactly the other participant of that specific listing thread, not any arbitrary co-member.
- What happens when a listing is deleted after a log referencing it already exists (confirmed or unconfirmed)? The log is retained as historical record; it is not deleted along with the listing (contrast with 008's message threads, which are deleted when their listing is deleted — a transaction log's traceability guarantee outlives the listing).
- What happens if the same two parties, on the same listing, try to log a second transaction after already having one confirmed or unconfirmed? Allowed — multiple sequential transactions between the same two co-members on the same listing are legitimate (e.g., separate deals over time) and each is its own independent log.
- What happens when a member attempts to log a transaction naming a counterpart with whom they have a thread, but on a *different* listing than the one the thread is tied to? Rejected — the thread must be on the same listing the log references.
- What happens if the recording party makes an honest mistake before the counterpart confirms (e.g., wrong listing)? There is no edit; the recorder's only recourse is to leave it unconfirmed (it will never become a trusted record) — consistent with there being no edit/dispute mechanism for any unconfirmed log.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let a member create a transaction log against a specific listing, naming a counterpart, only when the member and the named counterpart are, respectively, that listing's owner and a buyer who has an existing message thread (008-listing-messaging) with that owner on that same listing.
- **FR-002**: The system MUST verify, at the moment a log is created, that both the recording account and the counterpart account currently hold membership in the same community as the listing; otherwise it MUST reject the action and create no log.
- **FR-003**: The system MUST verify, at the moment a log is confirmed, that both parties still currently hold membership in that same community; otherwise it MUST reject the confirmation.
- **FR-004**: A newly created log MUST start in the `unconfirmed` state.
- **FR-005**: A log MUST transition to the `confirmed` state only when the account named as counterpart explicitly confirms it; no other account may confirm a log on the counterpart's behalf.
- **FR-006**: An `unconfirmed` log that is never confirmed MUST remain `unconfirmed` indefinitely; the system MUST NOT provide any dispute, edit, or appeal mechanism for a log either party believes to be incorrect.
- **FR-007**: A `confirmed` log's core facts — the recording account, the counterpart account, the listing, the community, the timestamp, and the payment path — MUST NOT be editable by either party, or by anyone, after confirmation.
- **FR-008**: Every log MUST capture, at minimum: the recording account, the counterpart account, the listing, the community, a creation timestamp, the payment path, and its confirmation state.
- **FR-009**: Every log's payment path MUST be recorded as "off-platform" for every log created by this feature.
- **FR-010**: The system MUST NOT require or accept any amount field (self-reported or otherwise) when creating or confirming a log.
- **FR-011**: The log's stored shape MUST be such that a future in-app payment path can populate the same fields (recording account, counterpart, listing, community, timestamp, payment path, confirmation state) with payment path = "in-app," without requiring a redesign of the log's structure or its immutability/confirmation guarantees. No in-app payment behavior is implemented by this feature.
- **FR-012**: This feature MUST NOT introduce, change, or depend on any `Listing` status transition (005-product-listings); a listing referenced by a log remains exactly as it was before the log existed.
- **FR-013**: A logging or confirmation attempt where the recording account and the named counterpart account are the same account MUST be rejected.
- **FR-014**: The logging flow and the confirmation flow MUST each explicitly state, before the action is submitted, that CMarket is not a financial intermediary and assumes no responsibility for the payment.
- **FR-015**: Neither the logging flow nor the confirmation flow MUST expose either party's contact data (phone number, email address, or exact address); creating or confirming a log is not itself agreement to share contact data (Constitution Principle VI).
- **FR-016**: A log MUST be visible to both the recording account and the counterpart account after it is created, regardless of confirmation state.
- **FR-017**: Deleting the listing a log references MUST NOT delete or alter any log that already references it.

### Key Entities

- **Transaction (log)**: The traceable record itself. References exactly two accounts (the recorder and the counterpart), one listing, one community, a creation timestamp, a payment path (`off-platform` for this feature; reserved for a future `in-app` value), and a confirmation state (`unconfirmed` or `confirmed`). Immutable in its core facts once `confirmed`. Persists independently of the listing it references — it is not deleted when the listing is deleted. This is the constitutional "source of truth" named in Principle IV.
- **Listing** *(existing, from 005-product-listings — referenced, not modified)*: The thing a log is about. This feature reads its `communityId` and `ownerId` to determine eligibility and community scope but never changes its `status`.
- **Message Thread** *(existing, from 008-listing-messaging — referenced, not modified)*: The existing (listing, buyer) relationship this feature reuses as proof of prior explicit interaction — eligibility to log a transaction on a listing is drawn directly from having a thread on it.
- **Membership** *(existing, from 003/004 — referenced, not modified)*: The (accountId, communityId) relationship checked live at both log-creation and confirmation time to verify current co-membership.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of attempts to log a transaction between two accounts that do not currently share a community membership are rejected, verified by automated tests.
- **SC-002**: 100% of attempts to log a transaction between two accounts with no existing message thread on the referenced listing are rejected, verified by automated tests.
- **SC-003**: 100% of confirmation attempts by any account other than the log's named counterpart are rejected, verified by automated tests.
- **SC-004**: 100% of attempts to modify any core fact of a `confirmed` log are rejected, verified by automated tests.
- **SC-005**: 0% of logging or confirmation flow renders include either party's email, phone number, or exact address, verified by automated tests.
- **SC-006**: A member with an existing thread on a listing can create a transaction log and have it confirmed by the counterpart, end to end, without needing help from a community administrator or platform support.
- **SC-007**: 100% of logging and confirmation screens display the non-intermediary disclosure prior to submission, verified by automated tests.

## Assumptions

- A transaction log's eligibility is derived entirely from an existing 008-listing-messaging thread on the referenced listing; no separate "interaction" or "match" concept is introduced by this feature.
- A confirmed log is retained forever and is never deleted by any user action; only future, out-of-scope features (e.g., platform administration data-retention policy) would ever remove one.
- Multiple transaction logs (confirmed or unconfirmed) may exist between the same two parties on the same listing; this feature does not deduplicate or limit them, consistent with real-world sellers making repeat sales to the same buyer.
- No notification (email, in-app alert, or otherwise) is required when a log is created or confirmed for this feature; a party discovers a pending unconfirmed log naming them by visiting it directly, consistent with 008's existing no-real-time, no-notification precedent.
- This feature's `Transaction` entity is entirely new; it does not reuse or extend the `Message` or `MessageThread` entities from 008 beyond reading thread existence for eligibility.
