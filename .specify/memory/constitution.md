<!--
Sync Impact Report
==================
Version change: 1.0.0 → 2.0.0
Rationale: MAJOR bump. The entire Core Principles set is replaced: the five
generic, technology-agnostic principles from v1.0.0 are removed and replaced
with eight concrete, non-negotiable CMarket product principles (community
gating, community isolation, administrator gatekeeping, no in-app payment
processing, web/mobile parity, contact/data privacy gating, simplicity/MVP,
and critical-flow test discipline). This is backward-incompatible with the
prior principle set, so MAJOR applies per the Governance versioning rule.

Modified principles:
  - "I. Independently Testable Increments" → removed (superseded; independence
    is now expressed implicitly via MVP-first framing in new Principle VII)
  - "II. Simplicity & YAGNI" → renamed/kept as "VII. Simplicity & MVP-First"
  - "III. Contract-First Interfaces" → removed (not a stated non-negotiable
    for this project; may return in a future amendment if warranted)
  - "IV. Test Discipline" → replaced by "VIII. Test Discipline for Critical
    Flows" (narrower, mandatory-for-named-flows rather than opt-in-by-request)
  - "V. Observability & Operability" → removed (not restated by the user as
    non-negotiable; folded implicitly into Principle IV's traceability
    requirement for transaction logging)

Added principles (new, project-specific):
  - I. Community-Gated Access (NON-NEGOTIABLE)
  - II. Community Isolation (NON-NEGOTIABLE)
  - III. Administrator as Community Gatekeeper
  - IV. No In-App Payment Processing — Transaction Logging Only (NON-NEGOTIABLE)
  - V. Web/Mobile Parity for Core Features
  - VI. Contact & Data Privacy Gating
  - VII. Simplicity & MVP-First
  - VIII. Test Discipline for Critical Flows

Added sections: None new (Additional Constraints, Development Workflow &
Quality Gates, Governance retained, content updated for the new principles)

Removed sections: None structurally; prior principle content replaced as above

Templates requiring updates:
  - .specify/templates/tasks-template.md: ✅ updated — "Tests" note now
    reflects that tests are mandatory for the four named critical flows
    (registration, membership request/approval, product listing, transaction
    logging) and optional elsewhere, instead of purely opt-in-by-request.
  - .specify/templates/plan-template.md: ✅ no edit needed — Constitution
    Check section is a generic placeholder ("[Gates determined based on
    constitution file]") that already pulls from this document per feature.
  - .specify/templates/spec-template.md: ✅ no edit needed — generic
    Requirements/Key Entities structure already accommodates community,
    membership, listing, and transaction entities without template changes.
  - .specify/templates/checklist-template.md: ✅ no changes needed (generic)
  - README.md / docs/quickstart.md: N/A (do not exist yet in this repo)

Follow-up TODOs:
  - TODO(TECH_STACK): Language/framework/storage for web + mobile parity
    (Principle V) are still undecided; record in each feature's plan.md
    Technical Context until a stack is formally chosen.
-->

# CMarket Constitution

## Core Principles

### I. Community-Gated Access (NON-NEGOTIABLE)

No user may view, list, sell, or buy within a community without having been
explicitly approved by that community's administrator. Unapproved or pending
members MUST be denied access to community listings, member rosters, and
transaction activity — there is no public or default-open mode.

**Rationale**: CMarket's core value proposition is trust derived from closed
membership (university, company, residential complex); any bypass of
approval undermines that trust for every member of the community.

### II. Community Isolation (NON-NEGOTIABLE)

Data, products, and transactions belonging to one community MUST NOT be
visible, queryable, or otherwise accessible from another community. Every
data access path (API, search, listing feed, notification, export) MUST be
scoped by community membership; cross-community leakage is treated as a
security defect, not a bug of convenience.

**Rationale**: Communities are the trust and privacy boundary of the entire
product; a member of one university or company must never see or be seen by
an unrelated community's marketplace activity.

### III. Administrator as Community Gatekeeper

Each community's administrator(s) MUST have exclusive authority within that
community to: approve or reject membership requests, remove existing
members, and moderate (edit visibility of, take down) listings. No other
actor — including CMarket-wide staff tooling used casually — may perform
these actions in place of the community's own administrator without a
documented support/escalation path.

**Rationale**: Decentralized moderation scoped to each community keeps
enforcement close to local norms and keeps the platform from becoming a
single point of moderation failure.

### IV. No In-App Payment Processing — Transaction Logging Only (NON-NEGOTIABLE)

CMarket MUST NOT process, hold, or move money between buyer and seller.
Payment is arranged and executed entirely outside the application, at the
buyer's and seller's own risk. What the app provides instead is transaction
*logging*: both parties document that a purchase/sale occurred. This logging
MUST satisfy all of the following:

- The UX MUST make explicit, at the point of logging, that CMarket is not a
  financial intermediary and assumes no responsibility for payment.
- Both parties MUST be verified as belonging to the same community before a
  transaction can be logged between them.
- Every logged transaction MUST be traceable (who logged it, when, against
  which listing and counterpart).
- Contact information MUST NOT be exposed to either party until both have
  agreed to interact (see Principle VI).

**Rationale**: Avoiding payment processing removes CMarket from financial
regulation, custody risk, and fraud liability, while transaction logging
still gives communities a record of activity and accountability.

### V. Web and Mobile Parity for Core Features

The following core features MUST be available with equivalent functionality
on both web and mobile: joining a community, listing items, buying,
logging a transaction, messaging, and moderation. A core feature MUST NOT
ship on one platform without a concrete, tracked plan to ship the
equivalent on the other; platform-exclusive core functionality is a
violation unless explicitly justified and time-boxed.

**Rationale**: Members of a given community will use whichever platform is
convenient to them; fragmenting core functionality by platform fractures
the community experience and undermines adoption.

### VI. Contact & Data Privacy Gating

Personal or contact data (phone number, email, exact address, etc.) MUST
only be shared between two users once both have explicitly agreed to
interact within the context of an active transaction. Absent that mutual
agreement, users MUST interact only through in-app, non-identifying channels
(e.g., in-app messaging tied to a listing). This gating applies regardless
of community role, including administrators outside their moderation duties.

**Rationale**: Members join CMarket because it is a closed, trusted space;
that trust depends on personal data never being exposed as a side effect of
simply browsing or messaging.

### VII. Simplicity & MVP-First

Every feature MUST be implemented as the simplest solution that satisfies
its specification. Speculative functionality, unrequested configurability,
and "nice to have" extensions MUST NOT be built alongside the requested
feature — new ideas MUST be captured in the backlog instead of expanded into
the current scope. Any added complexity MUST be justified against a simpler
alternative (e.g., in a plan's Complexity Tracking table).

**Rationale**: A multi-sided, multi-community marketplace has enough
inherent complexity (gating, isolation, moderation) without teams adding
speculative scope on top; MVP-first keeps each increment shippable and
reviewable.

### VIII. Test Discipline for Critical Flows

Automated tests are mandatory for these critical flows, regardless of
whether a feature spec explicitly requests tests: user registration,
membership request/approval, product listing, and transaction logging. For
these flows, tests MUST be written before implementation, MUST fail first
(red), and implementation MUST proceed only to make them pass (green). For
all other features, tests remain OPTIONAL and are only required when the
feature's specification explicitly asks for them.

**Rationale**: These four flows are where a defect directly breaks a
non-negotiable principle above (gating, isolation, or transaction
traceability) — they are exempted from the general "tests only if
requested" default because the cost of an undetected regression there is
disproportionately high.

## Additional Constraints

- No payment gateway, wallet, or escrow integration MUST be added to
  CMarket's core product; any exploration of payment processing is out of
  scope unless this constitution is amended to remove Principle IV.
- Community membership is the tenancy boundary for all data access; any new
  data store, cache, or search index MUST be designed with community scoping
  as a first-class dimension, not retrofitted later.
- The primary language, framework, and storage stack for the web and mobile
  clients are not yet chosen. Each feature's `plan.md` Technical Context
  MUST record `NEEDS CLARIFICATION` for undecided stack choices rather than
  silently assuming a default.

## Development Workflow & Quality Gates

- Every feature MUST pass through spec → plan → tasks → implement in that
  order; a plan's "Constitution Check" gate MUST be evaluated before Phase 0
  research begins and re-checked after Phase 1 design.
- Any feature touching community membership, listings, messaging, or
  transaction logging MUST have its plan explicitly confirm compliance with
  Principles I, II, III, IV, and VI before implementation starts.
- Any violation of a Core Principle surfaced during planning MUST be
  recorded in the plan's Complexity Tracking table with the specific
  rejected simpler alternative — silent violations are not permitted.
- Code review (self-review when working solo) MUST confirm: cross-community
  data exposure is impossible for the change, contact-data gating is
  respected, and — for the four critical flows — tests exist and were
  written before the implementation they cover.

## Governance

This constitution supersedes any conflicting ad-hoc practice for this
repository. Amendments are made by editing this file directly, and MUST:

1. State the version bump (MAJOR/MINOR/PATCH) and rationale using the
   semantic rule: MAJOR for backward-incompatible principle removal or
   redefinition, MINOR for adding a principle or materially expanding
   guidance, PATCH for clarification or wording fixes.
2. Update the Sync Impact Report comment at the top of this file.
3. Propagate any changed requirement into `.specify/templates/*.md` in the
   same change where the template's guidance would otherwise contradict
   the amendment.

All feature plans MUST include a Constitution Check gate referencing the
Core Principles in this document. Complexity that cannot be justified
against Principle VII (Simplicity & MVP-First) MUST be simplified before
merge.

**Version**: 2.0.0 | **Ratified**: 2026-07-09 | **Last Amended**: 2026-07-09
