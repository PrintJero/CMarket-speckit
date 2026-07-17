# Implementation Plan: Community Creation & Founding Administrator

**Branch**: `003-community-creation` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-community-creation/spec.md`

## Summary

Add the sole bootstrap path by which a community comes into existence: an operator-invoked, non-networked script that, given a community name and the email of an existing, verified `Account`, atomically creates a `Community` row and exactly one `Membership` row (role `ADMINISTRATOR`) for that account, recording who invoked it and when. The script runs with direct Prisma/database access and is never reachable from the Next.js application (FR-002) — verified by a static test that fails if any file under `app/` imports the new service module. Non-existent or unverified target accounts are rejected with distinct, clear errors before any row is written; account credentials/verification state are never touched. The last-admin guard is *not* implemented here — this feature only makes it enforceable later (an enumerated, countable role), since no removal/demotion path exists yet to protect against (FR-010). Non-discoverability (FR-009) is proven with a second, unrelated account against real `Membership` rows — not against the founding administrator, and not against the existing session payload, which stays hardcoded-empty by design (FR-015) and is therefore no evidence either way for FR-009.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (existing project `tsconfig.json`), executed under Node.js v24 for the standalone script; no change to the Next.js app's own language/version.

**Primary Dependencies**: Prisma Client 6.19.3 (direct DB access, no new ORM); **new devDependency `tsx`** to execute the standalone TypeScript script without a build step (see research.md #1 and Complexity Tracking).

**Storage**: PostgreSQL via Prisma, same dev/test Docker containers already used by 002-accounts-authentication. New models: `Community`, `Membership`, enum `MembershipRole`.

**Testing**: Vitest only — `tests/contract/test_create_community.ts` (service-level, red-then-green, real Postgres test DB) and `tests/unit/` (name validation; the FR-002 static-import guard). No Playwright: this feature has no HTTP route, page, or browser-observable behavior for a browser test to exercise (see research.md #2). FR-009 (non-discoverability) is verified using **two** real accounts created in the test — a founder (A) and a genuinely unrelated second account (B) — by directly querying `prisma.membership` for B and asserting zero rows reference the new community; the existing `toCurrentAccountPayload()` session payload is deliberately **not** used as FR-009 evidence, because it is hardcoded to return an empty memberships list for every account regardless of real data (confirmed by reading `src/lib/auth/currentAccount.ts`) and so cannot distinguish a member from a non-member. That same hardcoded payload IS the correct (and only) thing to check for the separate FR-015 claim (the founder's own existing session view stays unchanged).

**Target Platform**: A repo-local operator script (`scripts/create-community.ts`) run from a shell with server/database access (e.g., against the production database via an operator's already-authorized access) — not deployed as, or reachable from, a running network service.

**Project Type**: Extension of the existing single Next.js/Prisma web project (no new top-level project, per Structure Decision below).

**Performance Goals**: None beyond correctness — operator-driven, low-volume, institutional onboarding (spec Assumptions), not a request-serving path.

**Constraints**: FR-002 (no network reachability) is the binding constraint on this feature's shape; FR-007 requires the community + membership write to be atomic (single Prisma transaction, mirroring the existing `consumeVerificationToken` interactive-transaction pattern from 002-accounts-authentication).

**Scale/Scope**: Bootstrap-only; expected on the order of tens of invocations over the product's lifetime, not per-user traffic.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Admin-Controlled Membership Origin | **PASS** | This feature *is* Principle I's documented bootstrap exception. Founding administrator MUST already exist with a verified email (FR-003/FR-004); tooling never creates accounts or bypasses verification (FR-005/FR-006). |
| II. Community Isolation | **PASS, verification corrected 2026-07-16** | Introduces `Community` as a first-class identifier from the start (data-model.md), per the constitution's tenancy constraint. FR-009 requires the new community to be invisible to every non-member account; this is now verified with a **second, genuinely unrelated account (B)**, checked against real `Membership` rows (direct Prisma query), not against the founding administrator (A) and not against the existing `currentAccount` session payload — that payload returns an empty list unconditionally for every account (hardcoded, confirmed by reading the source), so a check against it, or against A instead of B, would pass regardless of whether isolation actually held. An earlier version of this plan incorrectly cited that hardcoded payload, checked against A, as FR-009 evidence; see spec.md FR-009/FR-015 and quickstart.md Scenario 1 for the corrected split. |
| III. Administrator as Gatekeeper (last-admin guard) | **DEFERRED, not a violation** | The last-admin guard applies to actions that remove/demote an administrator; no such action exists anywhere in the codebase yet. This feature only ensures the data model doesn't foreclose enforcing it later (enumerated, countable `role` — FR-010). Full guard enforcement + its test are explicitly deferred to whichever future feature first builds removal/demotion, per spec.md's rewritten FR-010/SC-003. |
| IV. Non-Custodial Payments | N/A | Not touched. |
| V. Single Web App, PWA | N/A | This feature ships zero *end-user* UI or HTTP surface by design (FR-001/FR-002). **2026-07-17**: a development-only, disabled-by-default operator panel (`/operator`) was added per FR-016 — it is explicitly operator tooling, not a core end-user feature, so Principle V's mobile-viewport requirement does not apply to it; it MUST NOT be enabled in production, so it never reaches an end user regardless. |
| VI. Contact & Data Privacy Gating | N/A | No contact/personal data beyond the existing `Account.email` reference is introduced or exposed. |
| VII. Simplicity & MVP-First | **PASS, with justified additions** | One new devDependency (`tsx`) is added to run the script; justified in Complexity Tracking below. **2026-07-17**: the dev-only operator panel is a second justified complexity item, also in Complexity Tracking. Everything else reuses existing patterns (Prisma transactions, `assertEmailVerified`, discriminated-union service results). |
| VIII. Test Discipline for Critical Flows | **PASS** | This flow creates membership — a critical flow. `tests/contract/test_create_community.ts` and the FR-002 static-import guard MUST be written first and confirmed failing (red) before any implementation, per tasks.md. **2026-07-17**: the operator panel's route-handler tests (404-when-disabled, success, each failure reason) were likewise written and confirmed red before `app/api/operator/create-community/route.ts` existed. |

**Additional Constraints check**: Tenancy constraint satisfied (Community identifier introduced from the start, not retrofitted). Stack constraint satisfied (Next.js/Prisma/PostgreSQL/Docker unchanged; `tsx` is a dev-only script runner, not a stack deviation). Migrations & backups constraint: the new `Community`/`Membership`/`MembershipRole` schema change MUST ship as a versioned Prisma migration (tasks.md), never a manual DB edit. Access codes remain correctly out of scope.

*Re-checked after Phase 1 design: no new violations introduced by data-model.md or contracts/ — see end of this document.*

## Project Structure

### Documentation (this feature)

```text
specs/003-community-creation/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── community-creation.md
└── tasks.md             # Phase 2 output (/speckit-tasks command — not created by /speckit-plan)
```

### Source Code (repository root)

Extends the existing single Next.js/Prisma project established by `002-accounts-authentication` — no new top-level project or app is introduced.

```text
prisma/
└── schema.prisma                 # + Community, Membership models; + MembershipRole enum (new migration)

src/
├── server/
│   └── services/
│       └── communityService.ts   # new: createCommunity() — direct Prisma, atomic, no import from app/
└── lib/
    └── validation/
        └── communityName.ts      # new: blank/whitespace-only name check (FR-014)

scripts/
└── create-community.ts           # new: operator-invoked entry point (direct DB access only, FR-002)

tests/
├── contract/
│   └── test_create_community.ts             # new: createCommunity() red→green (FR-003/004/005/006/007/008/009/011/013/014/015)
│                                             #   FR-009 uses a second, unrelated account (B) + a real prisma.membership query — never A, never the hardcoded session payload
│                                             #   FR-015 is the one place the hardcoded toCurrentAccountPayload() check belongs (asserted on A)
└── unit/
    ├── test_community_name_validation.ts     # new (FR-014)
    └── test_community_creation_not_networked.ts  # new (FR-002 static-import guard)

README.md                          # + "Operations: Creating a community" section (FR-012)
```

**Structure Decision**: No new top-level project. `communityService.ts` lives beside the existing `accountService.ts`/`sessionService.ts`/`verificationService.ts` in `src/server/services/`, reusing the same direct-Prisma, discriminated-union-result convention. The operator entry point is a standalone script under a new top-level `scripts/` directory (not `app/`), which is exactly the boundary the FR-002 static-import test enforces. Documentation for FR-012 goes into the existing root `README.md` rather than a new `docs/` directory, since no such directory exists yet in this repo (Principle VII: don't introduce a new documentation convention for one paragraph).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New devDependency: `tsx` | `scripts/create-community.ts` must run standalone TypeScript with direct Prisma access, sharing the exact same `communityService.ts` module the tests exercise — no drift between what's tested and what operators run. | Node's built-in TS type-stripping (`--experimental-strip-types`) was rejected: its availability and exact semantics vary by Node version/flags across local machines and CI, an unacceptable portability risk for a script that must work reliably for whoever operates this tooling. `ts-node` was rejected: it requires additional loader/tsconfig configuration to cooperate with this project's `moduleResolution: "bundler"` + ESM setup, where `tsx` works with zero configuration — more moving parts for one small script. |
| Test-only: a hand-rolled TS-AST import-graph walk in `tests/unit/test_community_creation_not_networked.ts` (no new dependency — uses the `typescript` package already a devDependency) | A text/string search for FR-002's guard would miss an indirect import through a barrel/re-export and would false-positive on a mere comment; the guard needs to resolve the actual reachable-from-`app/` import graph to mean what it claims. | A dependency-graph tool (e.g. `madge`) was considered and rejected: it would be a second new devDependency for one boundary check, when the `typescript` compiler's own parser (already present) is sufficient for the statically-analyzable case this feature needs. One disclosed residual gap remains — dynamic/computed imports aren't resolved — recorded in the test file itself and in tasks.md rather than closed by a disproportionate bundler-grade analysis. |
| **2026-07-17: deliberate, disabled-by-default deviation from FR-002** — `app/operator/page.tsx` + `app/api/operator/create-community/route.ts` make `createCommunity()` reachable over the network, for local development only | Gives a fast, no-shell-access way to exercise `createCommunity()` during local development/demos, without an operator needing a terminal/DB client. | A production-grade operator panel (with its own separate operator-authentication system, as FR-002 requires for any interface meant to be reachable in a real deployment) was rejected for now — that is real, unrequested scope (a whole second auth system) this feature does not need to build today. Instead the route/page are inert (return 404) unless `OPERATOR_PANEL_ENABLED=true`, which the code, `.env.example`, and README all state MUST NOT be set in a real deployment; the gate is checked independently in both the page and the route handler (not only via middleware), so neither can be reached even if the other were somehow bypassed. `communityService.ts` itself is unchanged — this widens *reachability*, not the function's own guarantees. The FR-002 import-graph guard test is updated to allow exactly this one file and no other, so any further networked surface is still caught. |

### Post-implementation re-check (2026-07-17)

All tasks (T001–T020) complete. Re-verifying each Constitution Check row against the actual, finished implementation:

- **Principle I**: Confirmed — `createCommunity()` (`src/server/services/communityService.ts`) checks account existence then `assertEmailVerified()` before writing anything; never creates an `Account`; never touches its credentials (verified by `tests/contract/test_create_community.ts`).
- **Principle II**: Confirmed, with the corrected verification actually in place — `tests/contract/test_create_community.ts`'s FR-009 test creates a second, unrelated account and asserts zero real `Membership` rows for it via direct Prisma query; the separate FR-015 test asserts the founder's own `toCurrentAccountPayload()` is unchanged. Manually re-verified against the real dev database (not just the test database) during T019.
- **Principle III**: Confirmed still deferred, not violated — `MembershipRole` is a real Postgres enum with a single `ADMINISTRATOR` value; no removal/demotion code path exists anywhere in the codebase to violate the last-admin guard.
- **Principle VII**: The `tsx` addition is exactly as scoped. One additional, disclosed complexity item is recorded above (the AST-based import-graph guard) — it added no new dependency and stayed test-only.
- **Principle VIII**: Confirmed via the actual implementation session — every test file was run and observed to fail (module-not-found / assertion failures) before its corresponding implementation was written, for T003/T004 (Foundational), T006–T008 (service layer, all confirmed red together before the single T009 implementation), and T010/T012/T014 (CLI layer, confirmed red before T011).

No new violations were introduced beyond what's recorded in this table. The Constitution Check stands as **PASS**.
