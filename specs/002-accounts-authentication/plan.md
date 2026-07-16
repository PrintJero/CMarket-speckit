# Implementation Plan: Accounts and Authentication

**Branch**: `002-accounts-authentication` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-accounts-authentication/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Anyone can create a self-service CMarket account (email/password or Google), which starts with zero community memberships and grants zero visibility into any community. Email/password accounts require verifying the email before their holder can accept a community invitation; Google accounts inherit verification from the provider. Technical approach: a single Next.js (App Router) application using Auth.js with a Credentials provider (Argon2id-hashed passwords) and a Google OAuth provider sharing one `Account` record per person, database-backed sessions via the Prisma adapter (so sign-out is an immediate, server-verifiable revocation), and a hashed single-use verification-token table gating invitation acceptance.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS, Next.js (App Router)

**Primary Dependencies**: Next.js, Prisma ORM, Auth.js (NextAuth) with Credentials + Google providers and Prisma adapter, Argon2id hashing library (see research.md #1)

**Storage**: PostgreSQL via Prisma, migrated exclusively through versioned Prisma migrations (constitution "Migrations & backups" constraint)

**Testing**: Vitest (unit/contract) + Playwright (integration/e2e) — see research.md #6

**Target Platform**: Web, installable as a PWA, containerized via Docker and deployed via Dokploy (constitution "Stack (decided)")

**Project Type**: Single full-stack web application (Next.js App Router handles both UI and API routes/server actions) — no separate frontend/backend or native mobile client, per Constitution Principle V

**Performance Goals**: SC-001 (email/password signup reaches "check your email" in <1 minute), SC-002 (Google signup usable in <30 seconds); otherwise standard interactive web-app latency, no specified high-throughput target

**Constraints**: Zero plaintext password storage or comparison (FR-011/FR-012); sign-out MUST immediately revoke server-side access (Story 2 scenario 3); zero-membership accounts MUST NOT expose any community data or existence (FR-003/FR-013)

**Scale/Scope**: MVP scale consistent with a single-community-marketplace launch; no explicit concurrent-user target in the spec

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / Constraint | Applies? | Assessment |
|---|---|---|
| I. Admin-Controlled Membership Origin (NON-NEGOTIABLE) | Yes | This feature implements the account half of Principle I directly: self-service, invitation-free account creation; zero memberships grants zero access; email verification is the required precondition before this account can be used to redeem an administrator-issued invitation credential. No self-service join path to any community is introduced. **PASS** |
| II. Community Isolation | No | No community data is read or written by this feature; zero-membership accounts trivially see nothing. **PASS (not applicable)** |
| III. Administrator as Community Gatekeeper | No | Not touched. |
| IV. Non-Custodial Payments | No | Not touched. |
| V. Single Web Application, Installable as PWA | Yes | Built as part of the single Next.js PWA; sign-up/sign-in/verify flows MUST be fully usable in a mobile viewport. **PASS** |
| VI. Contact & Data Privacy Gating | No | No contact data is exchanged between two users by this feature. |
| VII. Simplicity & MVP-First | Yes | Scope intentionally excludes profiles, password recovery, 2FA, account deletion, global roles (per spec's Out of Scope) — no speculative extensions added. **PASS** |
| VIII. Test Discipline for Critical Flows (NON-NEGOTIABLE) | Yes | Registration and sign-in/sign-out are explicitly listed critical flows. Tests MUST be written first, fail first, and CI MUST block merge on failure. Reflected in Project Structure (tests/ tree) and MUST be honored by `/speckit-tasks` task ordering. **PASS, with obligation carried into tasks.md** |
| Additional Constraint: Stack (decided) | Yes | Uses Next.js, Prisma, PostgreSQL, Docker/Dokploy exactly as decided; no deviation. **PASS** |
| Additional Constraint: Migrations & backups | Yes | All schema changes (Account, AuthIdentity, Session, VerificationToken) go through versioned Prisma migrations. **PASS** |
| Additional Constraint: Tenancy | Partial | Account is intentionally global/tenant-less by design (Principle I); this is the correct model, not a violation — community scoping begins at the Membership boundary, which this feature does not own. **PASS** |

No violations identified; Complexity Tracking table is not needed.

**Post-Phase-1 re-check**: data-model.md and contracts/auth-api.md were reviewed against the same table above after design — no new violations introduced (e.g., `AuthIdentity` and `VerificationToken` are additive tables scoped to Account, not to any community). **PASS.**

**Security amendment re-check (2026-07-16)**: Original FR-015 auto-linked Google to any matching pre-existing password account "verified or not," while preserving that account's password credential either way. This directly weakened Principle I's identity-binding guarantee — a credential set up before any proof of email ownership (an unverified signup) was being treated as trustworthy indefinitely, letting an attacker who registers and never verifies a victim's email retain silent password access after the real owner arrives via Google. Spec split into FR-015 (verified pre-existing account: link, preserve credential — unchanged) and FR-018 (unverified pre-existing account: link, verify, but discard the password credential, revoke all sessions, invalidate pending verification tokens). This restores Principle I's guarantee without reintroducing the rejected alternative (rejecting the link outright, which would let the same attacker permanently lock the real owner out). **PASS** — re-affirmed against Principle I specifically; no other principle affected.

**Security amendment #2 re-check (2026-07-16)**: The #1 fix above only closed the Google-auto-link path; the identical root cause — a credential attached to an Account before anyone proved ownership of its email — remained fully exploitable purely within the email/password flow (an attacker registers a victim's email; the real owner's own later sign-up and verification-link click ends up verifying the attacker's leftover credential, since the real owner's submitted password was silently discarded while their verification click still went through). New FR-019/FR-020 move the candidate credential onto the `VerificationToken` itself, applying it to the `Account` only at consumption and only if still unverified at that moment. This is a stronger, structural restoration of Principle I's identity-binding guarantee than #1's, since it removes the vulnerable state (a credential on an unverified `Account`) entirely rather than just cleaning it up after the fact on one specific path (Google linking). FR-018 is correspondingly narrowed to a defense-in-depth role. **PASS** — re-affirmed against Principle I; no other principle affected.

**Security amendment #3 re-check (2026-07-16)**: The #2 fix's own mechanism — invalidating a prior pending token when issuing a new one — was itself a Principle I defect: it made "whichever sign-up call happens last" control which credential could ever be applied, letting an attacker destroy the real owner's own live token purely by calling sign-up again, with no need to win any race the real owner could otherwise have won by acting first. Revised FR-019 removes the destructive invalidation for competing sign-ups (multiple pending tokens now coexist, each independent); revised FR-020 makes first-consumption-wins concrete by invalidating every sibling token the moment one of them verifies the account. New FR-021 (per-email rate limiting) closes the amplifier that made repeated destructive/competing sign-up attempts cheap in the first place, correcting the prior Assumption that rate-limiting was out of scope. New FR-022 closes a related, narrower lockout risk (a null-candidate token verifying a credential-less account permanently). Acknowledged and not claimed to be fixed: a race between an attacker's and the real owner's own click of their respective tokens is still won by whoever consumes first — this is inherent to any first-click email-link verification scheme, not a gap introduced or left open by this feature's own design choices. **PASS** — re-affirmed against Principle I; no other principle affected.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
prisma/
├── schema.prisma        # Account, AuthIdentity, Session, VerificationToken (data-model.md)
└── migrations/

app/
├── (auth)/
│   ├── sign-up/
│   ├── sign-in/
│   └── verify-email/
└── api/
    └── auth/
        ├── sign-up/route.ts
        ├── verify-email/route.ts
        ├── resend-verification/route.ts
        └── [...nextauth]/route.ts   # Auth.js: Credentials + Google, sign-in/out

src/
├── lib/
│   ├── auth/            # Auth.js config, Argon2id hashing, session helpers
│   ├── email/           # verification email sending (provider-agnostic)
│   └── validation/      # password policy, email normalization/matching
└── server/
    └── services/
        └── accountService.ts   # sign-up, verification, Google auto-link logic

tests/
├── contract/            # API route request/response contracts (contracts/auth-api.md)
├── integration/         # Playwright: full sign-up/verify/sign-in/sign-out/Google flows
└── unit/                # password policy, email matching, token expiry logic
```

**Structure Decision**: Single Next.js (App Router) application at the repository root — no separate `backend/`/`frontend`/mobile split — per Constitution Principle V (single web app, PWA-installable, no native client) and the decided stack (Next.js, Prisma, PostgreSQL). Tests follow Constitution Principle VIII: written first under `tests/contract` and `tests/unit` (Vitest) and `tests/integration` (Playwright), and must fail before implementation begins.

## Complexity Tracking

No Constitution Check violations were identified for this feature — table intentionally left empty.
