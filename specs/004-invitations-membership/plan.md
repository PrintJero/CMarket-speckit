# Implementation Plan: Invitations & Membership

**Branch**: `spec-004-invitations-membership` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-invitations-membership/spec.md`

## Summary

Give a community's administrator the ability to invite a person by email, producing a single-use `Invitation` record (hashed token, same scheme as `VerificationToken`) tied to that email and community. The invited person can accept only once they hold an `Account` with a verified email that exactly (case-insensitively) matches the invited email — reusing the existing `assertEmailVerified()`/`emailsMatch()` functions — signing up and verifying first if they don't yet have one. Acceptance atomically consumes the invitation and creates a `Membership` row with a new `MEMBER` role (extending `MembershipRole` alongside the existing `ADMINISTRATOR`). Administrators can revoke any member's `Membership` (a hard delete) at any time; revoking never blocks re-inviting the same email, and a last-admin guard rejects any delete that would leave a community with zero administrators — both new operations reuse the `prisma.$transaction` interactive-transaction pattern `createCommunity()` established in 003-community-creation. Unlike 003 (operator-tooling only, no networked surface), this feature is reachable from the end-user app: an administrator page per community (invite form, member list, revoke) and an accept-link page, which also means extending `getCurrentAccount()`'s `CurrentAccountPayload.memberships` from its 003-era hardcoded `[]` to real data — the exact extension 003's own FR-015 named as deferred to a future feature. Testing follows 002-accounts-authentication's stack: Vitest contract tests for the three new service functions, Playwright specs for the new pages/routes.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Next.js (App Router) — unchanged from 002/003, no new language/runtime.

**Primary Dependencies**: Prisma Client 6.19.3 (existing) — no new runtime dependency. Reuses `sendEmail()`, `assertEmailVerified()`, `emailsMatch()`/`normalizeEmail()`, `getCurrentAccount()` exactly as already implemented.

**Storage**: PostgreSQL via Prisma, same dev/test containers already used by 002/003. New model: `Invitation`. Extended enum: `MembershipRole` gains `MEMBER`. No change to `Community`; `Membership` gains a delete path (application-level, not a schema change) and the enum extension.

**Testing**: Vitest (`tests/contract/`) for `inviteToCommunity()`, `acceptInvitation()`, `revokeMembership()` — red-then-green per Principle VIII — plus `tests/unit/` for the new email-comparison/authorization edge cases not already covered by 002's own unit tests. Playwright (`tests/integration/`) for the admin page's invite/revoke UI and the invitation-accept page, reusing the existing `EMAIL_TEST_CAPTURE`/`last-email` sink from `tests/integration/helpers.ts` (research.md #9, #10).

**Target Platform**: The existing single Next.js web app (App Router), installable PWA, Docker/Dokploy — no new deployable unit.

**Project Type**: Extension of the existing single Next.js/Prisma project (no new top-level project).

**Performance Goals**: None beyond standard interactive web-app latency — same low-volume, administrator-driven scale as 003; no specified throughput target.

**Constraints**: FR-009's last-admin guard and FR-012's invitation-supersession both require atomicity (research.md #4, #5) — both use `prisma.$transaction`, mirroring `createCommunity()`'s existing pattern (per this plan's explicit instruction). FR-002's identity-binding gate and FR-003's verification gate must reuse the existing `emailsMatch()`/`assertEmailVerified()` functions rather than reimplementing them (research.md #6).

**Scale/Scope**: One invitation, one revoke, one acceptance at a time (FR-014 — no bulk/mass operations); expected volume proportional to each community's real membership growth, not a high-throughput path.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | **PASS** | This feature *is* the direct-invitation half of Principle I: membership originates solely from an administrator-issued, single-use, identity-bound credential (FR-001–FR-005). No self-service join path is introduced; an invited person without a verified account is blocked until they complete verification (Story 2). |
| II. Community Isolation | **PASS** | Every new operation (invite, revoke) is scoped to one `communityId`, checked against the caller's own `Membership` row for that specific community (FR-010) — no cross-community query is introduced. `Invitation.communityId` is a required, non-optional field from creation. |
| III. Administrator as Community Gatekeeper (NON-NEGOTIABLE) | **PASS** | This feature implements exactly the powers Principle III names: invite, revoke, and (FR-009) the last-admin guard. The invitation lifecycle rule ("revoking MUST NOT prevent re-inviting") is FR-008, verified by an automated test (research.md #3/#4, quickstart Scenario 5). |
| IV. Non-Custodial Payments | N/A | Not touched. |
| V. Single Web Application, Installable as PWA | **PASS** | New pages (`/communities/{id}/admin`, `/invitations/accept`) are part of the same responsive Next.js PWA; no new client, no desktop-only surface. |
| VI. Contact & Data Privacy Gating | **PASS** | The admin page's member list (T012) exposes every current member's email to that community's administrator, not only emails the administrator personally typed in — this is permitted because the gate's carve-out is for "administrators outside their moderation duties" (constitution, Principle VI), and reviewing/managing who belongs to the community one administers is squarely within moderation duties, not a side effect of browsing, messaging, or paying. No member's contact data is exposed to any account that isn't that community's own administrator. |
| VII. Simplicity & MVP-First | **PASS** | No new dependency; reuses `sendEmail()`, `assertEmailVerified()`, `emailsMatch()`, the `prisma.$transaction` pattern, and the existing email-capture test sink. Revoke is a hard delete, not a new soft-delete column (research.md #3) — deliberately the simpler option. No access codes, no bulk invites, no expiration policy (FR-014, per spec Out of Scope). |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | **PASS, with obligation carried into tasks.md** | "Membership invitation/acceptance" is an explicitly named critical flow. Contract tests for `inviteToCommunity()`/`acceptInvitation()`/`revokeMembership()` MUST be written first and confirmed red before implementation, and Playwright specs for the new pages MUST likewise precede their implementation, per tasks.md ordering. |

**Additional Constraints check**: Tenancy constraint satisfied (`Invitation.communityId` is a first-class, required field, not retrofitted). Stack constraint satisfied (no deviation — same Next.js/Prisma/PostgreSQL/Docker). Migrations & backups: the new `Invitation` model and `MembershipRole.MEMBER` value ship as a single versioned Prisma migration (tasks.md), never a manual DB edit. Access codes remain correctly out of scope (FR-014); this feature does not touch that deferred path.

No violations identified; Complexity Tracking table is not needed.

*Re-checked after Phase 1 design: data-model.md and contracts/invitations-membership-api.md introduce no new violations — the `CurrentAccountPayload.memberships` extension (research.md #7) is additive and backward-compatible (default-empty second parameter), not a Principle II/III concern since it only ever reflects the querying account's own real memberships.*

*Re-checked (T028) against the finished implementation: no new violations. Principle III's last-admin guard is now genuinely enforced, not merely modeled — `revokeMembership()` (`src/server/services/invitationService.ts`) runs the count-then-delete at `Serializable` isolation and maps the resulting write-conflict to `{ ok: false, reason: "conflict" }`, closing the concurrent-revoke race a prior draft of research.md #5 had incorrectly claimed was already closed by plain transaction wrapping. `acceptInvitation()`'s consume step uses a conditional `updateMany`/count-check (mirroring `consumeVerificationToken`), so SC-006's single-use guarantee holds under concurrent acceptance, not only via the `@@unique([accountId, communityId])` backstop. `tests/unit/test_zero_membership_payload.ts` and `tests/contract/test_create_community.ts`'s FR-015 assertion both still pass unmodified (verified: `npm run test:unit`, 74/74 passing), confirming the `CurrentAccountPayload` extension didn't disturb 002/003's own hardcoded-empty assertions. Full suite green: `npm run typecheck`, `npm run lint`, `npm run test:unit` (74 tests), `npm run test:e2e` (14 tests, including this feature's 3 Playwright specs covering US1/US2/US3+US5).*

## Project Structure

### Documentation (this feature)

```text
specs/004-invitations-membership/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── invitations-membership-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by 002-accounts-authentication and 003-community-creation — no new top-level project.

```text
prisma/
└── schema.prisma                          # + Invitation model; + MembershipRole.MEMBER (new migration)

src/
├── server/
│   └── services/
│       └── invitationService.ts           # new: inviteToCommunity(), acceptInvitation(), revokeMembership(), requireCommunityAdministrator()
└── lib/
    └── auth/
        └── currentAccount.ts              # extended: getCurrentAccount() now attaches real memberships (research.md #7); toCurrentAccountPayload() gains an optional, default-[] second param

app/
├── communities/
│   └── [communityId]/
│       └── admin/
│           ├── page.tsx                   # new: administrator-only — invite form + member list + revoke action
│           └── InviteForm.tsx             # new: client component, mirrors OperatorCreateCommunityForm's pattern
├── invitations/
│   └── accept/
│       └── page.tsx                       # new: reads ?token=, shows accept confirmation or sign-in/up guidance
├── api/
│   ├── communities/
│   │   └── [communityId]/
│   │       ├── invitations/
│   │       │   └── route.ts               # new: POST — inviteToCommunity()
│   │       └── memberships/
│   │           └── [membershipId]/
│   │               └── route.ts           # new: DELETE — revokeMembership()
│   └── invitations/
│       └── accept/
│           └── route.ts                   # new: GET (invitation metadata) + POST — acceptInvitation()
└── page.tsx                                # extended: signed-in view lists real memberships (research.md #7), links administrators to their admin page

tests/
├── contract/
│   └── test_invitations_membership.ts     # new: inviteToCommunity()/acceptInvitation()/revokeMembership() red→green (FR-001–FR-013), including the last-admin guard (research.md #5)
├── unit/
│   └── test_current_account_memberships.ts # new: toCurrentAccountPayload()'s new optional memberships param, defaulting to [] (research.md #7)
└── integration/
    └── test_invitation_membership_flow.spec.ts  # new: Playwright — invite via admin page, accept via emailed link (both verified and sign-up-first paths), revoke via admin page, last-admin rejection
```

**Structure Decision**: `invitationService.ts` lives beside `communityService.ts`/`accountService.ts`/`sessionService.ts` in `src/server/services/`, reusing the same direct-Prisma, discriminated-union-result convention. New pages live under a new top-level `app/communities/` and `app/invitations/` route groups — the first end-user-facing, community-scoped UI in this codebase (003's `/operator` was deliberately non-end-user tooling; this is the feature that finally needs a real one). `getCurrentAccount()` is extended in place rather than duplicated, per research.md #7.

## Complexity Tracking

No Constitution Check violations were identified for this feature — table intentionally left empty.
