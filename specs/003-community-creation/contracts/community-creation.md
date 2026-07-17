# Contract: Community Creation Tooling

The primary interface is a service function, `createCommunity()`, and a thin CLI script that wraps it for operator use — deliberately not an HTTP endpoint (FR-002). **2026-07-17**: a second, disabled-by-default HTTP surface was added (FR-016) strictly for local development; it is documented in its own section below and is the sole, narrowly-scoped exception to "no HTTP endpoint."

## `createCommunity(input)` — `src/server/services/communityService.ts`

**Request** (function input):

```ts
{
  name: string;
  founderEmail: string;
  invokedBy: string; // operator identifier — not an Account/session identity (FR-002)
}
```

**Result** (discriminated union, mirroring this project's existing `SignUpResult`/`SignInResult` convention):

```ts
type CreateCommunityResult =
  | { ok: true; community: { id: string; name: string; createdAt: Date } }
  | { ok: false; reason: "invalid_name" }
  | { ok: false; reason: "account_not_found" }
  | { ok: false; reason: "account_not_verified" };
```

- `{ ok: true }` — the community and exactly one `ADMINISTRATOR` membership for the account matching `founderEmail` were created atomically. `createdByOperator` is set to `invokedBy`. Neither `founderEmail`'s `Account` row nor its credentials/verification state are read for any purpose beyond the existence/verified check, nor written at all (FR-005/FR-006).
- `{ ok: false, reason: "invalid_name" }` — `name` is blank or whitespace-only after trimming (FR-014). No row written.
- `{ ok: false, reason: "account_not_found" }` — no `Account` matches `founderEmail` (FR-003). No row written, no account created.
- `{ ok: false, reason: "account_not_verified" }` — an `Account` matches `founderEmail` but `emailVerifiedAt` is null (FR-004). No row written; that account is left byte-for-byte unchanged.

Validation order: `name` is checked before the account lookup, so an invalid name is rejected even if `founderEmail` is also wrong — both failure modes are independently reachable and independently tested.

## `scripts/create-community.ts` — operator entry point

Invoked as:

```sh
npx tsx scripts/create-community.ts --name "Riverside Residences" --email "jordan@example.com" --operator "jordan.ops@cmarket-team.example"
```

(also wired as `npm run create-community -- --name "..." --email "..." --operator "..."`)

- All three flags are required; the script exits non-zero with a usage message if any is missing, without calling `createCommunity()` at all.
- On `{ ok: true }`, prints the created community's `id`, `name`, and `createdAt`, and exits `0`.
- On any `{ ok: false }`, prints the specific `reason` and exits non-zero. The three failure reasons are distinguishable in the printed output (never a single generic "failed" message) — this is an operator tool, not a non-enumeration-sensitive end-user surface, so precise errors are the correct behavior here (contrast the enumeration-safe end-user sign-up flow in 002-accounts-authentication).
- This script is one of exactly two callers of `createCommunity()` from outside the test suite — the other being the development-only operator panel below. Neither this script nor `communityService.ts` MUST be imported by anything under `app/` other than the one allow-listed route documented below (FR-002) — enforced by `tests/unit/test_community_creation_not_networked.ts`.

## `/operator` and `POST /api/operator/create-community` — development-only panel (FR-016)

**Disabled by default.** Both the page and the route below independently check `process.env.OPERATOR_PANEL_ENABLED === "true"` at the top of their handler; if not enabled, both return a real `404` (via `notFound()` on the page, a literal `404` `Response` on the route) — never a redirect, never an error page. `OPERATOR_PANEL_ENABLED` MUST NOT be set to `"true"` in any real deployment (see `.env.example` and README).

### `GET /operator`

A Server Component page. When enabled: lists existing communities (`id`, `name`, `createdByOperator`, `createdAt` only — no membership/member data, per FR-016's cross-community-data-view restriction) and renders a form that posts to the route below. When disabled: `404`.

### `POST /api/operator/create-community`

**Request**:

```json
{ "name": "string", "founderEmail": "string", "invokedBy": "string" }
```

**Responses**:

- `404` — `OPERATOR_PANEL_ENABLED` is not `"true"`. `createCommunity()` is never called in this case.
- `200` with the `CreateCommunityResult` success shape — creation succeeded. Identical to `createCommunity()`'s own `{ ok: true, community }`.
- `400` with the `CreateCommunityResult` failure shape — `{ ok: false, reason }`, one of `invalid_name` / `account_not_found` / `account_not_verified`, identical to what `createCommunity()` itself returns. Unlike the enumeration-safe end-user surfaces elsewhere in this project, this is an operator-only tool, so precise reasons are shown, matching the CLI's own behavior.

This route calls `createCommunity()` exactly as-is — no new validation, no bypass of any of its existing checks, no additional user/membership creation.
