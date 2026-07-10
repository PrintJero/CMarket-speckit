# Phase 0 Research: Community Invitations

## Node.js runtime version

- **Decision**: Node.js 20 LTS.
- **Rationale**: User specified "Node.js" without a version; 20 LTS is the
  current active LTS line with the longest remaining support window,
  compatible with Prisma and Express.
- **Alternatives considered**: Node.js 22 (current, not yet LTS at time of
  writing — rejected for production stability); Node.js 18 (LTS but closer
  to end-of-life — rejected in favor of the longer-support option).

## Authentication approach (JWT)

- **Decision**: Short-lived JWT access token (~15 min) plus a longer-lived
  refresh token, issued by the backend on login and validated by an Express
  middleware on every protected route across web and mobile clients.
- **Rationale**: Standard, well-understood pattern for a single backend
  serving multiple client types (web + mobile) without server-side session
  storage; keeps both clients identical in how they authenticate (Principle
  V parity).
- **Alternatives considered**: Long-lived single JWT with no refresh
  (rejected — larger blast radius if a token leaks, no clean revocation
  path for Principle III's "revoke access at any time"); server-side
  sessions (rejected — adds stateful infrastructure not otherwise needed by
  this feature, conflicts with Simplicity principle).

## Community-scoped data access pattern

- **Decision**: A single Express middleware (`requireCommunityMembership` /
  `requireCommunityAdmin`) resolves the target `communityId` from the route,
  loads the caller's `Membership` row for that community, and rejects
  (404, not 403, to avoid confirming a community's existence to
  non-members) if no active membership/admin role is found. Every
  invitation/membership Prisma query additionally filters by `communityId`
  in the `WHERE` clause — scoping is never assumed from context alone.
- **Rationale**: Directly operationalizes Constitution Principle II
  (Community Isolation) as a single reusable enforcement point instead of
  ad hoc checks per route, reducing the chance of an accidental
  cross-community leak.
- **Alternatives considered**: Row-level security at the PostgreSQL level
  (rejected for this feature — real defense-in-depth option worth
  revisiting later, but adds infra/migration complexity beyond this
  feature's MVP scope per Principle VII); trusting a `communityId` claim
  embedded in the JWT (rejected — stale if membership is revoked
  mid-session, contradicts "revoke access at any time," FR-010).

## Invitation expiration mechanism

- **Decision**: No background job/cron. `Invitation.expiresAt` is stored at
  creation time (`createdAt + community's configured days, default 7`).
  Any read, accept, decline, or cancel operation computes an *effective
  status* of `EXPIRED` when the stored status is still `PENDING` and
  `now >= expiresAt`, and treats it exactly like a terminal state (FR-017).
- **Rationale**: Satisfies FR-016/FR-017 without introducing a scheduler
  dependency; simplest mechanism that meets the requirement (Principle
  VII). A batch job would only be needed if the product later requires
  proactively notifying users the moment an invite expires, which is not a
  stated requirement.
- **Alternatives considered**: Cron/scheduled worker that flips `PENDING`
  rows to `EXPIRED` on a timer (rejected — unrequested infrastructure for
  a purely read-time-computable check); TTL at the database level via a
  scheduled `pg_cron` job (rejected for the same reason, plus added
  operational dependency).

## Email delivery integration

- **Decision**: Treat the existing email-sending capability as an external
  service accessed through a single backend-side integration module
  (`src/integrations/email.ts`) with one function,
  `sendInvitationEmail(invitation)`, that the invitation service calls
  after creating a pending invitation. The integration module is the only
  place that knows how to reach that service.
- **Rationale**: The user stated the email capability "already exists" and
  should be "integrated as a service call" — this feature does not build
  an email system, only a thin call-out, keeping scope minimal (Principle
  VII) and isolating the external dependency behind one seam for
  testability (can be mocked in contract/integration tests).
- **Alternatives considered**: Direct SMTP/provider SDK calls scattered
  across the invitation service (rejected — couples business logic to
  delivery mechanism, harder to test, harder to swap providers later).

## SMS/phone-only invitation notification

- **Decision**: Out of scope for this plan's implementation — only email
  delivery is wired up, since only an "existing email sending capability"
  was named as available. Phone-number invitations are still accepted and
  stored (per spec FR-001, which allows email *or* phone), but if no email
  is present, the invitation remains valid and can still be viewed/accepted
  once the invitee is identified/logged in; a proactive SMS notification is
  not sent.
- **Rationale**: No SMS-sending capability was described as available;
  building one would be unrequested scope (Principle VII). This is
  recorded here rather than as a spec change because it is an
  implementation-availability constraint, not a product requirement change.
- **Alternatives considered**: Building/integrating an SMS provider now
  (rejected — no such capability was described as available, and adding
  one is a distinct, larger effort better tracked as its own future
  feature/backlog item).

## Testing stack per client

- **Decision**: Backend — Jest + Supertest against an ephemeral/test
  PostgreSQL database (via Prisma's migration tooling) for contract and
  integration tests. Web — Jest + React Testing Library for the
  Next.js invite/accept/decline/admin screens. Mobile — Jest + React
  Native Testing Library for the equivalent Expo screens.
- **Rationale**: Standard, well-supported tooling for each half of the
  stack; keeps the two client test setups symmetric, matching the parity
  requirement (Principle V) at the testing level too.
- **Alternatives considered**: End-to-end browser/device automation
  (Playwright/Detox) for this feature (rejected for now — valuable but
  heavier than what a first-pass critical-flow test suite needs; can be
  layered on later without contradicting anything decided here).
