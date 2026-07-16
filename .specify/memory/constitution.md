<!--
SYNC IMPACT REPORT
Version: 2.0.0 → 3.0.0 (MAJOR)
Date: 2026-07-15
Status: Incorporates the amendment package agreed by both maintainers (v3.0.0) plus the
payments amendment requested by Cosmic Chimps. The Principle IV redefinition requires
explicit sign-off from both maintainers before merge.

MAJOR (backward-incompatible principle redefinition):
- Principle IV redefined: "No In-App Payment Processing — Transaction Logging Only" →
  "Non-Custodial Payments — Transaction Logging as Source of Truth". Adds an OPTIONAL
  in-app payment path using a non-custodial, connected-accounts (split payments) model with
  a licensed third-party processor, gated by triple opt-in (community admin enables module →
  seller connects own processor account → buyer explicitly chooses in-app payment with fee
  disclosed). Off-platform payment remains the system default. CMarket never holds funds,
  never touches card data, never mediates payment disputes. Confirmed in-app payments
  auto-generate the transaction log.

MINOR:
- Additional Constraints: added "No stored value" rule — no wallets, balances, or
  transferable/redeemable credits; promotional credits may only offset CMarket's own
  service fees.

REMOVED:
- Additional Constraint "No payment gateway, wallet, or escrow integration ... unless this
  constitution is amended to remove Principle IV" — superseded by the redefined Principle IV
  (this is that amendment). The platform-billing constraint (CMarket charging for its own
  service) remains unchanged.

Carried over from v3.0.0 (previously agreed):
- Principle I redefined: "Community-Gated Access" → "Admin-Controlled Membership Origin"
  (admin-issued access codes with expiration, optional redemption cap, revocation, and~
  mandatory per-redemption approval, as a second credential form; implementation deferred).
- Principle V redefined: single web application delivered as PWA; no native client.
- Principle III: invitation lifecycle rule (revoke MUST NOT block re-invite) and last-admin guard.
- Principle VIII: critical-flow tests MUST run in CI and block merge.
- Additional Constraints: stack recorded as decided (Next.js App Router, Prisma, PostgreSQL,
  Docker/Dokploy); versioned migrations + verified backups; platform billing permitted in an
  isolated module.

Template propagation required in same change:
- .specify/templates/plan-template.md: Constitution Check list must reference the redefined
  Principle IV (triple opt-in, non-custodial model, auto-generated transaction log) and the
  no-stored-value constraint.
-->

# CMarket Constitution

## Core Principles

### I. Admin-Controlled Membership Origin (NON-NEGOTIABLE)

Accounts and memberships are distinct. Anyone may create a CMarket account (email/password or federated identity); an account by itself grants zero access — no listings, no rosters, no transaction activity, and no community is discoverable or enumerable from it. An account with no memberships is a valid, inert state.
Membership MUST originate from a credential issued by that community's administrator: a direct invitation to a specific email, or a revocable access code with expiration and optional redemption cap, whose redemption creates a pending membership the administrator must approve. There is no pathway to membership that does not begin with an administrator-issued credential — no self-service join, no community directory, no request-to-join. Because accounts are self-created, a credential MUST only be redeemable by an account with a verified email matching the recipient, and invitation tokens MUST be single-use.

**Bootstrap exception:** creating a community designates its first administrator in the same act, via platform tooling with a documented escalation path — the sole membership path requiring no prior credential.

_Rationale:_ The trust boundary is the community, not the account. An inert account sees no more than a stranger on the internet, while open signup lets one identity hold memberships in several communities and lets an invited user sign up and accept in one flow. What stays closed is membership: the administrator remains its sole origin. Identity binding is what keeps that guarantee real once signup is open — an unverified email would turn open signup into a way to intercept someone else's invitation.

### II. Community Isolation (NON-NEGOTIABLE)

Data, products, and transactions belonging to one community MUST NOT be visible, queryable, or otherwise accessible from another community. Every data access path (API, search, listing feed, notification, export) MUST be scoped by community membership; cross-community leakage is treated as a security defect, not a bug of convenience.

_Rationale:_ Communities are the trust and privacy boundary of the entire product; a member of one university or company must never see or be seen by an unrelated community's marketplace activity.

### III. Administrator as Community Gatekeeper

Each community's administrator(s) MUST have exclusive authority within that community to: invite new members, issue and revoke access codes, revoke a pending invitation, approve or reject pending memberships, remove existing members, and moderate (edit visibility of, take down) listings. No other actor — including CMarket-wide staff tooling used casually — may perform these actions in place of the community's own administrator without a documented support/escalation path.

**Invitation lifecycle:** revoking an invitation MUST NOT prevent issuing a new invitation to the same recipient. More generally, no routine administrative action may produce a state the administrator cannot later undo through another routine action; terminal, unrecoverable states require explicit justification in the feature's plan.

**Last-admin guard:** a community MUST have at least one administrator at all times. Any action that would remove or demote the last remaining administrator MUST be rejected by the system.

_Rationale:_ Decentralized moderation scoped to each community keeps enforcement close to local norms and keeps the platform from becoming a single point of moderation failure. The lifecycle and last-admin rules exist because gatekeeping authority that can accidentally destroy itself (an orphaned community, an email that can never be re-invited) silently breaks Principle I.

### IV. Non-Custodial Payments — Transaction Logging as Source of Truth (NON-NEGOTIABLE)

CMarket MUST NOT hold, custody, or move money on its own account between buyer and seller. Two payment paths exist:

**(a) Off-platform payment (system default):** payment is arranged and executed entirely outside the application, at the buyer's and seller's own risk, with both parties logging the transaction manually.

**(b) Optional in-app payment:** available only when ALL of the following hold:

1. The community administrator has explicitly enabled the payments module for their community (default: disabled).
2. The seller has connected their own account with the licensed third-party payment processor; sellers without a connected account simply do not offer in-app payment, and their listings function under path (a).
3. The buyer explicitly chooses in-app payment over the off-platform alternative, with CMarket's service fee disclosed before confirmation. The off-platform alternative MUST always remain available and visible alongside it.

In-app payments MUST use a non-custodial, connected-accounts model (split payments): funds flow directly from buyer to seller via the processor; CMarket receives only its own service fee; CMarket never touches or stores card data (processor-hosted checkout only) and never holds user funds at any point. A confirmed in-app payment MUST automatically generate the corresponding transaction log — in-app payment extends transaction logging, it does not replace it.

Under both paths, all logging requirements hold:

- The UX MUST make explicit that CMarket is not a financial intermediary. For path (a), CMarket assumes no responsibility for payment; for path (b), payment execution, refunds, and disputes are between the parties and the processor — CMarket does not mediate payment disputes.
- Both parties MUST be verified as belonging to the same community before a transaction can occur or be logged between them.
- Every transaction MUST be traceable (who transacted/logged, when, against which listing and counterpart, and via which payment path).
- Contact information MUST NOT be exposed to either party until both have agreed to interact (see Principle VI).

_Rationale:_ The original prohibition on payment processing existed to keep CMarket out of financial regulation, custody risk, and fraud liability. This principle preserves that goal but achieves it by architecture rather than abstinence: a non-custodial split-payments model with a licensed processor keeps CMarket outside the flow of funds, outside PCI scope, and outside dispute mediation, while allowing communities that want in-app payment to opt into it. The triple opt-in (admin → seller → buyer) ensures no actor is ever forced into the payment path, and automatic log generation strengthens — rather than weakens — the traceability that communities rely on.

### V. Single Web Application, Installable as PWA

CMarket is delivered as a single web application, installable as a Progressive Web App. There is no native mobile client. Every core feature (joining a community, listing items, buying, logging a transaction, in-app payment where enabled, messaging, moderation) MUST be fully usable in a mobile viewport — responsive layout is mandatory, not a follow-up task. A core feature MUST NOT ship in a desktop-only state.

_Rationale:_ Maintaining parity with a native client that does not exist and is not planned is exactly the speculative scope Principle VII prohibits. A single responsive PWA serves both form factors with one codebase. Known trade-off, accepted explicitly: push notifications on iOS require the user to install the PWA to the Home Screen; notification-dependent flows (e.g., messaging, payment confirmations) must account for this limitation rather than assume push delivery.

### VI. Contact & Data Privacy Gating

Personal or contact data (phone number, email, exact address, etc.) MUST only be shared between two users once both have explicitly agreed to interact within the context of an active transaction. Absent that mutual agreement, users MUST interact only through in-app, non-identifying channels (e.g., in-app messaging tied to a listing). This gating applies regardless of community role, including administrators outside their moderation duties, and regardless of payment path — using in-app payment does not by itself constitute agreement to share contact data.

_Rationale:_ Members join CMarket because it is a closed, trusted space; that trust depends on personal data never being exposed as a side effect of simply browsing, messaging, or paying.

### VII. Simplicity & MVP-First

Every feature MUST be implemented as the simplest solution that satisfies its specification. Speculative functionality, unrequested configurability, and "nice to have" extensions MUST NOT be built alongside the requested feature — new ideas MUST be captured in the backlog instead of expanded into the current scope. Any added complexity MUST be justified against a simpler alternative (e.g., in a plan's Complexity Tracking table).

_Rationale:_ A multi-sided, multi-community marketplace has enough inherent complexity (gating, isolation, moderation, payments) without teams adding speculative scope on top; MVP-first keeps each increment shippable and reviewable.

### VIII. Test Discipline for Critical Flows

Automated tests are mandatory for these critical flows, regardless of whether a feature spec explicitly requests tests: user registration, membership invitation/acceptance (including access-code redemption and approval when implemented), product listing, transaction logging, and in-app payment (processor webhook handling, payment-state transitions, and automatic log generation). For these flows, tests MUST be written before implementation, MUST fail first (red), and implementation MUST proceed only to make them pass (green). For all other features, tests remain OPTIONAL and are only required when the feature's specification explicitly asks for them.

**CI enforcement:** critical-flow tests MUST run automatically in CI on every pull request and MUST block merge on failure. A quality gate that depends on someone remembering to run it manually is not a gate.

_Rationale:_ These flows are where a defect directly breaks a non-negotiable principle above (gating, isolation, traceability, or non-custodial payment integrity) — they are exempted from the general "tests only if requested" default because the cost of an undetected regression there is disproportionately high. Payment flows are included because a webhook processed twice, a forged notification accepted, or a paid order without a log each silently violates Principle IV.

## Additional Constraints

- **No stored value.** CMarket MUST NOT issue wallets, balances, transferable credits, or any form of stored value redeemable for goods, cash, or third-party payment. Promotional credits are permitted only if they exclusively offset CMarket's own service fees, are non-transferable, and are non-redeemable for money. Test for any future proposal: if the "reward" can become money for anyone other than CMarket, it is stored value and prohibited; if it only reduces what CMarket charges, it is a discount and permitted.
- **Platform billing.** CMarket MAY charge for its own service (e.g., community/administrator subscriptions, per-transaction service fees on in-app payments) through billing that is isolated from the marketplace core, uses an external payment provider exclusively, and never stores card data. Platform billing MUST NOT move money between community members.
- **Pricing is not constitutional.** Specific fee amounts, subscription prices, included-volume thresholds, and incentive values MUST live in product/pricing documentation and feature specs, not in this constitution. This document constrains the _structure_ of payments (non-custodial, opt-in, no stored value), not their prices.
- **Tenancy.** Community membership is the tenancy boundary for all data access; any new data store, cache, or search index MUST be designed with community scoping as a first-class dimension, not retrofitted later.
- **Stack (decided).** The stack in use is: Next.js (App Router), Prisma ORM, PostgreSQL, Docker, deployed via Dokploy. Feature plans MUST NOT mark these as NEEDS CLARIFICATION; any deviation from this stack MUST be justified in the plan's Technical Context against the cost of fragmenting the stack.
- **Migrations & backups.** Every schema change reaches production exclusively through versioned Prisma migrations applied by the deployment pipeline — never by manual modification of the production database. Automated database backups MUST exist, and restoration MUST be verified (actually performed) at least once before the first production community onboards.
- **Access codes are constitutionally permitted but not yet in scope.** No feature spec for community access codes may be created until a concrete adopting community requires bulk onboarding; until then, direct invitation (spec 001) is the only implemented membership path.

## Development Workflow & Quality Gates

- Every feature MUST pass through spec → plan → tasks → implement in that order; a plan's "Constitution Check" gate MUST be evaluated before Phase 0 research begins and re-checked after Phase 1 design.
- Any feature touching community membership, listings, messaging, transaction logging, or payments MUST have its plan explicitly confirm compliance with Principles I, II, III, IV, and VI before implementation starts.
- Any feature touching payments MUST additionally confirm: the non-custodial model is preserved (no code path where CMarket holds funds), the triple opt-in is enforced, processor webhooks are signature-verified and idempotent, and every confirmed payment generates exactly one transaction log.
- Any violation of a Core Principle surfaced during planning MUST be recorded in the plan's Complexity Tracking table with the specific rejected simpler alternative — silent violations are not permitted.
- Code review (self-review when working solo) MUST confirm: cross-community data exposure is impossible for the change, contact-data gating is respected, and — for the critical flows — tests exist, were written before the implementation they cover, and pass in CI.

## Governance

This constitution supersedes any conflicting ad-hoc practice for this repository. Amendments are made by editing this file directly, and MUST:

- State the version bump (MAJOR/MINOR/PATCH) and rationale using the semantic rule: MAJOR for backward-incompatible principle removal or redefinition, MINOR for adding a principle or materially expanding guidance, PATCH for clarification or wording fixes.
- Update the Sync Impact Report comment at the top of this file.
- Propagate any changed requirement into `.specify/templates/*.md` in the same change where the template's guidance would otherwise contradict the amendment.

All feature plans MUST include a Constitution Check gate referencing the Core Principles in this document. Complexity that cannot be justified against Principle VII (Simplicity & MVP-First) MUST be simplified before merge.

**Version:** 4.0.0 | **Ratified:** 2026-07-09 | **Last Amended:** 2026-07-15
