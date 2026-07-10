# Implementation Plan: Community Invitations

**Branch**: `001-community-invitations` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-community-invitations/spec.md`

## Summary

Administrators invite prospective members to their community by email or
phone; invited contacts receive a notification and can accept or decline.
There is no self-service join path. Accepting grants immediate marketplace
access (view/list/buy) scoped to that community; declining, cancelling (by
the admin), or automatic expiration (default 7 days, configurable) all
close the invitation without granting access. Administrators can revoke an
existing member's access at any time. A single Node.js/Express + PostgreSQL
(via Prisma) backend is the sole owner of this business logic; the Next.js
web app and the Expo/React Native mobile app are both thin REST clients of
that same backend and database — no invitation/membership logic is
duplicated in either client.

## Technical Context

**Language/Version**: TypeScript on Node.js 20 LTS (backend, shared across API); TypeScript for both React (Next.js) web and React Native (Expo) clients

**Primary Dependencies**: Express (API), Prisma ORM + PostgreSQL driver, `jsonwebtoken` (JWT auth), existing email-sending service (invoked as an internal service call, not owned by this feature), Next.js (web), React Native + Expo (mobile)

**Storage**: PostgreSQL, accessed exclusively through Prisma from the backend; no client accesses the database directly

**Testing**: Jest + Supertest for backend contract/integration tests (mandatory for this feature under Constitution Principle VIII — critical flow); Jest + React Testing Library for the Next.js web accept/decline and admin-invite screens; Jest + React Native Testing Library for the equivalent Expo screens

**Target Platform**: Linux server (backend API), modern browsers (Next.js web), iOS/Android via Expo (mobile)

**Project Type**: Web + mobile application sharing one backend API (three deliverables: `backend/`, `web/`, `mobile/`)

**Performance Goals**: Invitation create/accept/decline/cancel/revoke requests complete within 500ms p95 under normal load; no feature-specific high-throughput requirement stated

**Constraints**: All community-scoped data access MUST filter by community membership (Constitution Principle II); admin-only actions MUST be authorized against the specific community being acted on (Constitution Principle III); JWT-based authentication for all three clients; no payment processing in scope (Constitution Principle IV — not applicable to this feature)

**Scale/Scope**: MVP scale — this feature covers only the invitation/membership lifecycle (invite, accept, decline, cancel, revoke, expire) for the community model already defined in the spec; no numeric user/community scale target was specified, so standard small-to-mid marketplace scale is assumed

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Community-Gated Access, NON-NEGOTIABLE)**: PASS. The API surface exposes no "request to join" or "apply" endpoint of any kind — the only way a Membership record is created is via an administrator-issued Invitation being accepted. Enforced by omission (no such route exists) and confirmed by contract tests asserting invite-only creation.
- **Principle II (Community Isolation, NON-NEGOTIABLE)**: PASS, contingent on implementation discipline. Every Prisma query for invitations, memberships, and (later) listings MUST be scoped by `communityId` plus the requester's membership/admin record in that community; this is captured as a required middleware pattern in research.md and enforced via contract tests that assert cross-community 403/404s.
- **Principle III (Administrator as Community Gatekeeper)**: PASS. Invite-create, invite-cancel, and member-revoke endpoints all require the caller to hold an ADMIN-role, ACTIVE membership in the target community; verified via authorization middleware and covered by tests.
- **Principle IV (No In-App Payment Processing)**: N/A for this feature — no payment or transaction logging is touched here.
- **Principle V (Web/Mobile Parity)**: PASS, tracked. "Joining a community" (invitee accept/decline) and the admin-side moderation actions (invite, cancel, revoke) are core features under this principle and MUST ship with equivalent functionality on both the Next.js web app and the Expo mobile app before this feature is considered complete; both consume the identical REST contract in `contracts/`, which is what keeps them equivalent by construction.
- **Principle VI (Contact & Data Privacy Gating)**: PASS. The contact info an administrator enters is used only to address the invitation notification and is never exposed to other community members; no buyer/seller contact-exchange flow is part of this feature.
- **Principle VII (Simplicity & MVP-First)**: PASS. Invitation expiration is computed lazily from `expiresAt` rather than via a background sweep/cron job, avoiding an unrequested scheduling subsystem. No admin-configurable-expiration UI is built beyond what FR-016 requires (a per-community override value).
- **Principle VIII (Test Discipline for Critical Flows)**: PASS, binding. Membership invitation/acceptance is one of the four named critical flows — contract and integration tests for invite/accept/decline/cancel/revoke/expire are mandatory and MUST be written before their implementation, regardless of this being a "tests optional" project by default.

No violations requiring Complexity Tracking justification.

**Post-Phase 1 re-check**: Confirmed against the artifacts actually
produced — `data-model.md`'s `communityId`-scoped entities and
`ADMIN`/`ACTIVE`-membership authorization rule (Principles II, III),
`contracts/invitations-api.yaml`'s single shared REST contract for both
clients (Principle V), and `research.md`'s lazy-expiration decision
(Principle VII) — no new violations introduced during design.

## Project Structure

### Documentation (this feature)

```text
specs/001-community-invitations/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   └── schema.prisma          # Community, Membership, Invitation, User models
├── src/
│   ├── models/                # Prisma client wrapper / repository helpers
│   ├── services/              # invitation-service, membership-service (business logic)
│   ├── api/                   # Express routers/controllers for invitations & members
│   ├── middleware/             # JWT auth, community-scoped authorization
│   └── integrations/           # existing email-sending service client wrapper
└── tests/
    ├── contract/                # request/response contract tests per endpoint
    ├── integration/             # end-to-end invite→accept/decline/cancel/revoke/expire flows
    └── unit/                    # service-level logic (e.g., expiration computation)

web/                            # Next.js
├── src/
│   ├── components/              # invite form, invite list, accept/decline screens
│   ├── pages/                    # community admin pages, invitee response page
│   └── services/                 # typed REST client for the contracts/ API
└── tests/

mobile/                          # React Native + Expo
├── src/
│   ├── components/
│   ├── screens/                  # equivalent invite/accept/decline/revoke screens
│   └── services/                 # same REST client shape as web, consuming contracts/ API
└── tests/
```

**Structure Decision**: Three-deliverable structure (`backend/`, `web/`, `mobile/`) reflecting the user-specified stack: one Express + Prisma + PostgreSQL backend as the single source of truth for invitation/membership business logic, with the Next.js web app and Expo mobile app both as thin REST clients against the same `contracts/` API — satisfying the "no duplicated business logic between web and mobile" requirement without introducing a shared-code monorepo package, which would be more machinery than this feature needs (Constitution Principle VII).

## Complexity Tracking

*No Constitution Check violations — table intentionally omitted.*
