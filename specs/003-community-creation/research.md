# Research: Community Creation & Founding Administrator

## 1. How to run a standalone, non-networked operator script

**Decision**: Add `tsx` as a devDependency; `scripts/create-community.ts` is invoked via `npx tsx scripts/create-community.ts --name "..." --email "..." --operator "..."` (wired as an `npm run create-community --` script).

**Rationale**: The script must import and execute the exact same `communityService.ts` module the automated tests exercise (TypeScript, using the project's `@/*` path alias and Prisma Client) — duplicating that logic in plain JavaScript to avoid a new dependency would create drift between what's tested and what operators actually run, which is a worse outcome than one small, focused devDependency. `tsx` requires zero additional configuration and is a widely used, single-purpose tool for exactly this case (run a TS file directly, no build step, no server).

**Alternatives considered**:
- **Node's built-in TypeScript stripping** (`--experimental-strip-types`, unflagged on newer Node): rejected because its behavior/availability differs across Node versions and could silently differ between an operator's local machine and CI, which is an unacceptable portability risk for tooling that must work reliably every time it's invoked (rarely, and often under pressure — onboarding a real institution).
- **`ts-node`**: rejected because it needs extra loader/tsconfig configuration to work with this project's `moduleResolution: "bundler"` + ESM setup, whereas `tsx` needs none.
- **Compiling the script ahead of time with `tsc`**: rejected as an unnecessary build step for a single, rarely-run script.

## 2. Why no Playwright/browser test for this feature

**Decision**: All tests for this feature run under Vitest, against the real Postgres test database — no Playwright test is added.

**Rationale**: Playwright in this repo drives the actual Next.js app in a browser. This feature deliberately has no page, route, or any other browser-observable surface (FR-001/FR-002) — there is nothing for a browser test to click or navigate to. The critical-flow test discipline (Principle VIII) is satisfied by calling `createCommunity()` directly against the real test database, exactly as the existing `tests/contract/*.ts` files already do for route-handler functions (see `test_sign_up.ts`) — the same "call the real interface directly, against a real DB, red before green" discipline, just with a service function as the interface instead of an HTTP handler.

**Alternatives considered**:
- **Building a minimal admin HTTP endpoint just so Playwright has something to hit**: rejected outright — it would directly violate FR-002 (no networked reachability) for the sole purpose of making the test suite look uniform.

## 3. Reusing `assertEmailVerified` for FR-004's verification check

**Decision**: `createCommunity()` calls the existing `assertEmailVerified(accountId)` from `src/server/services/accountService.ts` (already built for 002-accounts-authentication, documented there as "the gate consumed by the (separate) invitations feature") rather than re-querying/reimplementing the verified check.

**Rationale**: That function already exists, is already tested, and is explicitly the sanctioned gate other features are meant to call — this feature is exactly that "separate feature" its own doc comment anticipated. Reimplementing the check would duplicate logic that could drift out of sync with the real verification rule.

**Alternatives considered**: Inline `prisma.account.findUnique(...).emailVerifiedAt` check — rejected as needless duplication of an already-correct, already-tested existing function.

## 4. Proving non-discoverability (FR-009) without a directory feature

**Decision** *(corrected 2026-07-16)*: FR-009 is verified using **two** real accounts created in the test — a founder (A) and a genuinely unrelated second account (B) — by directly querying `prisma.membership` for B after creating a community naming A as founder, and asserting zero rows reference that community. `toCurrentAccountPayload()` is deliberately **not** used as FR-009 evidence.

**Rationale**: `toCurrentAccountPayload()` (`src/lib/auth/currentAccount.ts`, established in 002-accounts-authentication) is hardcoded to return `memberships: []` for every account regardless of real membership data — confirmed by reading its source, which never queries the `Membership` table at all. A check against it would pass identically whether or not isolation actually held, and checking it against A (the founding administrator) rather than a non-member would be doubly wrong, since A is the one account FR-009 explicitly permits to have real access. The only honest, falsifiable way to verify "not enumerable by a non-member" is to read real persisted data for an account that genuinely isn't a member — no directory/discovery feature is needed to do that, since the test can query Prisma directly, exactly as existing contract tests already do (e.g. `test_sign_up.ts`'s direct `prisma.account.findUnique` assertions). The founding administrator's own session view staying unchanged is a separate, real claim — spec.md FR-015 — verified separately, against A, using the (correctly, for that purpose) hardcoded payload.

**Alternatives considered**: Building a placeholder "list my communities" endpoint solely to have something to assert against — rejected as scope creep explicitly excluded by the spec ("any community directory or discovery" is out of scope). Adding a new internal `getMembershipsForAccount()`-style service function purely to make FR-009 testable — rejected as unnecessary: a direct Prisma query in the test achieves the same real-data verification with no new production code.

## 5. `MembershipRole` as a Prisma enum

**Decision**: `MembershipRole` is a native Prisma `enum` (compiling to a Postgres enum type and a generated TypeScript union), with a single member `ADMINISTRATOR` for this feature.

**Rationale**: The spec (Key Entities, amended) explicitly requires role to be "an enumerated type... never a bare integer or free-text string." A Prisma enum gives that guarantee at both the database level (Postgres rejects any value outside the enum) and the TypeScript level (the compiler rejects any string outside the union) — no additional validation code is needed to enforce it.

**Alternatives considered**: A `String` column validated only in application code — rejected because it only enforces the constraint in one layer, and the spec asks for the enumerated form specifically so a future removal/demotion feature "can reliably count on it" (FR-010).
