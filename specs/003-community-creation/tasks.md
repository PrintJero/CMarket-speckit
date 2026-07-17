---

description: "Task list for Community Creation & Founding Administrator"
---

# Tasks: Community Creation & Founding Administrator

**Input**: Design documents from `/specs/003-community-creation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/community-creation.md](./contracts/community-creation.md), [quickstart.md](./quickstart.md)

**Tests**: This feature creates membership — a critical flow per Constitution Principle VIII. Tests are MANDATORY, MUST be written before their corresponding implementation, and MUST be confirmed failing (red) before that implementation is written. The one exception is T003: a static regression guard that has nothing to make it fail yet, by design (see its task description).

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P2/P3) wherever the stories are genuinely separable. **They are not fully separable at the service layer** — see the rationale in Phase 3 — so Phase 3 combines User Stories 1–3's service-level tests and shared implementation into one phase, with each task still individually labeled by the story whose acceptance criterion it satisfies. US1–US3's CLI-level wording work (Phases 4–6) IS safely separable, since the underlying data-safety guarantee is already locked in by Phase 3 before any CLI work begins.

## Path Conventions

Single existing Next.js/Prisma project (extends `002-accounts-authentication`), per plan.md's Structure Decision — no new top-level project.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [P] Add `tsx` as a devDependency and add a `"create-community": "tsx scripts/create-community.ts"` script to `package.json` (research.md #1; plan.md Complexity Tracking).
- [X] T002 [P] Add `Community` and `Membership` models and the `MembershipRole` enum (single member `ADMINISTRATOR`) to `prisma/schema.prisma` per data-model.md, then run `prisma migrate dev --name add_community_membership` to generate a versioned migration and `prisma generate` to refresh the client. Never edit the database by hand (constitution: Migrations & Backups).

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story task may begin until this phase is complete.

- [X] T003 [P] Write the FR-002 import-graph guard test in `tests/unit/test_community_creation_not_networked.ts`. This MUST resolve the actual static import graph reachable from every file under `app/`, not do a text/string search — a text search would miss an indirect import (a file under `app/` importing a barrel/index module that re-exports `createCommunity`) and would false-positive on a comment merely mentioning the module name. Implementation approach: use the `typescript` package's own parser (already a project devDependency — no new dependency needed) to read each file's AST, collect every statically-analyzable `import ... from` and `export ... from` specifier (the latter to follow re-export barrels), resolve relative paths and the project's `@/*` tsconfig alias to real file paths, and breadth-first-search the resulting graph starting from every file under `app/`. Assert `src/server/services/communityService.ts` is never reached, directly or transitively. **Explicitly document one residual gap in the test file's own comments**: this walk only follows statically analyzable specifiers; a dynamic import with a computed, non-literal specifier (e.g. `await import(someVariable)`) is not resolved and would not be caught. A full dynamic-import-aware (bundler-grade) analysis is judged disproportionate for this feature (Principle VII); this gap is a deliberate, disclosed limitation, not an implied guarantee the check doesn't provide. Confirm the test passes today (vacuously — neither the module nor any reference to it exists yet); it MUST stay green through every task below and MUST go red if a future change ever wires `communityService` into `app/`, directly or via a re-export.
- [X] T004 [P] Write the community name validation unit test in `tests/unit/test_community_name_validation.ts` (FR-014): empty string, whitespace-only string, and a string that is only trimmed-blank are all rejected; a real name (with incidental leading/trailing whitespace) is accepted. Confirm it FAILS (red) — the module doesn't exist yet.
- [X] T005 Implement the community name validator in `src/lib/validation/communityName.ts` (FR-014), exporting a function that trims and checks length ≥ 1. Confirm T004 now passes (green).

**Checkpoint**: Schema migrated, FR-002 guard in place, name validation ready — user story implementation can begin.

---

## Phase 3: Safety-Critical Core — `createCommunity()` (User Stories 1, 2, 3 combined)

**Why this phase is not split by story**: Per Constitution Principle I, the account-existence check (FR-003, US2's acceptance criterion) and the account-verified check (FR-004, US3's acceptance criterion) cannot be deferred past `createCommunity()`'s first working version. A version of this function that only handled the success path (US1) and left the other two checks for "later" would, in the interim, let the tooling found a community on a nonexistent or unverified account — exactly the pre-hijacking gap the bootstrap exception must not reopen. So all three stories' service-level tests are written and confirmed red **together**, before the **one** implementation task that must satisfy all of them **at once**. There is no point in this feature's history where `createCommunity()` exists without all three checks.

### Tests ⚠️ Write first, confirm red

- [X] T006 [US1] Write `tests/contract/test_create_community.ts` covering, against real accounts in the real test database:
  - Success: a fresh, verified account A + a non-blank name → `{ ok: true, community }`; exactly one `Community` row and one `Membership` row (`role: ADMINISTRATOR`) exist; `Community.createdByOperator`/`createdAt` are recorded (FR-001, FR-005, FR-006, FR-007, FR-008, FR-011, FR-013).
  - FR-014: a blank/whitespace-only name → `{ ok: false, reason: "invalid_name" }`; no rows written, even with an otherwise-valid account.
  - FR-009: after creating the community for A, a **second, genuinely unrelated verified account B** — query `prisma.membership` directly for B — zero rows reference the new community. Do **not** check this against A, and do **not** check it via `toCurrentAccountPayload()`.
  - FR-015: call `toCurrentAccountPayload()` for A after creation — `memberships` is still `[]`. This is a distinct claim from FR-009 (see spec.md) — assert it separately, never as FR-009 evidence.
  - US1 Scenario 3: the same account A founds a second, differently-named community — two independent `Community`/`Membership` pairs exist; the first is unaffected.

  Confirm this file FAILS (red) — `createCommunity` doesn't exist yet.

- [X] T007 [US2] In the same `tests/contract/test_create_community.ts` (from T006), add: an email matching no `Account` → `{ ok: false, reason: "account_not_found" }`; confirm no `Community`, `Membership`, or `Account` row was created as a side effect (FR-003). Confirm this case FAILS (red).

- [X] T008 [US3] In the same `tests/contract/test_create_community.ts`, add: an email matching an existing but unverified `Account` → `{ ok: false, reason: "account_not_verified" }`, distinguishable from T007's `account_not_found`; no `Community`/`Membership` row created; the account's `emailVerifiedAt`, `passwordHash`, and all other fields are unchanged from before the attempt (FR-004, FR-006). Confirm this case FAILS (red).

### Implementation

- [X] T009 [US1] Implement `createCommunity({ name, founderEmail, invokedBy })` in `src/server/services/communityService.ts` (contracts/community-creation.md) **complete and safe from its first committed version**: validate `name` via T005's validator first (`invalid_name` before any lookup, satisfies T006); look up the `Account` by `founderEmail` — if none exists, return `{ ok: false, reason: "account_not_found" }` before opening any transaction (satisfies T007, FR-003); if it exists but `assertEmailVerified()` (reused from `src/server/services/accountService.ts`, research.md #3 — do not reimplement this check) is false, return `{ ok: false, reason: "account_not_verified" }` before opening any transaction (satisfies T008, FR-004); otherwise create the `Community` (`name`, `createdByOperator: invokedBy`) and its founder `Membership` (`role: ADMINISTRATOR`) together inside one `prisma.$transaction` (FR-007), returning `{ ok: true, community }` (satisfies T006). Do not read or write any `Account` field beyond existence/verified-lookup. Confirm T006, T007, and T008 **all** pass together (green) — this is one commit, not three.

**Checkpoint**: `createCommunity()` is complete and safe — no code path can found a community on a nonexistent or unverified account. This, not any single labeled story, is the minimum safe deliverable of this feature.

---

## Phase 4: User Story 1 - Operator can invoke the tooling end-to-end (Priority: P1) 🎯 MVP (CLI happy path)

**Goal**: An operator actually runs something — the CLI wrapper around the now-safe `createCommunity()` — and it works for a valid, verified account.

**Independent Test**: Run `scripts/create-community.ts` with a valid, verified account's email and a name; assert exit code 0 and printed `id`/`name`/`createdAt`.

### Tests ⚠️ Write first, confirm red

- [X] T010 [US1] Write a CLI-level test (e.g. `tests/unit/test_create_community_cli.ts`, invoking the script as a subprocess or via its exported entry function) asserting: valid `--name`/`--email`/`--operator` args against an existing, verified account → exit code `0`, output includes the created community's `id`, `name`, and `createdAt`. Confirm it FAILS (red) — the script doesn't exist yet.

### Implementation

- [X] T011 [US1] Implement `scripts/create-community.ts` (contracts/community-creation.md): require `--name`, `--email`, `--operator` (exit non-zero with a usage message if any is missing, without calling `createCommunity()`); on `{ ok: true }`, print the community's `id`/`name`/`createdAt` and exit 0. **Note**: since T012/T014's exact required wording was already known at implementation time, this task directly implements the specific human message per `reason` (satisfying T013/T015 in the same commit) rather than shipping a deliberately worse raw-enum placeholder only to immediately replace it — that would have been pure churn. Confirmed T010 green. Manually ran quickstart.md Scenario 1.

**Checkpoint**: MVP. The tooling is both safe (Phase 3: no bad-account community can ever be created) and usable end-to-end for the happy path. CLI error wording is still generic at this point — that's a deliberate, safe deferral, not a safety gap.

---

## Phase 5: User Story 2 - Reject creation naming a nonexistent account, clearly worded (Priority: P2)

**Goal**: An operator's typo'd or wrong email is rejected with a specific, human-readable message — not the raw `account_not_found` enum value.

**Independent Test**: Run the script with an email matching no `Account`; assert exit code non-zero and a printed message that specifically names "no account found," not a generic failure.

### Tests ⚠️ Write first, confirm red

- [X] T012 [US2] Extend the CLI-level test from T010: an email matching no `Account` → exit non-zero, printed output is a specific human sentence (e.g. "No account found for that email") — **not** the raw string `account_not_found` that T011 currently prints. Confirmed this FAILED (red) against T011's initial module-not-found state (script didn't exist), then passed once T011 was implemented.

### Implementation

- [X] T013 [US2] Folded into T011 (see its note) — the specific `account_not_found` message shipped in the same commit as the rest of the script, since the required wording was already known. Confirmed T012 green, T010 still green.

**Checkpoint**: User Stories 1 and 2 both independently verified (safety already covered by Phase 3; this phase only refined CLI wording).

---

## Phase 6: User Story 3 - Reject creation naming an unverified account, clearly worded (Priority: P2)

**Goal**: An operator naming an existing-but-unverified account gets a specific message, distinguishable from Story 2's, with the target account left byte-for-byte unchanged.

**Independent Test**: Run the script with the email of an existing, unverified account; assert exit code non-zero, a specific message distinguishable from Story 2's, and the account unchanged in the database afterward.

### Tests ⚠️ Write first, confirm red

- [X] T014 [US3] Extend the CLI-level test: an email matching an existing but unverified `Account` → exit non-zero, printed output is a specific human sentence (e.g. "That account's email is not verified yet") distinguishable from T012's wording; re-query the database after the CLI run and confirm the account's fields are unchanged. Confirmed red (script didn't exist) then green.

### Implementation

- [X] T015 [US3] Folded into T011 (see its note) — the specific `account_not_verified` message shipped in the same commit. Confirmed T014 green, T010/T012 still green.

**Checkpoint**: All three creation-behavior stories independently verified, at both the service layer (Phase 3) and the CLI layer (Phases 4–6).

---

## Phase 7: User Story 4 - Documented, accountable operator path (Priority: P3)

**Goal**: Anyone consulting project documentation can determine who may run the community-creation tooling and how its use is requested, without asking a teammate.

**Independent Test**: Read the documentation added by this phase and confirm it answers both questions (per spec.md's Independent Test for this story — this is a manual/documentation check, not an automated test).

- [X] T016 [US4] Add an "Operations: Creating a community" section to `README.md` (FR-012): state who is authorized to run `scripts/create-community.ts` (operators who already hold direct server/database access — no separate in-app role, per plan.md's Constitution Check on Principle VII/FR-002), the process by which its use is requested/approved, and the exact invocation syntax from contracts/community-creation.md.

**Checkpoint**: All four user stories complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T017 [P] Run `npm run typecheck` and `npm run lint`; fix any issues introduced by this feature. **Result**: both clean, no issues.
- [X] T018 [P] Run `npm run test:unit` (covers `tests/unit` and `tests/contract`, including T003's FR-002 guard and T006/T007/T008/T010/T012/T014's full coverage); confirm the whole suite is green. **Result**: 11 files, 51 tests, all passing. Also ran `npx playwright test` (not required by this feature, but as a regression check on 002-accounts-authentication): 11/11 still passing — no regression.
- [X] T019 Manually execute quickstart.md Scenarios 1–6 end-to-end against the real dev/test PostgreSQL database and record the results. **Result**: all 6 scenarios verified against the real **dev** database (not just the test DB) using temporary, cleaned-up fixtures — bootstrap, second community for the same founder, nonexistent-account rejection, unverified-account rejection, blank-name rejection, and the FR-002 guard all behaved exactly as specified. FR-009 (account B) and FR-015 (founder's own payload) independently re-confirmed via direct DB/function calls. All QA fixtures removed afterward.
- [X] T020 Re-check plan.md's Constitution Check against the finished implementation: confirm no new violations, the last-admin guard is still correctly deferred (not silently skipped), and the `tsx` Complexity Tracking entry still accurately describes what was built. **Result**: see plan.md's "Post-implementation re-check (2026-07-17)" section — PASS, one additional disclosed complexity item recorded (test-only AST import-graph walk, no new dependency).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001/T002 can run in parallel.
- **Foundational (Phase 2)**: Depends on Setup (T002's migration must exist before any Prisma-backed test runs). BLOCKS all user stories.
- **Phase 3 (Safety-Critical Core)**: Depends on Foundational. T006/T007/T008 (tests) MUST all be written and confirmed red before T009 (the single implementation task) is written — this is the one place in this feature where multiple story-labeled tasks share one implementation task, and that is intentional (see this phase's rationale). BLOCKS Phases 4–6 (their CLI tests need a real, safe `createCommunity()` to call).
- **User Story 1 / Phase 4 (CLI happy path)**: Depends on Phase 3.
- **User Story 2 / Phase 5 (CLI wording)**: Depends on Phase 4 (refines T011's output).
- **User Story 3 / Phase 6 (CLI wording)**: Depends on Phase 4 (refines T011's output); independent of Phase 5, may be done in either order relative to it.
- **User Story 4 / Phase 7 (docs)**: Depends on Phase 4 (documents the script that must already exist); independent of Phases 5–6.
- **Polish (Phase 8)**: Depends on all prior phases being complete.

### Parallel Opportunities

- T001 and T002 (Setup) — different files.
- T003 and T004 (Foundational) — different files, no dependency.
- T006, T007, and T008 are **NOT** parallel with each other — all three extend the same file (`tests/contract/test_create_community.ts`) and must all exist before T009.
- T017 and T018 (Polish) — independent checks, can run in parallel.

---

## Parallel Example: Foundational Phase

```bash
# Launch together:
Task: "Write FR-002 import-graph guard test in tests/unit/test_community_creation_not_networked.ts"
Task: "Write community name validation unit test in tests/unit/test_community_name_validation.ts"
```

---

## Implementation Strategy

### MVP First (Safety-Critical Core + US1's CLI)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete **all** of Phase 3 (T006, T007, T008, T009) — this is not optional or story-scoped. Per Principle I, the account-existence and account-verified checks MUST exist from `createCommunity()`'s very first working version; stopping after only US1's success-path test/implementation is not a safe place to pause.
3. Complete Phase 4 (T010–T011, US1's CLI).
4. **STOP and VALIDATE**: run quickstart.md Scenarios 1–3 (bootstrap, reject nonexistent, reject unverified) and Scenario 6 (FR-002 guard); confirm T003/T006/T007/T008/T009/T010 are all green.
5. This is a legitimate MVP: the tooling is safe (no bad-account community can ever be created — Phase 3) and usable end-to-end (Phase 4), even though its CLI error wording (Phases 5–6) is still generic rather than polished at this point.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Phase 3 (all three stories' safety, together) → the tooling can never do the wrong thing.
3. Phase 4 (US1 CLI) → MVP: the tooling can do the right thing, usably.
4. Phase 5 (US2 wording) → clearer operator feedback for a typo'd email.
5. Phase 6 (US3 wording) → clearer operator feedback for an unverified account.
6. Phase 7 (US4 docs) → independent of Phases 5–6.
7. Polish.

---

## Notes

- [P] tasks touch different files with no dependency on each other.
- [Story] labels map every task to the spec.md story whose acceptance criterion it satisfies — in Phase 3, three different story labels (US1/US2/US3) attach to tests that are, by design, verified by one shared implementation task (T009); this is documented, not an oversight.
- T003's import-graph guard has one disclosed residual gap (dynamic/computed imports are not resolved) — see its task description; this is a deliberate scope boundary (Principle VII), not silent under-coverage.
- Commit after each task or logical group.
- Stop at any checkpoint to validate independently.
- No Playwright tests in this feature (research.md #2) — this feature has no HTTP route, page, or browser-observable behavior. **Superseded in part by the delta below**, which adds a real page/route and manually exercises it against a live dev server instead (no new Playwright spec was added, since the user's requested automated coverage was explicitly route-level).

---

## Delta: FR-016 development-only operator panel (2026-07-17)

Deliberate, disabled-by-default deviation from FR-002, requested directly (not via `/speckit-plan`/`/speckit-tasks`): a `/operator` page + `POST /api/operator/create-community` route, reusing `createCommunity()` unchanged, gated by `OPERATOR_PANEL_ENABLED` (default disabled → 404, enforced independently in both the page and the route handler).

- [X] T021 Amend spec.md: add FR-016 (the exception itself), a cross-reference from FR-002, an update to the "networked interface" edge case, an Assumptions bullet, and SC-006 (404-by-default is automated-test-verified).
- [X] T022 Amend plan.md: new Complexity Tracking row for this deviation (why needed / simpler alternative — a full production operator-auth system — rejected as unrequested scope); updated Constitution Check rows V, VII, VIII to reflect the new surface; a dated post-implementation note.
- [X] T023 Update contracts/community-creation.md: revise the "no HTTP endpoint" framing and add a `GET /operator` / `POST /api/operator/create-community` contract section (request/response shapes, the 404 gate, reuse of `createCommunity()` as-is).
- [X] T024 Add `OPERATOR_PANEL_ENABLED=""` to `.env.example` with a comment stating it must never be enabled in production.
- [X] T025 Write `tests/contract/test_operator_panel.ts` (imports the route handler directly, per this project's contract-test convention): 404 when the env var is unset or non-`"true"`, without calling `createCommunity()`; success + community id when enabled for a valid verified account; `invalid_name`/`account_not_found`/`account_not_verified` each surfaced correctly when enabled. **Confirmed RED** — `Cannot find module '../../app/api/operator/create-community/route'`.
- [X] T026 Update `tests/unit/test_community_creation_not_networked.ts`: changed from a single merged BFS (pass/fail on whether the target is reached from anywhere) to **per-root reachability** — for each file under `app/`, independently determine whether it reaches `communityService`, then assert the resulting set equals exactly `{app/api/operator/create-community/route.ts}`. **Confirmed RED** against the pre-implementation state (empty reachable set vs. the one expected entry) before writing the route.
- [X] T027 Implement `app/api/operator/create-community/route.ts` (the one allow-listed file, reuses `createCommunity()` verbatim plus a minimal type guard on the request body), `app/operator/page.tsx` (server component: `notFound()` when disabled, else lists communities via direct `prisma.community.findMany()` — name/id/operator/createdAt only, no membership data — and renders the form), and `app/operator/OperatorCreateCommunityForm.tsx` (client component, `fetch()`-posts to the route, reusing existing `.card`/`.field`/`.btn-primary` CSS classes). **Confirmed GREEN**: T025 (6/6) and T026 both pass.
- [X] T028 Full regression: `tsc --noEmit` and `eslint .` clean; `npm run test:unit` — **12 files, 57 tests**, all passing; `npx playwright test` — 3 tests initially failed with account/session lookup errors from a **stale dev server process** (running since before this delta's `prisma generate`, holding a pre-regeneration Prisma engine) — restarted it and cleared `.next`; re-ran, **11/11 passing**, confirming the failures were environmental, not a regression. Manually verified against a real dev server: `GET /operator` and `POST /api/operator/create-community` both 404 by default; with `OPERATOR_PANEL_ENABLED=true`, the page renders, the form creates a real community end-to-end, and the listing correctly includes a pre-existing, unrelated real community — confirming this delta didn't disturb existing data. All QA fixtures created for this verification were removed afterward.

**Verification status**: fully verified against the real PostgreSQL database (dev, via manual QA) and the real test database (via automated tests) — not merely wired.
