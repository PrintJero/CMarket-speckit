---

description: "Task list template for feature implementation"
---

# Tasks: Accounts and Authentication

**Input**: Design documents from `/specs/002-accounts-authentication/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth-api.md, quickstart.md

**Tests**: Mandatory for this feature. Constitution Principle VIII lists user registration and sign-in/sign-out as critical flows: tests MUST be written first, MUST fail first, and implementation MUST proceed only to make them pass. Every user story phase below therefore includes a Tests sub-phase that comes before its Implementation sub-phase.

**Organization**: Tasks are grouped by user story (from spec.md, in priority order) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Paths are relative to the repository root, per plan.md's Project Structure (single Next.js App Router application — no separate backend/frontend split)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create the Next.js (App Router, TypeScript) project structure per plan.md's Project Structure: `app/`, `src/lib/`, `src/server/services/`, `prisma/`, `tests/{contract,integration,unit}/`
- [X] T002 [P] Initialize `package.json` with Next.js, TypeScript, Prisma, Auth.js (NextAuth) with the Prisma adapter, and an Argon2 hashing library as dependencies
- [X] T003 [P] Configure Vitest for unit/contract tests in `vitest.config.ts`
- [X] T004 [P] Configure Playwright for integration tests in `playwright.config.ts`
- [X] T005 [P] Configure ESLint and Prettier per repository conventions

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core data model and auth plumbing that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Define the Prisma schema for `Account`, `AuthIdentity`, `Session`, and `VerificationToken` per data-model.md in `prisma/schema.prisma`
- [X] T007 Generate and apply the initial Prisma migration for the schema in T006 (depends on T006) — migration SQL generated via `prisma migrate diff` and committed at `prisma/migrations/20260716000000_init/`; **not yet applied to a live database** (no reachable Postgres in this environment) — run `prisma migrate deploy` once `DATABASE_URL` points at a real database
- [X] T008 [P] Implement the email normalization/case-insensitive matching utility (FR-017) in `src/lib/validation/email.ts`
- [X] T009 [P] Implement the password policy validator — minimum 8 characters plus HIBP breached-password check (FR-016, research.md #4) — in `src/lib/validation/password.ts`
- [X] T010 [P] Implement the Argon2id password hashing/verification helper (research.md #1) in `src/lib/auth/passwordHash.ts`
- [X] T011 [P] Implement the provider-agnostic transactional email-sending helper (research.md #5) in `src/lib/email/sendEmail.ts`
- [X] T012 Configure Auth.js: Google provider, custom Prisma-backed adapter (`src/lib/auth/prismaAuthAdapter.ts`), database-backed session strategy (research.md #2) in `src/lib/auth/authConfig.ts` (depends on T006, T010). **Revised from the original task**: Credentials are handled by our own routes, not an Auth.js `CredentialsProvider` — see research.md #2 addendum for why (NextAuth v4 forces stateless JWT sessions for Credentials, which cannot satisfy Story 2's immediate server-side revocation on sign-out)
- [X] T013 Mount the Auth.js route handler in `app/api/auth/[...nextauth]/route.ts` (depends on T012)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Create an account with email and password, gated by verification (Priority: P1) 🎯 MVP

**Goal**: A visitor signs up with email and password; the account exists immediately but cannot accept a community invitation until the email is verified.

**Independent Test**: Sign up with a fresh email/password, confirm the account is unverified and invitation acceptance is blocked, follow the verification link, confirm invitation acceptance is now permitted.

### Tests for User Story 1 ⚠️

**Write these tests FIRST; confirm they FAIL before implementing anything below**

- [X] T014 [P] [US1] Contract test for `POST /api/auth/sign-up` (valid signup, weak/breached password rejected, identical response for a duplicate email) in `tests/contract/test_sign_up.ts`
- [X] T015 [P] [US1] Contract test for `GET /api/auth/verify-email` (valid, expired, and already-consumed token) in `tests/contract/test_verify_email.ts`
- [X] T016 [P] [US1] Contract test for `POST /api/auth/resend-verification` in `tests/contract/test_resend_verification.ts`
- [X] T017 [P] [US1] Integration test: signup → invitation acceptance blocked → verify → invitation acceptance permitted (quickstart.md Scenario 1) in `tests/integration/test_signup_verification_flow.spec.ts` — asserts directly against `assertEmailVerified()` rather than a real invitation-accept endpoint, since the invitations feature lives outside this spec
- [X] T018 [P] [US1] Integration test: signup against an email that already has an account returns the identical response as a new signup (quickstart.md Scenario 2) in `tests/integration/test_signup_enumeration.spec.ts`
- [X] T019 [P] [US1] Unit tests for the password policy validator (T009) in `tests/unit/test_password_policy.ts` — **15/15 passing** (ran locally, no external services needed)
- [X] T020 [P] [US1] Unit tests for email normalization/matching (T008) in `tests/unit/test_email_matching.ts` — **passing**, see T019 note

### Implementation for User Story 1

- [X] T021 [US1] Implement the `VerificationToken` service — issue (hashed, 24h expiry), consume, invalidate-prior-token-on-resend — in `src/server/services/verificationService.ts` (depends on T006, T007)
- [X] T022 [US1] Implement `accountService.signUp()`: normalize email (T008), validate password (T009), hash it (T010), create an unverified `Account`, issue a verification token (T021), send the email (T011), and return an identical result whether or not the email already had an account (FR-009) — in `src/server/services/accountService.ts` (depends on T008, T009, T010, T011, T021)
- [X] T023 [US1] Implement the `POST /api/auth/sign-up` route in `app/api/auth/sign-up/route.ts` (depends on T022)
- [X] T024 [US1] Implement the `GET /api/auth/verify-email` route (consume token, set `Account.emailVerifiedAt`) in `app/api/auth/verify-email/route.ts` (depends on T021)
- [X] T025 [US1] Implement the `POST /api/auth/resend-verification` route in `app/api/auth/resend-verification/route.ts` (depends on T021, T022)
- [X] T026 [US1] Implement the invitation-acceptance verification guard (`assertEmailVerified(accountId)`) that the existing invitations feature must call before activating a membership (FR-005, FR-007) in `src/server/services/accountService.ts` (depends on T022)
- [X] T027 [P] [US1] Build the sign-up page (email/password form, generic confirmation state) in `app/(auth)/sign-up/page.tsx`
- [X] T028 [P] [US1] Build the verify-email page (consumes the link, shows status, offers resend) in `app/(auth)/verify-email/page.tsx`

**Verification status**: T014-T018 all pass against a real PostgreSQL 16 instance (Docker) and, for T017/T018 which are Playwright specs, a real Chromium browser — confirmed across multiple repeated runs. Fixed one real bug surfaced only by testing against a live, shared database: `test_sign_up.ts`/`test_verify_email.ts`/`test_resend_verification.ts` each ran an **unscoped** `prisma.verificationToken.deleteMany()` in `beforeEach`, which raced with other contract test files running in parallel against the same test DB (one file's cleanup could delete another's in-flight token). Fixed by removing the unscoped delete and relying on `VerificationToken`'s `onDelete: Cascade` from the scoped `account.deleteMany()` already present in each file.

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP.

---

## Phase 4: User Story 2 - Sign in, sign out, and stay signed in (Priority: P1)

**Goal**: An existing account holder signs in, stays signed in across app restarts, and can explicitly sign out.

**Independent Test**: Sign in with valid credentials, confirm the session survives an app restart, sign out, confirm the session no longer grants access.

### Tests for User Story 2 ⚠️

**Write these tests FIRST; confirm they FAIL before implementing anything below**

- [X] T029 [P] [US2] Integration test: sign in with valid credentials and confirm the session persists across an app restart (quickstart.md Scenario 3, steps 1-2) in `tests/integration/test_signin_persistence.spec.ts`
- [X] T030 [P] [US2] Integration test: sign in with an incorrect password returns a generic invalid-credentials error (quickstart.md Scenario 3, step 3) in `tests/integration/test_signin_invalid_credentials.spec.ts`
- [X] T031 [P] [US2] Integration test: sign out deletes the underlying `Session` row and immediately revokes access (quickstart.md Scenario 3, step 4) in `tests/integration/test_signout_revocation.spec.ts`

### Implementation for User Story 2

- [X] T032 [US2] Implement `POST /api/auth/sign-in` — verify the submitted password against the stored Argon2id hash, generic failure for either a wrong password or no matching account (FR-010, FR-012), set the session cookie on success — in `app/api/auth/sign-in/route.ts` and `src/server/services/accountService.ts` (depends on T010, sessionService)
- [X] T033 [US2] Session persistence/expiry (FR-008) implemented in `src/server/services/sessionService.ts` (30-day expiry, shared by both Google and credentials sign-in)
- [X] T034 [US2] Implement `POST /api/auth/sign-out`, deleting the `Session` row (not merely clearing the cookie) in `app/api/auth/sign-out/route.ts` (Story 2 scenario 3)
- [X] T035 [P] [US2] Build the sign-in page in `app/(auth)/sign-in/page.tsx`
- [X] T036 [P] [US2] Add a sign-out control to the authenticated app layout in `app/layout.tsx`

**Checkpoint**: User Stories 1 and 2 both work independently. **Verification status**: T029-T031 pass against a real PostgreSQL instance and a real Chromium browser (Playwright), confirmed across multiple repeated runs, including the persisted-session-across-a-new-browser-context scenario and the sign-out Session-row-deletion assertion.

---

## Phase 5: User Story 3 - Sign up or sign in with Google (Priority: P2)

**Goal**: A visitor creates an account, or an existing account holder signs in, via Google; the account is verified immediately, and Google auto-links to a matching existing password account rather than duplicating it.

**Independent Test**: Complete Google sign-in for an email with no prior account, confirm a verified zero-membership account is created; repeat sign-in reuses it; Google sign-in against an email that already has a password account links to that same account.

### Tests for User Story 3 ⚠️

**Write these tests FIRST; confirm they FAIL before implementing anything below**

- [X] T037 [P] [US3] Integration test: Google sign-up for a brand-new email creates a verified, zero-membership account (quickstart.md Scenario 4, steps 1-2) in `tests/integration/test_google_signup_new.spec.ts` — drives our custom Adapter directly rather than a real Google consent screen (infeasible without live Google test credentials); see file header comment
- [X] T038 [P] [US3] Integration test: a repeat Google sign-in for the same identity reuses the same account, no duplicate created (quickstart.md Scenario 4, step 3) in `tests/integration/test_google_signin_existing.spec.ts`
- [X] T039 [P] [US3] Integration test: Google sign-up auto-links to an existing password account by case-insensitive email match, sets verification, and preserves existing memberships (quickstart.md Scenario 5) in `tests/integration/test_google_autolink.spec.ts`

### Implementation for User Story 3

- [X] T040 [US3] Configure the Google OAuth provider, with `allowDangerousEmailAccountLinking: true` (research.md #7 / FR-015) in `src/lib/auth/authConfig.ts` (depends on T012)
- [X] T041 [US3] Implement the auto-link logic — **revised from the original task**: rather than a custom `signIn` callback, this is implemented inside our custom Adapter's `getUserByEmail`/`linkAccount` methods (`src/lib/auth/prismaAuthAdapter.ts`), which NextAuth v4's core `callback-handler.js` already calls in exactly this sequence when `allowDangerousEmailAccountLinking` is set — `linkAccount` also sets `emailVerifiedAt` if it was null (FR-015)
- [X] T042 [P] [US3] Add a "Continue with Google" option to the sign-up and sign-in pages in `app/(auth)/sign-up/page.tsx` and `app/(auth)/sign-in/page.tsx` (depends on T027, T035)

**Checkpoint**: All three user stories are independently functional. **Verification status**: T037-T039 pass against a real PostgreSQL instance (these three drive the Adapter directly in a Playwright/Node context rather than a real Google consent screen — see each file's header comment for why real Google OAuth credentials still can't be exercised automatically here).

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T043 [P] Unit test: the session payload for a newly created account, regardless of which signup method created it, exposes nothing beyond an empty memberships list (FR-003, FR-013) in `tests/unit/test_zero_membership_payload.ts` — **passing** (18/18 total unit tests)
- [X] T044 Security review pass confirming zero code paths store or compare a password in plaintext and zero authentication path bypasses password validation (FR-011, FR-012, SC-007); record findings in `specs/002-accounts-authentication/security-review-notes.md`
- [X] T045 [P] Document required environment configuration (`DATABASE_URL`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, email provider credentials) in `README.md`
- [X] T046 Run the full quickstart.md validation across all 6 scenarios end-to-end — **verified**: a Dockerized PostgreSQL 16 (`docker-compose.yml`, dev + test databases) and Playwright's Chromium were made available mid-implementation. Full results: `npx tsc --noEmit` clean, `npx eslint .` clean, `npm run build` compiles all 12 routes, `npx vitest run tests/unit tests/contract` — **29/29 passing**, `npx playwright test` — **8/8 passing**, both confirmed stable across repeated runs. Scenario 6 (zero-membership visibility) is covered by `tests/unit/test_zero_membership_payload.ts` rather than a live run, since there is no listings/community feature in this repo to browse yet. Not exercised: the real Google OAuth consent screen (no live `GOOGLE_CLIENT_ID`/`SECRET`) — Story 3's tests drive the Adapter directly instead (see each file's header comment).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational only
- **User Story 2 (Phase 4)**: Depends on Foundational only (shares `authConfig.ts` with US1/US3 but adds independent behavior)
- **User Story 3 (Phase 5)**: Depends on Foundational and on `accountService.signUp()`'s email-matching logic (T022) for the auto-link path, but is independently testable and deliverable after US1
- **Polish (Phase 6)**: Depends on all three user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependency on US2/US3 — this is the MVP
- **User Story 2 (P1)**: No functional dependency on US1, but both modify `src/lib/auth/authConfig.ts`, so sequencing (rather than true parallel work) is recommended to avoid merge conflicts in that one file
- **User Story 3 (P2)**: Reuses `accountService.ts`'s email-matching helper (T008) and the `Account` creation path from US1 (T022); implement after US1

### Parallel Opportunities

- All Setup tasks marked [P] can run together
- All Foundational tasks marked [P] (T008-T011) can run together once T006/T007 land
- All tests within a user story marked [P] can run together, and must all be written and failing before that story's implementation tasks begin
- T027/T028 (US1 pages), T035/T036 (US2 pages), and T042 (US3 pages) can run in parallel with each other's story once their respective service-layer tasks are done

---

## Parallel Example: User Story 1

```bash
# Tests first, all in parallel (different files):
Task: "Contract test for POST /api/auth/sign-up in tests/contract/test_sign_up.ts"
Task: "Contract test for GET /api/auth/verify-email in tests/contract/test_verify_email.ts"
Task: "Contract test for POST /api/auth/resend-verification in tests/contract/test_resend_verification.ts"
Task: "Integration test signup→verify→accept flow in tests/integration/test_signup_verification_flow.spec.ts"
Task: "Integration test signup non-enumeration in tests/integration/test_signup_enumeration.spec.ts"
Task: "Unit tests for password policy in tests/unit/test_password_policy.ts"
Task: "Unit tests for email matching in tests/unit/test_email_matching.ts"

# Confirm all of the above fail, then implement:
Task: "Create sign-up page in app/(auth)/sign-up/page.tsx"
Task: "Create verify-email page in app/(auth)/verify-email/page.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (critical — blocks all stories)
3. Complete Phase 3: User Story 1, tests first, confirmed failing, then made to pass
4. **STOP and VALIDATE**: run quickstart.md Scenarios 1-2 independently
5. Deploy/demo if ready — this alone gives CMarket real, invitation-independent accounts with a working verification gate

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. User Story 1 → validate (quickstart Scenarios 1-2) → deploy/demo (MVP)
3. User Story 2 → validate (quickstart Scenario 3) → deploy/demo
4. User Story 3 → validate (quickstart Scenarios 4-5) → deploy/demo
5. Polish → full quickstart.md run (all 6 scenarios) + security review

---

## Notes

- [P] tasks = different files, no unmet dependencies
- [Story] label maps each task to its user story for traceability
- Per Constitution Principle VIII, every story's Tests sub-phase MUST be written and confirmed failing before its Implementation sub-phase begins
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently before moving on

---

## Delta: FR-015/FR-018 security amendment (2026-07-16)

**Scope**: FR-015 (auto-link) had a pre-hijacking defect — an attacker could register a victim's email with a password, never verify it, and retain a working password on the account after the real owner signed in with Google and the account became verified. Spec split FR-015 (verified pre-existing account: link, preserve credential) from a new FR-018 (unverified pre-existing account: link, verify, but discard the password credential, revoke all sessions, invalidate pending verification tokens). This delta covers spec → design docs → tests → implementation for that fix only; no other behavior in this feature was touched.

- [X] T047 [SEC] Amend spec.md: split FR-015 into FR-015 (verified case, unchanged) + new FR-018 (unverified case, credential teardown); split Story 3 scenario 4 into two scenarios; rewrite the matching Edge Cases entry; add SC-008. Documented as a new Clarifications session entry.
- [X] T048 [SEC] Amend data-model.md (Account `passwordHash` `set → null` transition, AuthIdentity/Session/VerificationToken teardown-on-link notes), contracts/auth-api.md (Google sign-in section split by verification state), research.md (#8: atomic `updateMany`-count check-and-act, avoiding a read-then-branch race), plan.md (Constitution Check re-affirmed against Principle I specifically).
- [X] T049 [SEC] Update the failing test `tests/integration/test_google_autolink.spec.ts` to assert the corrected unverified-case behavior (identity links, account verified, password hash null, all prior sessions revoked, pending verification tokens invalidated, single account, old password no longer authenticates) — **confirmed RED** against the pre-fix adapter (failed exactly at the `passwordHash` assertion) before implementing.
- [X] T050 [SEC] Add new test `tests/integration/test_google_autolink_verified.spec.ts` for the previously-uncovered verified-account case (link preserves password and existing sessions) — passed against the pre-fix code too, confirming the fix must not over-apply to this branch.
- [X] T051 [SEC] Fix `linkAccount` in `src/lib/auth/prismaAuthAdapter.ts`: fold the "was this account unverified" check into the existing `updateMany`'s `WHERE emailVerifiedAt: null` (now also clearing `passwordHash: null` in the same call), then — only when its returned `count > 0` — delete all `Session` rows and consume all pending `VerificationToken` rows for that account.
- [X] T052 [SEC] Re-run both tests — **confirmed GREEN** — then the full suite (`tsc --noEmit`, `eslint .`, `vitest run tests/unit tests/contract`, `playwright test`) to confirm no regressions: 29/29 unit+contract, 9/9 Playwright (8 prior + 1 new).

---

## Delta: FR-019/FR-020 security amendment #2 (2026-07-16)

**Scope**: The FR-018 fix above only closed the Google-auto-link path. The identical root cause — a credential attached to an Account before anyone proved ownership of its email — remained fully exploitable purely within the email/password flow: an attacker registers `victim@x.com` with their own password and never verifies it; the real owner later submits their own sign-up with their own password; the system silently discards the real owner's submitted password but still re-sends a verification email (correctly, to the real owner's inbox); when the real owner clicks their own link, the account becomes verified — with the attacker's original password still attached. The real owner's own click was the exploit step. Spec amended: a password credential MUST NOT be attached to an Account before its email is verified at all (new FR-019); the candidate credential is stored on the `VerificationToken` and applied only at consumption, and only if the account is still unverified at that moment (new FR-020). Direct consequence resolved explicitly: an unverified account has no credential and therefore cannot be signed into with a password (FR-007 revised). FR-018 narrowed to a defense-in-depth role, since FR-019 already prevents the vulnerable state from existing. This delta covers spec → design docs → tests → implementation for this fix only; no other behavior in this feature was touched.

- [X] T053 [SEC] Amend spec.md: add Clarifications session #2; revise Story 1's intro + scenario 3 + new scenario 5 (repeated sign-up, credential binding); revise Story 2 scenario 1 + new scenario 4 (unverified accounts cannot sign in); rewrite two Edge Cases entries + add one new one; revise FR-007 and FR-014; add new FR-019 and FR-020; narrow FR-018's mechanism description; add Verification Token to Key Entities; add SC-009.
- [X] T054 [SEC] Amend data-model.md (`Account.passwordHash` now null-until-verified as the primary state-transition narrative; `VerificationToken.candidatePasswordHash` field + validation rules; `AuthIdentity`/`Session` teardown notes reframed as defense-in-depth), contracts/auth-api.md (`POST /sign-up`, `GET /verify-email`, `POST /resend-verification`, `POST /sign-in`, and the Google auto-link section all updated for the new mechanism), research.md (#9: bind the candidate credential to the token, atomic `emailVerifiedAt IS NULL` guard on apply), plan.md (Constitution Check re-affirmed against Principle I a second time).
- [X] T055 [SEC] Update the failing test `tests/contract/test_sign_up.ts:64-102` (the FR-009 double-signup case) to assert which credential ends up active — **confirmed RED** against the pre-fix code at two points: `passwordHash` was already set immediately at signup (should be `null`), and the attacker's password already authenticated before verification (should fail).
- [X] T056 [SEC] Add new test `tests/contract/test_verify_email.ts` case: a token consumed against an already-verified account does not modify `passwordHash` (FR-020) — exercises the defensive `emailVerifiedAt IS NULL` guard directly, since the normal flow doesn't otherwise produce this state.
- [X] T057 [SEC] Add `VerificationToken.candidatePasswordHash` to `prisma/schema.prisma`; migration `20260716153614_add_verification_token_candidate_password_hash` generated via `prisma migrate dev` and applied to both the dev and test PostgreSQL containers.
- [X] T058 [SEC] Rewrite `issueVerificationToken`/`consumeVerificationToken` in `src/server/services/verificationService.ts` (candidate-hash parameter; atomic `updateMany` guarded by `emailVerifiedAt: null` applying `passwordHash` + `emailVerifiedAt` together) and `signUp`/`resendVerification` in `src/server/services/accountService.ts` (never write `Account.passwordHash` directly; compute/carry-forward the candidate hash and pass it to the token).
- [X] T059 [SEC] Re-run the updated/new tests — **confirmed GREEN** — then the full suite: `tsc --noEmit` clean, `eslint .` clean, `npm run build` (12 routes), `vitest run tests/unit tests/contract` 30/30, `playwright test` 9/9 — all stable across 3 repeated runs, against the real PostgreSQL containers and Chromium (no regressions in the Google auto-link tests from the first delta, which construct their accounts directly via Prisma and are unaffected by this one).

**Verification status**: fully verified against the real PostgreSQL test database and Chromium — not merely wired.

---

## Delta: FR-019/FR-020/FR-021/FR-022 security amendment #3 (2026-07-16)

**Scope**: Amendment #2's own mechanism — invalidating a prior pending token when issuing a new one — was itself a defect: it made "whichever sign-up call happens last" control which credential could ever be applied, letting an attacker destroy the real owner's live token purely by calling sign-up again for the same email, no password-guessing or click-racing required. Separately, `resendVerification`'s carry-forward of `candidatePasswordHash` returns `null` when an account has no prior token history, and consuming such a token was verifying the account anyway — a permanent lockout once a password-recovery-less, credential-less account is falsely marked verified. Spec amended: FR-019 revised so sign-up no longer invalidates prior tokens (multiple may coexist; `resendVerification` alone still invalidates, since it carries forward rather than competing); FR-020 revised so the first consumption that verifies an account also invalidates every sibling token; new FR-021 adds a per-email rate limit on token issuance (closing the amplifier); new FR-022 blocks a null-candidate token from verifying a credential-less account. This delta covers spec → design docs → tests → implementation for this fix only; no other behavior in this feature was touched.

- [X] T060 [SEC] Amend spec.md: add Clarifications session #3 (two Q&A entries — coexistence/rate-limit, and the null-candidate guard); revise Story 1 scenario 5 + add scenario 6; rewrite the "competing sign-up" and "verification link expired" Edge Cases, add two new Edge Cases (rate limiting, null-candidate); revise FR-014, FR-019, FR-020; add new FR-021 (rate limiting) and FR-022 (null-candidate guard); revise SC-009 (was encoding the vulnerable "most recent wins" behavior as a success criterion) and add SC-010/SC-011/SC-012; revise the Verification Token Key Entity; correct the Assumptions line that declared rate-limiting generically out of scope.
- [X] T061 [SEC] Amend data-model.md (`VerificationToken` — multiple coexisting rows, sibling-invalidation-on-verify, rate-limit validation rule; `Account.passwordHash` — FR-022 guard note), contracts/auth-api.md (`POST /sign-up`, `POST /resend-verification`, `GET /verify-email`, Google auto-link section, and a new "Rate limiting" section), research.md (#10: coexisting tokens via an interactive `$transaction` for the conditional sibling-invalidation step; #11: rate limiting by counting existing `VerificationToken` rows rather than new infrastructure; #12: fold the null-candidate guard into the existing atomic `WHERE` clause), plan.md (Constitution Check re-affirmed against Principle I a third time).
- [X] T062 [SEC] Add new test file `tests/contract/test_signup_token_coexistence.ts`: (a) the account holder's own token survives a competing sign-up and still applies their own password when consumed, with the competing token dead afterward — **confirmed RED** (failed at `expect(victimVerify.status).toBe(200)`, got 400, since the old code's invalidate-on-reissue had already killed the victim's token); (b) documents the acknowledged residual honestly (whoever consumes first wins) — this one already passed against the pre-fix code, since it describes unchanged, inherent behavior, not a defect.
- [X] T063 [SEC] Add a new rate-limit test to `tests/contract/test_sign_up.ts` — **confirmed RED** (7 rapid sign-ups against one email sent 7 emails with no throttling at all, expected ≤5) — asserting identical `202` responses throughout (FR-009 preserved) and no more than 5 tokens/emails issued.
- [X] T064 [SEC] Add a new test to `tests/contract/test_verify_email.ts`: a null-candidate token consumed against a credential-less account MUST NOT verify it (FR-022) — **confirmed RED** (incorrectly returned `200` and set `emailVerifiedAt` against the pre-fix code).
- [X] T065 [SEC] Add a new test to `tests/contract/test_resend_verification.ts`: resend still invalidates the token it replaces and carries forward the same candidate credential (FR-014, unchanged) — passed against the pre-fix code already, confirming this behavior was correctly preserved rather than accidentally broken by the coexistence change.
- [X] T066 [SEC] Updated the existing FR-009 double-signup test in `test_sign_up.ts` (title/comments only — its assertions already matched the new coexistence model by coincidence, since it happens to consume the *last*-issued token either way) to stop describing the now-removed "invalidates whichever token preceded it" behavior as current.
- [X] T067 [SEC] Implement: `verificationService.ts` — split `issueVerificationToken` (no invalidation, used by `signUp`) from a new `reissueVerificationToken` (invalidates-then-creates, used by `resendVerification` only); added `isIssuanceRateLimited` (counts `VerificationToken` rows created per account in a trailing 15-minute window, threshold 5, exported as `RATE_LIMIT_MAX_TOKENS`); rewrote `consumeVerificationToken` as a Prisma interactive transaction that (1) marks the target token consumed, (2) attempts the guarded `account.updateMany` — now also requiring `passwordHash: { not: null }` when the candidate is null (FR-022) — and (3), only if that update actually verified the account, marks every sibling pending token consumed too (FR-020). `accountService.ts`'s `signUp`/`resendVerification` updated to call the rate-limit check and the correct issue/reissue function.
- [X] T068 [SEC] Re-run all new/updated tests — **confirmed GREEN** — then the full suite: `tsc --noEmit` clean, `eslint .` clean, `npm run build` (12 routes), `vitest run tests/unit tests/contract` **35/35**, `playwright test` **9/9** — stable across repeated runs against the real PostgreSQL containers and Chromium, no regressions in any prior delta's tests.

**Verification status**: fully verified against the real PostgreSQL test database and Chromium — not merely wired.

---

## Delta: FR-023 client-side password-confirmation guard (2026-07-16)

**Scope**: Password recovery is out of scope for this feature, so a typo in the sign-up password field produces a permanently unusable account once the email is verified (FR-020 applies whatever candidate credential the token carries, typo or not). Added FR-023: the sign-up form requires the password twice and blocks submission client-side on a mismatch. Explicitly NOT a security control — no server-side requirement, no API contract change, no new request-body field. No other form enhancement (strength meter, visibility toggle, etc.) was added.

- [X] T069 Amend spec.md: add FR-023 and Story 1 acceptance scenario 7.
- [X] T070 Update `tests/integration/test_signup_verification_flow.spec.ts` to fill the new required "Confirm password" field (otherwise native HTML validation would block submission) — **confirmed RED** first (timed out waiting for a "Confirm password" label that didn't exist yet).
- [X] T071 Add new test `tests/integration/test_signup_password_confirmation.spec.ts`: mismatched passwords show an inline "Passwords do not match." error and no account is created (no request reaches the server) — **confirmed RED** alongside T070, for the same reason.
- [X] T072 Implement: add a "Confirm password" field and inline error to `app/(auth)/sign-up/page.tsx`; `onSubmit` compares the two values and returns early (no `fetch` call) on a mismatch, otherwise submitting the exact same `{ email, password }` body as before.
- [X] T073 Re-run both tests — **confirmed GREEN** — then the full suite: `tsc --noEmit` clean, `eslint .` clean, `npm run build` (12 routes), `vitest run tests/unit tests/contract` **35/35** (unaffected, as expected for a pure UI change), `playwright test` **10/10** (9 prior + 1 new).

**Verification status**: fully verified against the real PostgreSQL test database and Chromium — not merely wired.

---

## Delta: FR-024 post-sign-up screen wayfinding (2026-07-16)

**Scope**: The post-sign-up "Check your email" screen was a dead end (no way to request another email, no way back to sign-in). Added a "Resend verification email" action (reusing the existing, unchanged `POST /api/auth/resend-verification` endpoint) and a "Back to sign in" link. Presentation and wiring only — the resend action shows the identical, generic acknowledgement regardless of the email's real state (already sent, already verified, or rate-limited), by construction (no branching on the response), preserving FR-009/FR-021. No API contract or server behavior changed.

- [X] T074 Amend spec.md: add FR-024 and Story 1 acceptance scenario 8.
- [X] T075 Add new test `tests/integration/test_signup_done_screen_actions.spec.ts` — **confirmed RED** (timed out waiting for a "Resend verification email" button that didn't exist yet).
- [X] T076 Implement: add a resend button and sign-in link to the `status === "done"` branch of `app/(auth)/sign-up/page.tsx`, calling the existing resend-verification endpoint with the email already in state (no re-prompt needed) and showing the same generic acknowledgement text already used on the verify-email page.
- [X] T077 Re-run the new test — **confirmed GREEN** — then the full suite: `tsc --noEmit` clean, `eslint .` clean, `npm run build` (12 routes), `vitest run tests/unit tests/contract` **35/35** (unaffected, pure UI change), `playwright test` **11/11** (10 prior + 1 new). Also visually confirmed via screenshot: the resend button and post-click acknowledgement render consistently with the rest of the design system.

**Verification status**: fully verified against the real PostgreSQL test database and Chromium — not merely wired.
